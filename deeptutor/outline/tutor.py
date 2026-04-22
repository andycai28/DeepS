"""Outline-driven tutor chat.

Given a persisted Outline + a chat history, generate the next teacher
response. When the history is empty, the teacher produces a course
opening (see `teacher_system.md`'s "first turn" instructions).

The system prompt is built from the teacher prompt template with the
outline's title, description, languageDirective, and knowledge-point
list interpolated in. Students should never see these internals.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from deeptutor.outline.models import KnowledgePoint, Outline
from deeptutor.services.llm import complete
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


def _format_knowledge_point_list(points: list[KnowledgePoint]) -> str:
    """Render KPs as a compact numbered list for inclusion in the system prompt."""
    if not points:
        return "(no knowledge points provided)"

    lines: list[str] = []
    for kp in points:
        header = f"{kp.order}. **{kp.title}**"
        if kp.description:
            header += f" — {kp.description}"
        lines.append(header)
        if kp.teaching_objective:
            lines.append(f"   - *Objective*: {kp.teaching_objective}")
        for req in kp.key_points:
            lines.append(f"   - {req}")
    return "\n".join(lines)


def _build_system_prompt(outline: Outline) -> str:
    template = _load_template(_TEACHER_SYSTEM_TEMPLATE)
    directive = outline.language_directive.strip() or (
        "Teach in the language of the course title unless overridden."
    )
    return (
        template.replace("{{title}}", outline.title or "Untitled course")
        .replace("{{description}}", outline.description or "(no overview)")
        .replace("{{languageDirective}}", directive)
        .replace("{{knowledgePointList}}", _format_knowledge_point_list(outline.outlines))
    )


def _build_messages(
    outline: Outline,
    history: list[ChatMessage],
) -> list[dict[str, object]]:
    system_prompt = _build_system_prompt(outline)
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
) -> str:
    """Produce the next teacher response given the outline and prior turns."""
    messages = _build_messages(outline, history)

    config = get_llm_config()
    binding = config.binding or "openai"

    logger.info(
        "Tutor reply for outline=%s turn=%d binding=%s/%s",
        outline.id,
        len(history),
        binding,
        config.model,
    )

    return await complete(
        prompt="",  # ignored when `messages` is provided
        messages=messages,
        temperature=_DEFAULT_TEMPERATURE,
        max_tokens=_DEFAULT_MAX_TOKENS,
    )
