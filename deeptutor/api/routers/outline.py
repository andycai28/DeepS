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

logger = logging.getLogger(__name__)
router = APIRouter()


class GenerateOutlineRequest(BaseModel):
    """POST /generate body."""

    requirement: str = Field(..., min_length=1, max_length=4000)
    persist: bool = True


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
            # Persistence failure shouldn't block the response; log and continue.
            logger.exception("Failed to persist outline %s", outline.id)

    return outline.model_dump(by_alias=True, mode="json")
