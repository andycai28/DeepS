"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { ArrowUp, Loader2, Users } from "lucide-react";

import Message from "./Message";
import type { AgentProfile, StudyMessage } from "@/lib/types/outline";

/** Matches the StreamingFor shape in the parent study page. */
type StreamingFor =
  | null
  | { kind: "tutor" }
  | { kind: "agent"; agent: AgentProfile }
  | { kind: "director" };

interface StudyChatProps {
  messages: StudyMessage[];
  composerValue: string;
  onComposerChange: (value: string) => void;
  onSubmit: () => void;
  isSending: boolean;
  errorMessage: string | null;
  focusedKpTitle: string | null;
  /** Whether the user has toggled discussion (multi-agent) mode on. */
  discussionMode: boolean;
  /** Whether the outline even has a cast (affects pill enabled state). */
  discussionAvailable: boolean;
  onToggleDiscussion: () => void;
  /** What's currently streaming but hasn't produced visible content yet.
   *  Null once a bubble appears or the stream ends. */
  streamingFor: StreamingFor;
}

export default function StudyChat({
  messages,
  composerValue,
  onComposerChange,
  onSubmit,
  isSending,
  errorMessage,
  focusedKpTitle,
  discussionMode,
  discussionAvailable,
  onToggleDiscussion,
  streamingFor,
}: StudyChatProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, streamingFor]);

  const canSubmit = composerValue.trim().length > 0 && !isSending;

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  };

  // Loading indicator is driven entirely by `streamingFor`. A null value
  // means either nothing is streaming or the bubble already materialised,
  // so there's nothing extra to show.
  let indicatorLabel: string | null = null;
  if (streamingFor) {
    if (streamingFor.kind === "tutor") {
      indicatorLabel =
        messages.length === 0 ? "正在准备课堂开篇…" : "AI 老师正在思考…";
    } else if (streamingFor.kind === "agent") {
      indicatorLabel = `${streamingFor.agent.name} 正在发言…`;
    } else if (streamingFor.kind === "director") {
      indicatorLabel = "🎭 导演在安排下一位发言…";
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          {messages.map((msg, idx) => (
            <Message key={idx} message={msg} />
          ))}
          {indicatorLabel && (
            <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              {indicatorLabel}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-[var(--border)] bg-[var(--background)] px-6 py-4">
        <div className="mx-auto max-w-3xl">
          {errorMessage && (
            <div className="mb-2 rounded-md border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 px-3 py-2 text-sm text-[var(--destructive)]">
              {errorMessage}
            </div>
          )}
          <div className="relative">
            <textarea
              value={composerValue}
              onChange={(e) => onComposerChange(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isSending}
              placeholder={
                focusedKpTitle
                  ? `聚焦【${focusedKpTitle}】 · 问我任何相关问题…`
                  : discussionMode
                    ? "向全班提问，几位同学会一起回应…"
                    : "提问、追问、或点左侧知识点…"
              }
              rows={3}
              className="w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 pr-14 text-sm leading-relaxed text-[var(--foreground)] shadow-sm outline-none transition placeholder:text-[var(--muted-foreground)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-60"
            />
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit}
              aria-label="发送"
              className="absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] shadow transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowUp className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--muted-foreground)]">
            <button
              type="button"
              onClick={onToggleDiscussion}
              disabled={!discussionAvailable || isSending}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition disabled:cursor-not-allowed disabled:opacity-40 ${
                discussionMode
                  ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]"
                  : "border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
              title={
                discussionAvailable
                  ? discussionMode
                    ? "关闭讨论模式（回到单老师）"
                    : "打开讨论模式（多位同学一起学习）"
                  : "当前大纲未配备讨论班级，无法进入讨论模式"
              }
            >
              <Users className="h-3 w-3" />
              讨论模式 {discussionMode ? "ON" : "OFF"}
            </button>
            <span>Enter 发送 · Shift+Enter 换行</span>
          </div>
        </div>
      </div>
    </div>
  );
}
