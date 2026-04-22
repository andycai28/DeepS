"""LLM-powered outline generation.

Loads the system/user prompts from this module's `prompts/` directory, calls
the configured LLM via `deeptutor.services.llm.complete`, parses the JSON
response (with repair fallback), and returns a validated `Outline` object.

The LLM is responsible for producing `courseTitle`, `courseDescription`,
`languageDirective`, and the `outlines[]` array. Python fills in `id`,
`source`, and `metadata` so LLMs can't leak identifiers or timestamps.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from deeptutor.outline.models import (
    KnowledgePoint,
    Outline,
    OutlineMetadata,
    OutlineSource,
    OutlineSourceType,
)
from deeptutor.services.llm import complete, supports_response_format
from deeptutor.services.llm.config import get_llm_config
from deeptutor.utils.json_parser import parse_json_response

logger = logging.getLogger(__name__)

_PROMPTS_DIR = Path(__file__).parent / "prompts"
_DEFAULT_TEMPERATURE = 0.5
_DEFAULT_MAX_TOKENS = 6000


class OutlineGenerationError(RuntimeError):
    """Raised when the LLM output cannot be turned into a valid Outline."""


def _load_prompt(name: str) -> str:
    return (_PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")


def _render_user_prompt(requirement: str) -> str:
    return _load_prompt("user").replace("{{requirement}}", requirement.strip())


def _build_outline(
    data: dict[str, Any],
    requirement: str,
    llm_model: str | None,
) -> Outline:
    raw_outlines = data.get("outlines")
    if not isinstance(raw_outlines, list) or not raw_outlines:
        raise OutlineGenerationError(
            "LLM response missing a non-empty `outlines` array",
        )

    knowledge_points: list[KnowledgePoint] = []
    for idx, kp_data in enumerate(raw_outlines, start=1):
        if not isinstance(kp_data, dict):
            raise OutlineGenerationError(
                f"outlines[{idx - 1}] is not an object: {type(kp_data).__name__}",
            )
        # Tolerate missing `order` — infer from position
        kp_data.setdefault("order", idx)
        kp_data.setdefault("id", f"kp_{idx}")
        knowledge_points.append(KnowledgePoint.model_validate(kp_data))

    title = str(data.get("courseTitle") or "").strip() or requirement[:40]
    description = str(data.get("courseDescription") or "").strip()
    language_directive = str(data.get("languageDirective") or "").strip()

    return Outline(
        title=title,
        description=description,
        language_directive=language_directive,
        source=OutlineSource(type=OutlineSourceType.TOPIC, topic=requirement.strip()),
        outlines=knowledge_points,
        metadata=OutlineMetadata(llm_model=llm_model),
    )


async def generate_outline(requirement: str) -> Outline:
    """Generate an Outline from a free-form requirement string.

    Args:
        requirement: The user's learning-goal text (plain prose).

    Returns:
        A fully populated Outline with a freshly generated id.

    Raises:
        OutlineGenerationError: On malformed LLM output.
    """
    requirement = requirement.strip()
    if not requirement:
        raise OutlineGenerationError("requirement cannot be empty")

    system_prompt = _load_prompt("system")
    user_prompt = _render_user_prompt(requirement)

    config = get_llm_config()
    binding = config.binding or "openai"

    llm_kwargs: dict[str, Any] = {
        "temperature": _DEFAULT_TEMPERATURE,
        "max_tokens": _DEFAULT_MAX_TOKENS,
    }
    if supports_response_format(binding, config.model):
        llm_kwargs["response_format"] = {"type": "json_object"}

    logger.info(
        "Generating outline via %s/%s (json_mode=%s)",
        binding,
        config.model,
        "response_format" in llm_kwargs,
    )

    raw = await complete(
        prompt=user_prompt,
        system_prompt=system_prompt,
        **llm_kwargs,
    )

    data = parse_json_response(raw, logger_instance=logger, fallback=None)
    if not isinstance(data, dict):
        raise OutlineGenerationError("LLM returned non-object JSON")

    outline = _build_outline(data, requirement, config.model)
    logger.info(
        "Outline %s generated with %d knowledge point(s)",
        outline.id,
        len(outline.outlines),
    )
    return outline
