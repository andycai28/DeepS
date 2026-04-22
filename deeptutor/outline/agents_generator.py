"""LLM-driven generation of the discussion-mode cast.

Given an `Outline`, asks the LLM to produce 3 AgentProfile entries
(teacher / classmate / inquirer) tailored to the course. Falls back to
hard-coded defaults when the LLM output is unusable so the frontend
always has a cast to render.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from deeptutor.outline.models import AgentProfile, AgentRole, Outline
from deeptutor.services.llm import complete, supports_response_format
from deeptutor.services.llm.config import get_llm_config
from deeptutor.utils.json_parser import parse_json_response

logger = logging.getLogger(__name__)

_PROMPTS_DIR = Path(__file__).parent / "prompts"
_AGENT_PROFILES_TEMPLATE = "agent_profiles_system"
_DEFAULT_TEMPERATURE = 0.7  # some creative flair on personas
_DEFAULT_MAX_TOKENS = 1500

# Palette defaults — match the suggestions inside the prompt.
_DEFAULT_PALETTE: dict[AgentRole, str] = {
    AgentRole.TEACHER: "#B0501E",
    AgentRole.CLASSMATE: "#2563eb",
    AgentRole.INQUIRER: "#16a34a",
}

# Stable ids so the discussion router can look agents up by role.
_ROLE_IDS: dict[AgentRole, str] = {
    AgentRole.TEACHER: "agent_teacher",
    AgentRole.CLASSMATE: "agent_classmate",
    AgentRole.INQUIRER: "agent_inquirer",
}

# Minimal fallback cast (Chinese, neutral) when the LLM output can't be
# validated. Keeps discussion mode usable even on degraded LLM outputs.
_FALLBACK_NAMES: dict[AgentRole, str] = {
    AgentRole.TEACHER: "王老师",
    AgentRole.CLASSMATE: "安妮",
    AgentRole.INQUIRER: "小明",
}

_FALLBACK_PERSONAS: dict[AgentRole, str] = {
    AgentRole.TEACHER: "沉稳耐心的资深教师，讲解时先打比方再回到定义。说话节奏平缓，擅长把复杂概念拆小了喂。",
    AgentRole.CLASSMATE: "热情开朗的进阶同学，喜欢举课堂外的例子佐证知识点。常用「我之前看到过…」开头关联现实场景。",
    AgentRole.INQUIRER: "好奇心旺盛但不唱反调的同学，擅长提出具体而精巧的问题。总爱追问「那如果是 X 情况呢？」把边界推清楚。",
}


class AgentGenerationError(RuntimeError):
    """Raised when the LLM output truly can't be coerced into any cast."""


