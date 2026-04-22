"""Discussion-mode director + agent orchestration.

Given an outline + its generated agent cast + a conversation history,
runs a loop:

    1. Ask the director LLM who speaks next.
    2. If the answer is USER or END, yield a control event and stop.
    3. Otherwise stream the chosen agent's reply chunk-by-chunk.
    4. Append the agent's turn to history and loop back to (1).

The loop is intentionally small and explicit. We considered LangGraph
but the whole graph is just `director ↔ agent_generate` — a straight
async loop is clearer and avoids a heavyweight dep.

This module is UI-agnostic: it yields plain dict events that the SSE
router translates into `event:`/`data:` frames.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

from deeptutor.outline.models import AgentProfile, Outline
from deeptutor.outline.tutor import build_state_context
from deeptutor.services.llm import complete, stream, supports_response_format
from deeptutor.services.llm.config import get_llm_config
from deeptutor.utils.json_parser import parse_json_response

logger = logging.getLogger(__name__)

_PROMPTS_DIR = Path(__file__).parent / "prompts"

_DIRECTOR_TEMPERATURE = 0.3
_DIRECTOR_MAX_TOKENS = 80
_AGENT_TEMPERATURE = 0.6
_AGENT_MAX_TOKENS = 2400

_USER_TOKEN = "USER"
_END_TOKEN = "END"

DiscussionRole = Literal["user", "assistant"]


class DiscussionMessage(BaseModel):
    """A single message in the discussion timeline.

    `agent_id` + `agent_name` are set when the message was produced by a
    specific cast member (role == 'assistant'). They're `None` for the
    student's turns.
    """

    role: DiscussionRole
    content: str = Field(..., min_length=1)
    agent_id: str | None = Field(default=None, alias="agentId")
    agent_name: str | None = Field(default=None, alias="agentName")

    model_config = {"populate_by_name": True}


class DiscussionError(RuntimeError):
    """Raised when discussion mode can't start (e.g. no cast)."""


# --- Prompt helpers --- #


