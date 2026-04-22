"""Outline engine — 生成平铺知识点大纲，驱动 Chat 侧边栏与多 Agent 舞台剧。

参考 OpenMAIC `lib/generation/` 的 SceneOutline 设计，去除场景排版字段，
只保留教材级知识点元数据。
"""

from deeptutor.outline.models import (
    AgentProfile,
    AgentRole,
    KnowledgePoint,
    Outline,
    OutlineMetadata,
    OutlineSource,
    OutlineSourceType,
)

__all__ = [
    "AgentProfile",
    "AgentRole",
    "KnowledgePoint",
    "Outline",
    "OutlineMetadata",
    "OutlineSource",
    "OutlineSourceType",
]