def _load_prompt(name: str) -> str:
    return (_PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")


def _render_user_prompt(outline: Outline) -> str:
    """The user message carries the course context we want the LLM to stylise for."""
    lines = [
        "## Course",
        f"Title: {outline.title}",
        f"Description: {outline.description or '(no overview)'}",
        f"Language directive: {outline.language_directive or '(defer to the title)'}",
        "",
        "## Knowledge point titles",
    ]
    if outline.outlines:
        for kp in outline.outlines:
            lines.append(f"- {kp.order}. {kp.title}")
    else:
        lines.append("(none)")
    lines.extend(
        [
            "",
            "Design the three-character cast (teacher / classmate / inquirer) "
            "for this course. Output only the JSON object described in the "
            "system prompt.",
        ]
    )
    return "\n".join(lines)


def _default_initial(name: str) -> str:
    if not name:
        return "?"
    # Chinese names: pick the *given* name's first char if there's a surname.
    # Heuristic: if the name is 2-3 CJK chars, prefer index 1; otherwise use index 0.
    cjk_ratio = sum(1 for ch in name if "一" <= ch <= "鿿") / len(name)
    if cjk_ratio >= 0.5 and len(name) >= 2:
        return name[1]
    return name[0].upper()


def _fallback_profile(role: AgentRole) -> AgentProfile:
    name = _FALLBACK_NAMES[role]
    return AgentProfile(
        id=_ROLE_IDS[role],
        role=role,
        name=name,
        persona=_FALLBACK_PERSONAS[role],
        color=_DEFAULT_PALETTE[role],
        avatar_initial=_default_initial(name),
    )


def _coerce_profile(
    raw: dict[str, Any],
    expected_role: AgentRole,
) -> AgentProfile | None:
    """Normalise raw LLM output for one agent slot into a validated profile.

    Missing/invalid fields are filled from defaults instead of failing — we
    want a usable cast even when the LLM is slightly off.
    """
    if not isinstance(raw, dict):
        return None

    name = str(raw.get("name") or "").strip() or _FALLBACK_NAMES[expected_role]
    persona = str(raw.get("persona") or "").strip() or _FALLBACK_PERSONAS[expected_role]
    color = str(raw.get("color") or "").strip() or _DEFAULT_PALETTE[expected_role]
    initial = (
        str(raw.get("avatarInitial") or raw.get("avatar_initial") or "").strip()
        or _default_initial(name)
    )

    payload = {
        "id": _ROLE_IDS[expected_role],
        "role": expected_role,
        "name": name,
        "persona": persona,
        "color": color,
        "avatarInitial": initial[:2],  # guard against multi-char initials
    }
    try:
        return AgentProfile.model_validate(payload)
    except ValidationError as exc:
        logger.warning("Skipping invalid agent profile %s: %s", expected_role, exc)
        return None


def _parse_cast(data: dict[str, Any]) -> list[AgentProfile]:
    raw_agents = data.get("agents")
    if not isinstance(raw_agents, list):
        raise AgentGenerationError("LLM response missing `agents` array")

    # Index the LLM output by role, tolerant of any id/role drift.
    by_role: dict[AgentRole, dict[str, Any]] = {}
    for entry in raw_agents:
        if not isinstance(entry, dict):
            continue
        raw_role = str(entry.get("role") or "").lower()
        try:
            role = AgentRole(raw_role)
        except ValueError:
            # Fall back to matching by id if the role field is weird.
            raw_id = str(entry.get("id") or "").lower()
            matched_role = next(
                (role for role, rid in _ROLE_IDS.items() if rid == raw_id),
                None,
            )
            if matched_role is None:
                continue
            role = matched_role
        by_role.setdefault(role, entry)

    cast: list[AgentProfile] = []
    for role in (AgentRole.TEACHER, AgentRole.CLASSMATE, AgentRole.INQUIRER):
        raw = by_role.get(role)
        profile = _coerce_profile(raw, role) if raw else None
        cast.append(profile or _fallback_profile(role))
    return cast


async def generate_agent_profiles(outline: Outline) -> list[AgentProfile]:
    """Produce the 3-character cast for discussion mode.

    Always returns exactly 3 profiles (teacher/classmate/inquirer). If the
    LLM call or parse fails, returns a neutral fallback cast so the
    frontend can always render *something*.
    """
    system_prompt = _load_prompt(_AGENT_PROFILES_TEMPLATE)
    user_prompt = _render_user_prompt(outline)

    config = get_llm_config()
    binding = config.binding or "openai"

    llm_kwargs: dict[str, Any] = {
        "temperature": _DEFAULT_TEMPERATURE,
        "max_tokens": _DEFAULT_MAX_TOKENS,
    }
    if supports_response_format(binding, config.model):
        llm_kwargs["response_format"] = {"type": "json_object"}

    logger.info(
        "Generating agent profiles for outline=%s via %s/%s",
        outline.id,
        binding,
        config.model,
    )

    try:
        raw = await complete(
            prompt=user_prompt,
            system_prompt=system_prompt,
            **llm_kwargs,
        )
    except Exception:
        logger.exception("LLM call for agent profiles failed; using fallback cast")
        return [_fallback_profile(role) for role in _ROLE_IDS]

    data = parse_json_response(raw, logger_instance=logger, fallback=None)
    if not isinstance(data, dict):
        logger.warning("Agent profiles: LLM returned non-object JSON; using fallback")
        return [_fallback_profile(role) for role in _ROLE_IDS]

    try:
        return _parse_cast(data)
    except AgentGenerationError as exc:
        logger.warning("Agent profile parse failed (%s); using fallback", exc)
        return [_fallback_profile(role) for role in _ROLE_IDS]