def _load_template(name: str) -> str:
    return (_PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")


def _format_cast_roster(agents: list[AgentProfile]) -> str:
    lines: list[str] = []
    for agent in agents:
        lines.append(
            f"- **{agent.id}** ({agent.role.value}): {agent.name}",
        )
        lines.append(f"  - {agent.persona}")
    return "\n".join(lines) or "(no cast)"


def _format_conversation(history: list[DiscussionMessage]) -> str:
    if not history:
        return "(no messages yet)"
    lines: list[str] = []
    for msg in history:
        if msg.role == "user":
            lines.append(f"[Student]: {msg.content}")
        else:
            name = msg.agent_name or (msg.agent_id or "AI")
            lines.append(f"[{name}]: {msg.content}")
    return "\n".join(lines)


def _peer_turns_this_round(history: list[DiscussionMessage]) -> list[DiscussionMessage]:
    """Assistant messages emitted since the most recent student turn."""
    turns: list[DiscussionMessage] = []
    for msg in reversed(history):
        if msg.role == "user":
            break
        if msg.role == "assistant":
            turns.insert(0, msg)
    return turns


def _format_peer_turns(turns: list[DiscussionMessage]) -> str:
    if not turns:
        return "(none — you will be the first to speak this round)"
    return "\n".join(
        f"- {t.agent_name or t.agent_id}: {t.content[:120].strip()}"
        + ("…" if len(t.content) > 120 else "")
        for t in turns
    )


def _build_director_user_prompt(
    outline: Outline,
    history: list[DiscussionMessage],
    current_kp_id: str | None,
) -> str:
    peer = _peer_turns_this_round(history)
    return "\n".join(
        [
            "## Classroom state",
            build_state_context(outline, current_kp_id),
            "",
            "## Cast",
            _format_cast_roster(outline.agents),
            "",
            "## Conversation history",
            _format_conversation(history),
            "",
            "## Agents who have already spoken since the last student message",
            _format_peer_turns(peer),
            "",
            "## Your decision",
            'Return one JSON object: {"next_agent": "<id>"}.',
        ]
    )


def _build_agent_system_prompt(
    agent: AgentProfile,
    outline: Outline,
    current_kp_id: str | None,
) -> str:
    template = _load_template("agent_persona_system")
    directive = outline.language_directive.strip() or (
        "Teach in the language of the course title unless overridden."
    )
    others = [a for a in outline.agents if a.id != agent.id]
    if others:
        roster = "\n".join(
            f"- **{o.name}** ({o.role.value}): {o.persona}" for o in others
        )
    else:
        roster = "(you are alone in this classroom)"

    replacements = {
        "{{agentName}}": agent.name,
        "{{agentRole}}": agent.role.value,
        "{{agentPersona}}": agent.persona,
        "{{title}}": outline.title or "Untitled course",
        "{{description}}": outline.description or "(no overview)",
        "{{languageDirective}}": directive,
        "{{stateContext}}": build_state_context(outline, current_kp_id),
        "{{castRoster}}": roster,
    }
    result = template
    for placeholder, value in replacements.items():
        result = result.replace(placeholder, value)
    return result


def _map_history_for_agent(
    agent_id: str,
    history: list[DiscussionMessage],
) -> list[dict[str, object]]:
    """Role-tag rewrite: this agent's past turns become `assistant`, all
    other turns (student + other agents) become `user`. This is how we
    convince a single LLM instance that it IS this specific character.
    """
    mapped: list[dict[str, object]] = []
    for msg in history:
        if msg.role == "user":
            mapped.append({"role": "user", "content": msg.content})
            continue
        if msg.agent_id == agent_id:
            mapped.append({"role": "assistant", "content": msg.content})
        else:
            name = msg.agent_name or msg.agent_id or "someone"
            mapped.append(
                {"role": "user", "content": f"{name}：{msg.content}"},
            )
    # Ensure the last message is a user turn — some OpenAI-compatible
    # providers reject a trailing assistant turn. The content is a
    # language-neutral ellipsis so it doesn't leak a Chinese (or any
    # specific-language) hint into non-Chinese classrooms.
    if mapped and mapped[-1]["role"] != "user":
        mapped.append({"role": "user", "content": "..."})
    return mapped


# --- Director decision --- #


async def _director_decide(
    outline: Outline,
    history: list[DiscussionMessage],
    current_kp_id: str | None,
) -> str:
    """Return one of: an agent id from the cast, `USER`, or `END`."""
    system_prompt = _load_template("director_system")
    user_prompt = _build_director_user_prompt(outline, history, current_kp_id)

    config = get_llm_config()
    binding = config.binding or "openai"

    llm_kwargs: dict[str, Any] = {
        "temperature": _DIRECTOR_TEMPERATURE,
        "max_tokens": _DIRECTOR_MAX_TOKENS,
    }
    if supports_response_format(binding, config.model):
        llm_kwargs["response_format"] = {"type": "json_object"}

    try:
        raw = await complete(
            prompt=user_prompt,
            system_prompt=system_prompt,
            **llm_kwargs,
        )
    except Exception:
        logger.exception("Director LLM call failed; defaulting to USER")
        return _USER_TOKEN

    data = parse_json_response(raw, logger_instance=logger, fallback=None)
    if not isinstance(data, dict):
        logger.warning("Director non-object output: %r — USER fallback", raw[:120])
        return _USER_TOKEN

    candidate = str(data.get("next_agent") or "").strip()
    if not candidate:
        return _USER_TOKEN

    if candidate in (_USER_TOKEN, _END_TOKEN):
        return candidate

    valid_ids = {a.id for a in outline.agents}
    if candidate not in valid_ids:
        logger.warning(
            "Director picked unknown agent %r (valid: %s) — USER fallback",
            candidate,
            valid_ids,
        )
        return _USER_TOKEN
    return candidate


# --- Agent turn (streaming) --- #


async def _stream_agent_turn(
    agent: AgentProfile,
    outline: Outline,
    history: list[DiscussionMessage],
    current_kp_id: str | None,
) -> AsyncIterator[str]:
    system_prompt = _build_agent_system_prompt(agent, outline, current_kp_id)
    messages: list[dict[str, object]] = [
        {"role": "system", "content": system_prompt},
    ]
    messages.extend(_map_history_for_agent(agent.id, history))

    async for chunk in stream(
        prompt="",
        messages=messages,
        temperature=_AGENT_TEMPERATURE,
        max_tokens=_AGENT_MAX_TOKENS,
    ):
        if chunk:
            yield chunk


# --- Public entry: the director loop --- #


async def run_discussion(
    outline: Outline,
    history: list[DiscussionMessage],
    current_kp_id: str | None = None,
    max_turns: int = 6,
) -> AsyncIterator[dict[str, Any]]:
    """Orchestrate a single request/response cycle of discussion mode.

    Yields plain dicts; the caller translates them into SSE frames.

    Event types produced:
        {"type": "director_thinking"}
        {"type": "agent_start", "agent": {...profile...}}
        {"type": "agent_chunk", "agentId": "...", "content": "..."}
        {"type": "agent_end",   "agentId": "..."}
        {"type": "cue_user"}
        {"type": "end"}
    """
    if not outline.agents:
        raise DiscussionError(
            "outline has no agent cast — cannot run discussion mode",
        )
    if not history:
        raise DiscussionError(
            "history is empty — discussion mode needs prior context",
        )

    # Work on a local copy so we don't mutate the caller's list.
    transcript: list[DiscussionMessage] = list(history)
    agents_by_id = {a.id: a for a in outline.agents}

    for _ in range(max_turns):
        yield {"type": "director_thinking"}
        decision = await _director_decide(outline, transcript, current_kp_id)

        if decision == _END_TOKEN:
            yield {"type": "end"}
            return
        if decision == _USER_TOKEN:
            yield {"type": "cue_user"}
            return

        agent = agents_by_id.get(decision)
        if agent is None:
            # Shouldn't happen — director_decide already validates.
            yield {"type": "cue_user"}
            return

        yield {
            "type": "agent_start",
            "agent": agent.model_dump(by_alias=True, mode="json"),
        }

        buffer = ""
        try:
            async for chunk in _stream_agent_turn(
                agent, outline, transcript, current_kp_id,
            ):
                buffer += chunk
                yield {
                    "type": "agent_chunk",
                    "agentId": agent.id,
                    "content": chunk,
                }
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Agent stream failed for %s mid-turn", agent.id,
            )
            yield {"type": "agent_end", "agentId": agent.id}
            # Don't surface as a hard error — just cue the user so the
            # session stays usable.
            yield {"type": "error", "message": f"{agent.name} 发言被中断：{exc}"}
            yield {"type": "cue_user"}
            return

        yield {"type": "agent_end", "agentId": agent.id}

        if not buffer.strip():
            # Empty reply is useless; don't keep it, hand off to user.
            yield {"type": "cue_user"}
            return

        transcript.append(
            DiscussionMessage(
                role="assistant",
                content=buffer,
                agent_id=agent.id,
                agent_name=agent.name,
            )
        )

    # Hit the max-turns safety cap without the director saying USER.
    yield {"type": "cue_user"}
