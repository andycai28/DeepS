"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

import OutlineSidebar from "@/components/study/OutlineSidebar";
import StudyChat from "@/components/study/StudyChat";
import { fetchOutline, postStudyChat } from "@/lib/study-api";
import type {
  KnowledgePoint,
  Outline,
  StudyMessage,
} from "@/lib/types/outline";

const OUTLINE_CACHE_PREFIX = "ds:outline:";
const MESSAGES_CACHE_PREFIX = "ds:study:";

function messagesKey(outlineId: string): string {
  return `${MESSAGES_CACHE_PREFIX}${outlineId}:messages`;
}

export default function StudyPage() {
  const params = useParams<{ outlineId: string }>();
  const outlineId = params.outlineId;

  const [outline, setOutline] = useState<Outline | null>(null);
  const [outlineError, setOutlineError] = useState<string | null>(null);
  const [messages, setMessages] = useState<StudyMessage[]>([]);
  const [messagesHydrated, setMessagesHydrated] = useState(false);
  const [composerValue, setComposerValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [selectedKpId, setSelectedKpId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const kickoffStartedRef = useRef(false);

  // 1. Load outline (sessionStorage first, fallback backend).
  useEffect(() => {
    if (!outlineId) return;

    let alive = true;
    const cacheKey = `${OUTLINE_CACHE_PREFIX}${outlineId}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      try {
        setOutline(JSON.parse(cached) as Outline);
        return () => {
          alive = false;
        };
      } catch {
        sessionStorage.removeItem(cacheKey);
      }
    }

    fetchOutline(outlineId)
      .then((data) => {
        if (!alive) return;
        setOutline(data);
        sessionStorage.setItem(cacheKey, JSON.stringify(data));
      })
      .catch((err) => {
        if (!alive) return;
        setOutlineError(err instanceof Error ? err.message : "大纲加载失败");
      });

    return () => {
      alive = false;
    };
  }, [outlineId]);

  // 2. Hydrate chat history from sessionStorage once outline is loaded.
  useEffect(() => {
    if (!outline || messagesHydrated) return;
    const cached = sessionStorage.getItem(messagesKey(outlineId));
    if (cached) {
      try {
        setMessages(JSON.parse(cached) as StudyMessage[]);
      } catch {
        sessionStorage.removeItem(messagesKey(outlineId));
      }
    }
    setMessagesHydrated(true);
  }, [outline, outlineId, messagesHydrated]);

  // 3. Auto-trigger course opening when we have outline + no prior messages.
  useEffect(() => {
    if (!outline || !messagesHydrated) return;
    if (messages.length > 0) return;
    if (kickoffStartedRef.current) return;
    kickoffStartedRef.current = true;

    const controller = new AbortController();
    abortRef.current = controller;
    setIsSending(true);
    setChatError(null);

    // Kickoff always starts without a selected KP — new-topic resets that
    // invariant and first-entry via /generate won't have one either.
    postStudyChat(
      outlineId,
      { history: [], currentKpId: null },
      controller.signal,
    )
      .then((response) => {
        if (controller.signal.aborted) return;
        const next: StudyMessage[] = [
          { role: "assistant", content: response.reply },
        ];
        setMessages(next);
        sessionStorage.setItem(messagesKey(outlineId), JSON.stringify(next));
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setChatError(err instanceof Error ? err.message : "课堂开篇失败");
        kickoffStartedRef.current = false; // allow retry after failure
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setIsSending(false);
      });

    return () => {
      controller.abort();
    };
  }, [outline, outlineId, messages.length, messagesHydrated]);

  const handleSubmit = useCallback(async () => {
    const trimmed = composerValue.trim();
    if (!trimmed || isSending) return;

    const history: StudyMessage[] = [
      ...messages,
      { role: "user", content: trimmed },
    ];

    setIsSending(true);
    setChatError(null);
    setMessages(history);
    setComposerValue("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await postStudyChat(
        outlineId,
        { history, currentKpId: selectedKpId },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const finalMessages: StudyMessage[] = [
        ...history,
        { role: "assistant", content: response.reply },
      ];
      setMessages(finalMessages);
      sessionStorage.setItem(
        messagesKey(outlineId),
        JSON.stringify(finalMessages),
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      setChatError(err instanceof Error ? err.message : "发送失败");
      // roll back the student message so they can edit and resend
      setMessages(messages);
      setComposerValue(trimmed);
    } finally {
      if (!controller.signal.aborted) {
        setIsSending(false);
      }
    }
  }, [composerValue, isSending, messages, outlineId, selectedKpId]);

  const handleSelectKp = useCallback((kp: KnowledgePoint) => {
    // State-only update — the next chat request will pick this id up and the
    // backend injects the KP's full details into the system prompt. We never
    // pre-fill the composer; the student asks freely in natural language.
    setSelectedKpId(kp.id);
  }, []);

  const handleNewTopic = useCallback(() => {
    abortRef.current?.abort();
    sessionStorage.removeItem(messagesKey(outlineId));
    setMessages([]);
    setComposerValue("");
    setSelectedKpId(null);
    setChatError(null);
    kickoffStartedRef.current = false; // allow the kickoff effect to fire again
  }, [outlineId]);

  if (outlineError) {
    return (
      <div className="flex h-screen w-screen items-center justify-center px-6">
        <div className="max-w-sm rounded-md border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 px-4 py-3 text-sm text-[var(--destructive)]">
          {outlineError}
        </div>
      </div>
    );
  }

  if (!outline) {
    return (
      <div className="flex h-screen w-screen items-center justify-center text-sm text-[var(--muted-foreground)]">
        加载中…
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <OutlineSidebar
        outline={outline}
        selectedKpId={selectedKpId}
        onSelectKp={handleSelectKp}
        onNewTopic={handleNewTopic}
        isBusy={isSending}
      />
      <main className="flex-1 overflow-hidden bg-[var(--background)]">
        <StudyChat
          messages={messages}
          composerValue={composerValue}
          onComposerChange={setComposerValue}
          onSubmit={handleSubmit}
          isSending={isSending}
          errorMessage={chatError}
          focusedKpTitle={
            selectedKpId
              ? outline.outlines.find((kp) => kp.id === selectedKpId)?.title ?? null
              : null
          }
        />
      </main>
    </div>
  );
}
