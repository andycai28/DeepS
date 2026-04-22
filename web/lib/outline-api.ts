/**
 * Outline API client.
 *
 * Phase 2 MVP: returns mock data after a short delay. The component flow
 * (input → await → redirect) is real; only the generation is stubbed.
 * Swap the body of `generateOutline` for a real `fetch` once the backend
 * endpoint `POST /api/v1/outline/generate` lands in Phase 1.5.
 */

import type {
  GenerateOutlineRequest,
  KnowledgePoint,
  Outline,
} from "@/lib/types/outline";

const MOCK_DELAY_MS = 1500;

function makeOutlineId(): string {
  return `ol-${Math.random().toString(36).slice(2, 10)}`;
}

function mockKnowledgePoints(seed: string): KnowledgePoint[] {
  const points = [
    {
      title: `${seed} — 入门总览`,
      description: "建立整体直觉，明确我们要学什么、为什么重要。",
      keyPoints: [
        "能用一句话解释核心概念",
        "知道它在哪些场景会用到",
        "区分它和相近概念的差异",
      ],
      objective: "学完能向朋友简短介绍这个主题",
      duration: 300,
    },
    {
      title: "关键术语与基本结构",
      description: "拆解核心术语，建立结构化理解。",
      keyPoints: ["识别 3-5 个核心术语", "理解术语之间的关系", "画出主题骨架图"],
      objective: "学完能独立梳理出主题的骨架",
      duration: 420,
    },
    {
      title: "常见误区与经典例子",
      description: "通过对比案例避免把握偏差。",
      keyPoints: ["列举 2 个常见误解", "给出反例加以澄清", "给出一个经典应用例"],
      objective: "学完能判断身边的例子是否符合主题要求",
      duration: 360,
    },
  ];

  return points.map((p, idx) => ({
    id: `kp_${idx + 1}`,
    order: idx + 1,
    title: p.title,
    description: p.description,
    keyPoints: p.keyPoints,
    teachingObjective: p.objective,
    estimatedDuration: p.duration,
    languageNote: null,
  }));
}

export async function generateOutline(
  payload: GenerateOutlineRequest,
): Promise<Outline> {
  await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));

  const now = new Date().toISOString();
  const topic = payload.requirement.trim();
  const title = topic.length > 30 ? `${topic.slice(0, 30)}…` : topic || "示例课程";

  return {
    id: makeOutlineId(),
    title,
    description: "（mock 数据 — Phase 1.5 接入真实 LLM 后替换）",
    languageDirective: "Teach in Chinese using plain language and gentle scaffolding.",
    source: {
      type: "topic",
      topic,
      documentRefs: [],
    },
    outlines: mockKnowledgePoints(title),
    metadata: {
      createdAt: now,
      updatedAt: now,
      llmModel: "mock",
      schemaVersion: 1,
    },
  };
}
