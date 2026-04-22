"use client";

import { Loader2, RefreshCw } from "lucide-react";

import type { KnowledgePoint, Outline } from "@/lib/types/outline";

interface OutlineSidebarProps {
  outline: Outline;
  selectedKpId: string | null;
  onSelectKp: (kp: KnowledgePoint) => void;
  onNewTopic: () => void;
  isBusy?: boolean;
}

export default function OutlineSidebar({
  outline,
  selectedKpId,
  onSelectKp,
  onNewTopic,
  isBusy,
}: OutlineSidebarProps) {
  return (
    <aside className="flex h-screen w-[280px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--secondary)]">
      <header className="flex items-start justify-between gap-2 border-b border-[var(--border)] px-4 py-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-[var(--foreground)]">
            {outline.title}
          </h1>
          {outline.description && (
            <p className="mt-1 line-clamp-2 text-xs text-[var(--muted-foreground)]">
              {outline.description}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onNewTopic}
          disabled={isBusy}
          aria-label="清空会话重新开始"
          title="清空会话重新开始"
          className="shrink-0 rounded-md p-1.5 text-[var(--muted-foreground)] transition hover:bg-[var(--background)]/60 hover:text-[var(--foreground)] disabled:opacity-40"
        >
          {isBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </button>
      </header>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
          知识点
        </div>
        <ul className="space-y-1">
          {outline.outlines.map((kp) => {
            const selected = kp.id === selectedKpId;
            return (
              <li key={kp.id}>
                <button
                  type="button"
                  onClick={() => onSelectKp(kp)}
                  className={`group w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                    selected
                      ? "bg-[var(--primary)]/12 text-[var(--foreground)]"
                      : "text-[var(--muted-foreground)] hover:bg-[var(--background)]/60 hover:text-[var(--foreground)]"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-medium ${
                        selected
                          ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                          : "bg-[var(--muted)] text-[var(--muted-foreground)] group-hover:bg-[var(--accent)]"
                      }`}
                    >
                      {kp.order}
                    </span>
                    <span className="flex-1 text-[13.5px] leading-snug">
                      {kp.title}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <footer className="border-t border-[var(--border)] px-4 py-3 text-[11px] text-[var(--muted-foreground)]">
        {outline.outlines.length} 个知识点 · DeepStudy
      </footer>
    </aside>
  );
}
