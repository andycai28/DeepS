"""LLM-powered outline generation (streaming + blocking).

The LLM is asked to return a single JSON object:
    {
      "courseTitle": "...",
      "courseDescription": "...",
      "languageDirective": "...",
      "outlines": [ {kp_1}, {kp_2}, ... ]
    }

Two entry points:
    * `generate_outline` — blocks until the full JSON is parsed (used for CLI
      / tests / any caller that just wants the final Outline).
    * `stream_outline` — an async generator that yields events as the LLM
      emits tokens, so the frontend can render KPs one by one. The partial
      JSON parsing mirrors OpenMAIC's approach (brace-counter on the
      `outlines` array, regex for the string fields that precede it).
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from deeptutor.outline.models import (
    KnowledgePoint,
    Outline,
    OutlineMetadata,
    OutlineSource,
    OutlineSourceType,
)
from deeptutor.services.llm import complete, stream, supports_response_format
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


# --- Partial-JSON utilities (port of OpenMAIC's route.ts logic) --- #


_STRING_FIELD_CACHE: dict[str, re.Pattern[str]] = {}


def _string_field_pattern(field: str) -> re.Pattern[str]:
    pattern = _STRING_FIELD_CACHE.get(field)
    if pattern is None:
        pattern = re.compile(
            rf'"{re.escape(field)}"\s*:\s*"((?:[^"\\]|\\.)*)"',
            re.DOTALL,
        )
        _STRING_FIELD_CACHE[field] = pattern
    return pattern


def _extract_string_field(buffer: str, field: str) -> str | None:
    """Return the value of a top-level string field from a partial JSON
    buffer, or None if the field hasn't finished streaming yet.

    Uses a tolerant regex that honours `\\"` escapes inside the value.
    """
    match = _string_field_pattern(field).search(buffer)
    if not match:
        return None
    # Wrap the matched body back into a JSON string so escapes decode.
    try:
        return json.loads(f'"{match.group(1)}"')
    except json.JSONDecodeError:
        return None


def _extract_new_outlines(buffer: str, already_parsed: int) -> list[dict[str, Any]]:
    """Scan `buffer` and return outline objects past the `already_parsed`
    index that have closed cleanly.

    Brace-counts through the `outlines` array, tolerating strings and
    `\\"` escapes. Silently skips incomplete / invalid objects.
    """
    if not buffer:
        return []

    # Anchor at the first `[` following `"outlines"`, or the first `[`
    # anywhere if there's no such key (flat-array fallback).
    key_idx = buffer.find('"outlines"')
    if key_idx >= 0:
        array_start = buffer.find("[", key_idx)
    else:
        array_start = buffer.find("[")
    if array_start < 0:
        return []

    results: list[dict[str, Any]] = []
    depth = 0
    object_start = -1
    in_string = False
    escaped = False
    object_count = 0

    i = array_start + 1
    n = len(buffer)
    while i < n:
        char = buffer[i]

        if escaped:
            escaped = False
            i += 1
            continue
        if char == "\\" and in_string:
            escaped = True
            i += 1
            continue
        if char == '"':
            in_string = not in_string
            i += 1
            continue
        if in_string:
            i += 1
            continue

        if char == "{":
            if depth == 0:
                object_start = i
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0 and object_start >= 0:
                object_count += 1
                if object_count > already_parsed:
                    try:
                        results.append(json.loads(buffer[object_start : i + 1]))
                    except json.JSONDecodeError:
                        # Incomplete or invalid — skip.
                        pass
                object_start = -1
        i += 1

    return results


# --- Final-object assembly (shared between blocking + streaming paths) --- #


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


def _validate_kp(raw: dict[str, Any], order: int) -> KnowledgePoint | None:
    """Promote a raw JSON object into a validated KnowledgePoint, filling
    in `order` / `id` if the LLM omitted them. Returns None on failure."""
    raw.setdefault("order", order)
    raw.setdefault("id", f"kp_{order}")
    try:
        return KnowledgePoint.model_validate(raw)
    except ValidationError as exc:
        logger.warning("Dropping invalid KP at order=%d: %s", order, exc)
        return None


# --- Public API: blocking + streaming --- #


async def generate_outline(requirement: str) -> Outline:
    """Generate an Outline from a free-form requirement string (blocking).

    Kept for callers that want the final object in one shot (tests, CLI,
    non-UI code). The /generate API route uses `stream_outline` instead.
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


async def stream_outline(requirement: str) -> AsyncIterator[dict[str, Any]]:
    """Stream an Outline as the LLM produces it.

    Event dicts yielded (in typical order):
        {"type": "courseTitle",        "value": "..."}
        {"type": "courseDescription",  "value": "..."}
        {"type": "languageDirective",  "value": "..."}
        {"type": "kp",                 "data":  {<KnowledgePoint as camelCase JSON>}}
        ... more kp events ...
        {"type": "done",               "outline": <Outline instance>}

    Meta events (title / description / languageDirective) fire the first
    moment the field finishes streaming. `kp` events fire as each object
    in the `outlines` array closes. `done` fires after the stream ends,
    carrying the fully-assembled Outline.

    Raises `OutlineGenerationError` if the stream produces no parseable
    knowledge points.
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
        "Streaming outline via %s/%s (json_mode=%s)",
        binding,
        config.model,
        "response_format" in llm_kwargs,
    )

    buffer = ""
    emitted_title = False
    emitted_description = False
    emitted_language_directive = False
    parsed_count = 0
    validated_kps: list[KnowledgePoint] = []

    course_title: str | None = None
    course_description: str | None = None
    language_directive: str | None = None

    async for chunk in stream(
        prompt=user_prompt,
        system_prompt=system_prompt,
        **llm_kwargs,
    ):
        if not chunk:
            continue
        buffer += chunk

        if not emitted_title:
            value = _extract_string_field(buffer, "courseTitle")
            if value:
                course_title = value
                emitted_title = True
                yield {"type": "courseTitle", "value": value}
        if not emitted_description:
            value = _extract_string_field(buffer, "courseDescription")
            if value:
                course_description = value
                emitted_description = True
                yield {"type": "courseDescription", "value": value}
        if not emitted_language_directive:
            value = _extract_string_field(buffer, "languageDirective")
            if value:
                language_directive = value
                emitted_language_directive = True
                yield {"type": "languageDirective", "value": value}

        new_entries = _extract_new_outlines(buffer, parsed_count)
        for raw_kp in new_entries:
            parsed_count += 1
            if not isinstance(raw_kp, dict):
                continue
            kp = _validate_kp(raw_kp, parsed_count)
            if kp is None:
                continue
            validated_kps.append(kp)
            yield {
                "type": "kp",
                "data": kp.model_dump(by_alias=True, mode="json"),
            }

    if not validated_kps:
        raise OutlineGenerationError(
            "LLM stream produced no parseable knowledge points",
        )

    outline = Outline(
        title=(course_title or "").strip() or requirement[:40],
        description=(course_description or "").strip(),
        language_directive=(language_directive or "").strip(),
        source=OutlineSource(type=OutlineSourceType.TOPIC, topic=requirement),
        outlines=validated_kps,
        metadata=OutlineMetadata(llm_model=config.model),
    )

    logger.info(
        "Outline %s streamed with %d knowledge point(s)",
        outline.id,
        len(outline.outlines),
    )

    yield {"type": "done", "outline": outline}
