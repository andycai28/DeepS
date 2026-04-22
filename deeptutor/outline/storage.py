"""Outline 持久化 — JSON 文件读写到 data/user/outlines/{id}.json。"""

from __future__ import annotations

from pathlib import Path

from deeptutor.outline.models import Outline
from deeptutor.services.path_service import PathService


def _outlines_dir() -> Path:
    path = PathService.get_instance().user_data_dir / "outlines"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _path_for(outline_id: str) -> Path:
    return _outlines_dir() / f"{outline_id}.json"


def save(outline: Outline) -> Path:
    """写入大纲；同时刷新 updated_at。"""
    outline.touch()
    path = _path_for(outline.id)
    path.write_text(
        outline.model_dump_json(by_alias=True, indent=2),
        encoding="utf-8",
    )
    return path


def load(outline_id: str) -> Outline:
    """按 ID 加载；ID 不存在时抛 FileNotFoundError。"""
    return Outline.model_validate_json(_path_for(outline_id).read_text(encoding="utf-8"))


def list_ids() -> list[str]:
    return sorted(p.stem for p in _outlines_dir().glob("*.json"))


def delete(outline_id: str) -> bool:
    path = _path_for(outline_id)
    if not path.exists():
        return False
    path.unlink()
    return True
