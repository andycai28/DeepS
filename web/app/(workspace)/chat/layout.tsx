"use client";

import { useState } from "react";

import OutlineSidebar from "@/components/study/OutlineSidebar";
import type { Outline } from "@/lib/types/outline";

// TODO(phase-5): replace this placeholder with the outline fetched via
// session metadata (outline_id + current_kp_id propagated through chat
// context). This is mock data so the route's shell is testable.
const MOCK_OUTLINE: Outline = {
  id: "mock",
  title: "模拟课程：傅立叶变换入门",
  description: "临时 mock 数据，稍后接入真实大纲",
  languageDirective: "",
  source: { type: "topic", topic: "mock", documentRefs: [] },
  agents: [],
  metadata: {
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    llmModel: null,
    schemaVersion: 1,
  },
  outlines: [
    { id: "kp_1", order: 1, title: "时域与频域的基本概念" },
    { id: "kp_2", order: 2, title: "周期傅立叶级数" },
    { id: "kp_3", order: 3, title: "连续傅立叶变换" },
    { id: "kp_4", order: 4, title: "离散傅立叶变换（DFT）" },
    { id: "kp_5", order: 5, title: "快速傅立叶算法（FFT）" },
  ].map((kp) => ({
    ...kp,
    description: "",
    keyPoints: [],
    teachingObjective: null,
    estimatedDuration: null,
    languageNote: null,
  })),
};

/**
 * /chat layout — swaps the main nav for an outline (knowledge-point)
 * tree. Both sidebars live in sibling segments, so moving between
 * /chat and /(nav)/... does not remount either one. That's the whole
 * point of the nested-route-group structure.
 */
export default function ChatLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // selectedKpId is deliberately local & unused for wiring downstream
  // yet — it's only the visual highlight while the /chat <-> outline
  // metadata bridge (Phase 5) is still pending.
  const [selectedKpId, setSelectedKpId] = useState<string | null>(null);

  return (
    <>
      <OutlineSidebar
        outline={MOCK_OUTLINE}
        selectedKpId={selectedKpId}
        onSelectKp={(kp) => setSelectedKpId(kp.id)}
        onNewTopic={() => setSelectedKpId(null)}
        isBusy={false}
      />
      <main className="flex-1 overflow-hidden bg-[var(--background)]">
        {children}
      </main>
    </>
  );
}
