"""Outline API router.

Mounted at /api/v1/outline (see deeptutor/api/main.py include_router).
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from deeptutor.outline import storage
from deeptutor.outline.generator import OutlineGenerationError, generate_outline
from deeptutor.outline.tutor import ChatMessage, generate_tutor_reply

logger = logging.getLogger(__name__)
router = APIRouter()


class GenerateOutlineRequest(BaseModel):
    """POST /generate body."""

    requirement: str = Field(..., min_length=1, max_length=4000)
    persist: bool = True


class StudyChatRequest(BaseModel):
    """POST /{outline_id}/chat body."""

    history: list[ChatMessage] = Field(default_factory=list)


class StudyChatResponse(BaseModel):
    model_config = {"populate_by_name": True}

    reply: str
    is_opening: bool = Field(..., alias="isOpening")


def _load_outline_or_404(outline_id: str):
    try:
        return storage.load(outline_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"outline {outline_id} not found") from exc


@router.post("/generate")
async def post_generate_outline(request: GenerateOutlineRequest) -> dict[str, Any]:
    """Generate an Outline from a free-form user requirement.

    On success persists to data/user/outlines/{id}.json (unless persist=False)
    and returns the full outline serialized with camelCase aliases so the
    frontend contract matches web/lib/types/outline.ts exactly.
    """
    try:
        outline = await generate_outline(request.requirement)
    except OutlineGenerationError as exc:
        logger.warning("Outline generation failed (bad LLM output): %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 — surface unexpected errors to client
        logger.exception("Outline generation crashed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if request.persist:
        try:
            storage.save(outline)
        except Exception:
            logger.exception("Failed to persist outline %s", outline.id)

    return outline.model_dump(by_alias=True, mode="json")


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
) -> dict[str, Any]:
    """Produce the next tutor reply for this study session.

    If `history` is empty, the tutor opens the class with a welcome message
    grounded in the outline. Otherwise the tutor responds to the latest
    student turn, keeping the full outline available as system context.
    """
    outline = _load_outline_or_404(outline_id)
    try:
        reply = await generate_tutor_reply(outline, request.history)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Tutor reply failed for outline=%s", outline_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    response = StudyChatResponse(reply=reply, is_opening=len(request.history) == 0)
    return response.model_dump(by_alias=True, mode="json")
