"""Outline-driven tutor chat.

Given a persisted Outline + a chat history + an optional `current_kp_id`,
produce the next teacher reply. When history is empty, the teacher opens
the class; when a `current_kp_id` is provided, the system prompt's State
section pivots to that knowledge point while keeping a brief list of the
other knowledge points for global awareness.

Mirrors OpenMAIC's `buildStateContext` pattern: a short overview of all
scenes + full details for the currently-focused one.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from deeptutor.outline.models import KnowledgePoint, Outline
from deeptutor.services.llm import complete, stream
from deeptutor.services.llm.config import get_llm_config

logger = logging.getLogger(__name__)

_PROMPTS_DIR = Path(__file__).parent / "prompts"
_TEACHER_SYSTEM_TEMPLATE = "teacher_system"

# synthetic first-turn trigger — student never types this
SESSION_START_TRIGGER = "[session_start]"

_DEFAULT_TEMPERATURE = 0.6
_DEFAULT_MAX_TOKENS = 4000


ChatRole = Literal["user", "assistant"]


class ChatMessage(BaseModel):
    role: ChatRole
    content: str = Field(..., min_length=1)


def _load_template(name: str) -> str:
    return (_PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")


def _find_kp(outline: Outline, kp_id: str | None) -> KnowledgePoint | None:
    if not kp_id:
        return None
    return next((kp for kp in outline.outlines if kp.id == kp_id), None)


def _format_overview_line(kp: KnowledgePoint) -> str:
    return f"  {kp.order}. {kp.title} (id: {kp.id})"


def build_state_context(
    outline: Outline,
    current_kp_id: str | None,
) -> str:
    """Render the dynamic `## State` section embedded in the system prompt.

    Matches OpenMAIC's pattern: one focused section with full details for
    the current KP, plus a brief overview of every KP for global awareness.
    """
    lines: list[str] = [f"Total knowledge points: {len(outline.outlines)}"]

    current_kp = _find_kp(outline, current_kp_id)

    if current_kp is not None:
        lines.append("")
        lines.append(
            f'Current focus: "{current_kp.title}" (id: {current_kp.id})'
        )
        if current_kp.description:
            lines.append(f"  Description: {current_kp.description}")
        if current_kp.teaching_objective:
            lines.append(f"  Teaching objective: {current_kp.teaching_objective}")
        if current_kp.key_points:
            lines.append("  Student should be able to:")
            for req in current_kp.key_points:
                lines.append(f"  - {req}")
    else:
        lines.append("")
        lines.append(
            "No current focus yet — the student is browsing the course.",
        )

    lines.append("")
    lines.append("All knowledge points (overview):")
    if outline.outlines:
        for kp in outline.outlines:
            lines.append(_format_overview_line(kp))
    else:
        lines.append("  (no knowledge points defined)")

    return "\n".join(lines)


def _build_system_prompt(outline: Outline, current_kp_id: str | None) -> str:
    template = _load_template(_TEACHER_SYSTEM_TEMPLATE)
    directive = outline.language_directive.strip() or (
        "Teach in the language of the course title unless overridden."
    )
    return (
        template.replace("{{title}}", outline.title or "Untitled course")
        .replace("{{description}}", outline.description or "(no overview)")
        .replace("{{languageDirective}}", directive)
        .replace("{{stateContext}}", build_state_context(outline, current_kp_id))
    )


def _build_messages(
    outline: Outline,
    history: list[ChatMessage],
    current_kp_id: str | None,
) -> list[dict[str, object]]:
    system_prompt = _build_system_prompt(outline, current_kp_id)
    messages: list[dict[str, object]] = [
        {"role": "system", "content": system_prompt},
    ]

    for msg in history:
        messages.append({"role": msg.role, "content": msg.content})

    # Empty history → inject a trigger so the model has something to respond to.
    # The system prompt instructs it to produce a course opening in this case.
    if not history:
        messages.append({"role": "user", "content": SESSION_START_TRIGGER})

    return messages


async def generate_tutor_reply(
    outline: Outline,
    history: list[ChatMessage],
    current_kp_id: str | None = None,
) -> str:
    """Produce the next teacher response.

    Args:
        outline: The persisted syllabus.
        history: Prior chat turns between the student and tutor.
        current_kp_id: Optional id of the knowledge point the student has
            selected in the sidebar. When provided and valid, its full
            details flood the State section; otherwise State contains only
            the overview list.
    """
    messages = _build_messages(outline, history, current_kp_id)

    config = get_llm_config()
    binding = config.binding or "openai"

    logger.info(
        "Tutor reply for outline=%s turn=%d focus=%s binding=%s/%s",
        outline.id,
        len(history),
        current_kp_id or "-",
        binding,
        config.model,
    )

    return await complete(
        prompt="",  # ignored when `messages` is provided
        messages=messages,
        temperature=_DEFAULT_TEMPERATURE,
        max_tokens=_DEFAULT_MAX_TOKENS,
    )


async def stream_tutor_reply(
    outline: Outline,
    history: list[ChatMessage],
    current_kp_id: str | None = None,
) -> AsyncIterator[str]:
    """Stream the tutor's next reply token-by-token.

    Same inputs as `generate_tutor_reply`, but yields string chunks as the
    LLM produces them so the frontend can render progressively.
    """
    messages = _build_messages(outline, history, current_kp_id)

    config = get_llm_config()
    binding = config.binding or "openai"

    logger.info(
        "Tutor stream for outline=%s turn=%d focus=%s binding=%s/%s",
        outline.id,
        len(history),
        current_kp_id or "-",
        binding,
        config.model,
    )

    async for chunk in stream(
        prompt="",  # ignored when `messages` is provided
        messages=messages,
        temperature=_DEFAULT_TEMPERATURE,
        max_tokens=_DEFAULT_MAX_TOKENS,
    ):
        if chunk:
            yield chunk
