"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { ArrowUp, Loader2 } from "lucide-react";

import Message from "./Message";
import type { StudyMessage } from "@/lib/types/outline";

interface StudyChatProps {
  messages: StudyMessage[];
  composerValue: string;
  onComposerChange: (value: string) => void;
  onSubmit: () => void;
  isSending: boolean;
  errorMessage: string | null;
  focusedKpTitle: string | null;
}

export default function StudyChat({
  messages,
  composerValue,
  onComposerChange,
  onSubmit,
  isSending,
  errorMessage,
  focusedKpTitle,
}: StudyChatProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, isSending]);

  const canSubmit = composerValue.trim().length > 0 && !isSending;

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  };

  const lastMsg = messages[messages.length - 1];
  // Before the SSE stream emits its first chunk, the trailing assistant
  // bubble is empty — surface a subtle "thinking" indicator until content
  // starts flowing in. As soon as any content arrives, this auto-hides.
  const awaitingFirstToken =
    isSending &&
    lastMsg?.role === "assistant" &&
    lastMsg.content.length === 0;

  // Visible messages: hide the empty placeholder from the stream so the
  // "thinking" indicator can take its spot cleanly. Once tokens arrive,
  // the message has content and renders normally.
  const visibleMessages = awaitingFirstToken
    ? messages.slice(0, -1)
    : messages;

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          {visibleMessages.map((msg, idx) => (
            <Message key={idx} message={msg} />
          ))}
          {awaitingFirstToken && (
            <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              {visibleMessages.length === 0
                ? "正在准备课堂开篇…"
                : "AI 老师正在思考…"}
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
          <div className="mt-2 text-[11px] text-[var(--muted-foreground)]">
            Enter 发送 · Shift+Enter 换行
          </div>
        </div>
      </div>
    </div>
  );
}
