"use client";

import { AnimatePresence, motion } from "framer-motion";

import type { KnowledgePoint } from "@/lib/types/outline";

interface OutlineVisualizerProps {
  /** KPs available right now. Empty / undefined → skeleton. */
  outlines?: KnowledgePoint[];
  /** Cap visible rows; overflow collapses into a "+N more" line. */
  maxVisible?: number;
}

/**
 * While outlines are streaming / still empty: 3 pulsing skeleton rows.
 * As each KP arrives it animates in under the previous one; the skeletons
 * naturally disappear once we have real content.
 */
export default function OutlineVisualizer({
  outlines,
  maxVisible = 5,
}: OutlineVisualizerProps) {
  if (outlines && outlines.length > 0) {
    const items = outlines.slice(0, maxVisible);
    const overflow = outlines.length - items.length;
    return (
      <div className="space-y-2.5">
        <AnimatePresence initial={false}>
          {items.map((kp, idx) => (
            <motion.div
              key={kp.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: idx * 0.04 }}
              className="flex items-start gap-3"
            >
              <span className="mt-0.5 inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-[var(--primary)]/10 px-1.5 text-[11px] font-medium text-[var(--primary)]">
                {kp.order}
              </span>
              <span className="truncate text-sm text-[var(--foreground)]">
                {kp.title}
              </span>
            </motion.div>
          ))}
          {overflow > 0 && (
            <motion.div
              key="more"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: items.length * 0.04 }}
              className="pl-8 text-xs text-[var(--muted-foreground)]"
            >
              还有 {overflow} 条…
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-start gap-3">
          <span className="mt-0.5 h-5 w-5 shrink-0 animate-pulse rounded-full bg-[var(--muted)]" />
          <span
            className="h-4 flex-1 animate-pulse rounded bg-[var(--muted)]"
            style={{ animationDelay: `${i * 150}ms`, width: `${80 - i * 15}%` }}
          />
        </div>
      ))}
    </div>
  );
}
