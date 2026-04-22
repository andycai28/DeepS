"""Outline API router.

Mounted at /api/v1/outline (see deeptutor/api/main.py include_router).
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from deeptutor.outline import storage
from deeptutor.outline.agents_generator import generate_agent_profiles
from deeptutor.outline.generator import OutlineGenerationError, stream_outline
from deeptutor.outline.models import Outline
from deeptutor.outline.tutor import ChatMessage, stream_tutor_reply

logger = logging.getLogger(__name__)
router = APIRouter()


class GenerateOutlineRequest(BaseModel):
    """POST /generate body."""

    requirement: str = Field(..., min_length=1, max_length=4000)
    persist: bool = True


class StudyChatRequest(BaseModel):
    """POST /{outline_id}/chat body."""

    model_config = {"populate_by_name": True}

    history: list[ChatMessage] = Field(default_factory=list)
    current_kp_id: str | None = Field(default=None, alias="currentKpId")


def _load_outline_or_404(outline_id: str):
    try:
        return storage.load(outline_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"outline {outline_id} not found") from exc


def _sse_event(event_name: str, data: dict[str, Any]) -> str:
    """Format a single Server-Sent Event frame."""
    payload = json.dumps(data, ensure_ascii=False, default=str)
    return f"event: {event_name}\ndata: {payload}\n\n"


@router.post("/generate")
async def post_generate_outline(
    request: GenerateOutlineRequest,
) -> StreamingResponse:
    """Stream outline generation as Server-Sent Events.

    Event shapes:
        event: courseTitle
        data: {"value": "..."}

        event: courseDescription
        data: {"value": "..."}

        event: languageDirective
        data: {"value": "..."}

        event: kp
        data: {<KnowledgePoint camelCase JSON>}

        event: done
        data: {"outline": {<full Outline JSON>}}

        event: error
        data: {"message": "..."}

    Persists the assembled outline to data/user/outlines/{id}.json on the
    `done` frame (unless `persist=false` in the request body).
    """

    async def event_stream() -> AsyncIterator[str]:
        try:
            outline: Outline | None = None
            async for event in stream_outline(request.requirement):
                event_type = event["type"]
                if event_type == "done":
                    outline = event["outline"]
                    # Outline is complete — now generate the discussion-mode
                    # cast before we emit `done`, so the frontend receives
                    # agents as a separate event in-stream and the final
                    # outline already carries them.
                    try:
                        agents = await generate_agent_profiles(outline)
                        outline.agents = agents
                        for profile in agents:
                            yield _sse_event(
                                "agent",
                                profile.model_dump(by_alias=True, mode="json"),
                            )
                    except Exception:
                        logger.exception(
                            "Agent-profile generation failed for outline=%s",
                            outline.id,
                        )
                    if request.persist:
                        try:
                            storage.save(outline)
                        except Exception:
                            logger.exception(
                                "Failed to persist outline %s", outline.id,
                            )
                    yield _sse_event(
                        "done",
                        {"outline": outline.model_dump(by_alias=True, mode="json")},
                    )
                elif event_type == "kp":
                    yield _sse_event("kp", event["data"])
                else:
                    # courseTitle / courseDescription / languageDirective
                    yield _sse_event(event_type, {"value": event["value"]})
        except OutlineGenerationError as exc:
            logger.warning("Outline stream failed (bad LLM output): %s", exc)
            yield _sse_event("error", {"message": str(exc)})
        except Exception as exc:  # noqa: BLE001
            logger.exception("Outline stream crashed")
            yield _sse_event("error", {"message": str(exc)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("/{outline_id}")
async def get_outline(outline_id: str) -> dict[str, Any]:
    """Fetch a persisted outline. Used by the study page when the tab's
    sessionStorage doesn't hold it (reloads, direct-link opens, etc.)."""
    outline = _load_outline_or_404(outline_id)
    return outline.model_dump(by_alias=True, mode="json")


@router.post("/{outline_id}/chat")
async def post_study_chat(
    outline_id: str,
    request: StudyChatRequest,
) -> StreamingResponse:
    """Produce the next tutor reply as a Server-Sent Events stream.

    Event shape:
      event: chunk
      data: {"content": "...token..."}

      event: done
      data: {"isOpening": true|false}

      event: error
      data: {"message": "..."}

    If `history` is empty, the tutor opens the class with a welcome message
    grounded in the outline. Otherwise the tutor responds to the latest
    student turn, keeping the full outline available as system context.
    """
    outline = _load_outline_or_404(outline_id)
    is_opening = len(request.history) == 0

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for chunk in stream_tutor_reply(
                outline,
                request.history,
                current_kp_id=request.current_kp_id,
            ):
                yield _sse_event("chunk", {"content": chunk})
            yield _sse_event("done", {"isOpening": is_opening})
        except Exception as exc:  # noqa: BLE001
            logger.exception("Tutor stream failed for outline=%s", outline_id)
            yield _sse_event("error", {"message": str(exc)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
