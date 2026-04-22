"use client";

import { AnimatePresence, motion } from "framer-motion";

import type { Outline } from "@/lib/types/outline";

interface OutlineVisualizerProps {
  outline: Outline | null;
}

/**
 * Pre-generation: 3 pulsing skeleton rows.
 * Post-generation: actual knowledge-point titles staggered in.
 *
 * Inspired by OpenMAIC's StreamingOutlineVisualizer but stripped down —
 * we don't yet have real streaming (Phase 1.5 will add SSE).
 */
export default function OutlineVisualizer({ outline }: OutlineVisualizerProps) {
  if (outline) {
    const items = outline.outlines.slice(0, 5);
    return (
      <div className="space-y-2.5">
        <AnimatePresence>
          {items.map((kp, idx) => (
            <motion.div
              key={kp.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: idx * 0.08 }}
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
          {outline.outlines.length > items.length && (
            <motion.div
              key="more"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: items.length * 0.08 }}
              className="pl-8 text-xs text-[var(--muted-foreground)]"
            >
              还有 {outline.outlines.length - items.length} 条…
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
