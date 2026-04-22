"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

import WorkspaceSidebar from "@/components/sidebar/WorkspaceSidebar";
import OutlineSidebar from "@/components/study/OutlineSidebar";
import type { Outline } from "@/lib/types/outline";

// Placeholder outline so /chat shows a knowledge-point tree during the
// migration to the unified chat stack. Swap for the real outline fetch
// once /chat consumes metadata (outline_id / current_kp_id).
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
    {
      id: "kp_1",
      order: 1,
      title: "时域与频域的基本概念",
      description: "",
      keyPoints: [],
      teachingObjective: null,
      estimatedDuration: null,
      languageNote: null,
    },
    {
      id: "kp_2",
      order: 2,
      title: "周期傅立叶级数",
      description: "",
      keyPoints: [],
      teachingObjective: null,
      estimatedDuration: null,
      languageNote: null,
    },
    {
      id: "kp_3",
      order: 3,
      title: "连续傅立叶变换",
      description: "",
      keyPoints: [],
      teachingObjective: null,
      estimatedDuration: null,
      languageNote: null,
    },
    {
      id: "kp_4",
      order: 4,
      title: "离散傅立叶变换（DFT）",
      description: "",
      keyPoints: [],
      teachingObjective: null,
      estimatedDuration: null,
      languageNote: null,
    },
    {
      id: "kp_5",
      order: 5,
      title: "快速傅立叶算法（FFT）",
      description: "",
      keyPoints: [],
      teachingObjective: null,
      estimatedDuration: null,
      languageNote: null,
    },
  ],
};

/**
 * Thin client-only wrapper that picks which sidebar to render based on
 * the current route. Isolated to a single component so the parent
 * workspace layout can stay a server component (keeps the rest of the
 * subtree eligible for server rendering).
 */
export default function ContextualSidebar() {
  const pathname = usePathname() ?? "";
  const isChatRoute = pathname.startsWith("/chat");
  const [selectedKpId, setSelectedKpId] = useState<string | null>(null);

  if (isChatRoute) {
    return (
      <OutlineSidebar
        outline={MOCK_OUTLINE}
        selectedKpId={selectedKpId}
        onSelectKp={(kp) => setSelectedKpId(kp.id)}
        onNewTopic={() => setSelectedKpId(null)}
        isBusy={false}
      />
    );
  }
  return <WorkspaceSidebar />;
}
