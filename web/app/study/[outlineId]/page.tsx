"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

import OutlineSidebar from "@/components/study/OutlineSidebar";
import StudyChat from "@/components/study/StudyChat";
import {
  fetchOutline,
  streamDiscuss,
  streamStudyChat,
} from "@/lib/study-api";
import type {
  AgentProfile,
  DiscussionMessage,
  KnowledgePoint,
  Outline,
  StudyMessage,
} from "@/lib/types/outline";

const OUTLINE_CACHE_PREFIX = "ds:outline:";
const MESSAGES_CACHE_PREFIX = "ds:study:";
const DISCUSSION_MODE_PREFIX = "ds:discussion:";

function messagesKey(outlineId: string): string {
  return `${MESSAGES_CACHE_PREFIX}${outlineId}:messages`;
}

function discussionModeKey(outlineId: string): string {
  return `${DISCUSSION_MODE_PREFIX}${outlineId}`;
}

function appendToLast(list: StudyMessage[], chunk: string): StudyMessage[] {
  if (list.length === 0) return list;
  const copy = [...list];
  const last = copy[copy.length - 1];
  copy[copy.length - 1] = {
    ...last,
    content: last.content + chunk,
  };
  return copy;
}

function appendToLastByAgent(
  list: StudyMessage[],
  agentId: string,
  chunk: string,
): StudyMessage[] {
  if (list.length === 0) return list;
  const copy = [...list];
  const last = copy[copy.length - 1];
  if (last.agentId !== agentId) return list;
  copy[copy.length - 1] = {
    ...last,
    content: last.content + chunk,
  };
  return copy;
}

function toDiscussionHistory(messages: StudyMessage[]): DiscussionMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
    agentId: m.agentId ?? null,
    agentName: m.agentName ?? null,
  }));
}

/** Signal about which source is currently streaming but hasn't emitted
 *  any visible content yet. Cleared as soon as the first chunk lands. */
type StreamingFor =
  | null
  | { kind: "tutor" }
  | { kind: "agent"; agent: AgentProfile }
  | { kind: "director" };

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
  const [discussionMode, setDiscussionMode] = useState(false);
  const [streamingFor, setStreamingFor] = useState<StreamingFor>(null);
  const abortRef = useRef<AbortController | null>(null);
  const kickoffStartedRef = useRef(false);
  // Mirrors `messages` so we can read the post-stream transcript outside
  // setState callbacks (React Strict Mode double-invokes updaters, which
  // would cause two sessionStorage writes if we persisted inside one).
  const messagesRef = useRef<StudyMessage[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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

  // 2. Hydrate chat history + discussion-mode flag from sessionStorage.
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
    const modeCache = sessionStorage.getItem(discussionModeKey(outlineId));
    if (modeCache === "on") setDiscussionMode(true);
    setMessagesHydrated(true);
  }, [outline, outlineId, messagesHydrated]);

  const persistMessages = useCallback(
    (next: StudyMessage[]) => {
      sessionStorage.setItem(messagesKey(outlineId), JSON.stringify(next));
    },
    [outlineId],
  );

  // 3. Auto-trigger course opening when we have outline + no prior messages.
  useEffect(() => {
    if (!outline || !messagesHydrated) return;
    if (messages.length > 0) return;
    if (kickoffStartedRef.current) return;
    kickoffStartedRef.current = true;

    const controller = new AbortController();
    abortRef.current = controller;
    setIsSending(true);
    setStreamingFor({ kind: "tutor" });
    setChatError(null);

    // Lazy bubble creation: no placeholder upfront. The first chunk is what
    // materialises the assistant message into `messages`. If the stream ends
    // without ever emitting a chunk, we commit nothing.
    let bubbleCommitted = false;

    streamStudyChat(
      outlineId,
      { history: [], currentKpId: null },
      {
        onChunk: (chunk) => {
          if (controller.signal.aborted) return;
          if (!bubbleCommitted) {
            bubbleCommitted = true;
            setStreamingFor(null);
            setMessages([{ role: "assistant", content: chunk }]);
          } else {
            setMessages((prev) => appendToLast(prev, chunk));
          }
        },
      },
      controller.signal,
    )
      .then(() => {
        if (controller.signal.aborted) return;
        persistMessages(messagesRef.current);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setChatError(err instanceof Error ? err.message : "课堂开篇失败");
        kickoffStartedRef.current = false;
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setIsSending(false);
        setStreamingFor(null);
      });

    return () => {
      controller.abort();
    };
  }, [outline, outlineId, messages.length, messagesHydrated, persistMessages]);

  // Discussion is available only when the outline generated a cast.
  const discussionAvailable = (outline?.agents?.length ?? 0) > 0;

  const handleToggleDiscussion = useCallback(() => {
    if (!discussionAvailable) return;
    setDiscussionMode((prev) => {
      const next = !prev;
      sessionStorage.setItem(
        discussionModeKey(outlineId),
        next ? "on" : "off",
      );
      return next;
    });
  }, [discussionAvailable, outlineId]);

  const handleSubmit = useCallback(async () => {
    const trimmed = composerValue.trim();
    if (!trimmed || isSending) return;

    const priorMessages = messages;
    const historyWithUser: StudyMessage[] = [
      ...priorMessages,
      { role: "user", content: trimmed },
    ];

    setIsSending(true);
    setChatError(null);
    setComposerValue("");
    setMessages(historyWithUser);

    const controller = new AbortController();
    abortRef.current = controller;

    if (discussionMode) {
      // Discussion mode: director plus multiple agents. Bubbles materialise
      // on the first chunk per agent — no empty placeholders.
      setStreamingFor({ kind: "director" });
      const pendingAgents = new Map<string, AgentProfile>();

      try {
        await streamDiscuss(
          outlineId,
          {
            history: toDiscussionHistory(historyWithUser),
            currentKpId: selectedKpId,
          },
          {
            onDirectorThinking: () => {
              if (controller.signal.aborted) return;
              setStreamingFor({ kind: "director" });
            },
            onAgentStart: (agent) => {
              if (controller.signal.aborted) return;
              pendingAgents.set(agent.id, agent);
              setStreamingFor({ kind: "agent", agent });
            },
            onAgentChunk: (agentId, content) => {
              if (controller.signal.aborted) return;
              const pending = pendingAgents.get(agentId);
              if (pending) {
                pendingAgents.delete(agentId);
                setStreamingFor(null);
                setMessages((prev) => [
                  ...prev,
                  {
                    role: "assistant",
                    content,
                    agentId: pending.id,
                    agentName: pending.name,
                    agentColor: pending.color,
                    agentAvatarInitial: pending.avatarInitial,
                  },
                ]);
              } else {
                setMessages((prev) =>
                  appendToLastByAgent(prev, agentId, content),
                );
              }
            },
            onAgentEnd: (agentId) => {
              if (controller.signal.aborted) return;
              if (pendingAgents.delete(agentId)) {
                // agent produced nothing — clear the indicator, don't commit.
                setStreamingFor(null);
              }
            },
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;

        persistMessages(messagesRef.current);
      } catch (err) {
        if (controller.signal.aborted) return;
        setChatError(err instanceof Error ? err.message : "讨论失败");
        // Roll back: remove the user turn so they can edit and resend.
        setMessages(priorMessages);
        setComposerValue(trimmed);
      } finally {
        if (!controller.signal.aborted) {
          setIsSending(false);
          setStreamingFor(null);
        }
      }
      return;
    }

    // Single-tutor mode: lazy bubble creation, same pattern as kickoff.
    setStreamingFor({ kind: "tutor" });
    let bubbleCommitted = false;

    try {
      await streamStudyChat(
        outlineId,
        {
          history: historyWithUser,
          currentKpId: selectedKpId,
        },
        {
          onChunk: (chunk) => {
            if (controller.signal.aborted) return;
            if (!bubbleCommitted) {
              bubbleCommitted = true;
              setStreamingFor(null);
              setMessages((prev) => [
                ...prev,
                { role: "assistant", content: chunk },
              ]);
            } else {
              setMessages((prev) => appendToLast(prev, chunk));
            }
          },
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;

      persistMessages(messagesRef.current);
    } catch (err) {
      if (controller.signal.aborted) return;
      setChatError(err instanceof Error ? err.message : "发送失败");
      setMessages(priorMessages);
      setComposerValue(trimmed);
    } finally {
      if (!controller.signal.aborted) {
        setIsSending(false);
        setStreamingFor(null);
      }
    }
  }, [
    composerValue,
    discussionMode,
    isSending,
    messages,
    outlineId,
    persistMessages,
    selectedKpId,
  ]);

  const handleSelectKp = useCallback((kp: KnowledgePoint) => {
    setSelectedKpId(kp.id);
  }, []);

  const handleComposerChange = useCallback(
    (value: string) => {
      setComposerValue(value);
      // Clear the stale error banner once the student starts editing — it
      // was tied to the prior submit, not this new attempt.
      if (chatError) setChatError(null);
    },
    [chatError],
  );

  const handleNewTopic = useCallback(() => {
    // All setState calls below are batched into a single render by React,
    // so the relative order doesn't affect the kickoff effect's re-run —
    // it sees the final state (messages.length === 0,
    // kickoffStartedRef.current === false) after this handler returns.
    abortRef.current?.abort();
    sessionStorage.removeItem(messagesKey(outlineId));
    kickoffStartedRef.current = false;
    setMessages([]);
    setComposerValue("");
    setSelectedKpId(null);
    setChatError(null);
    setStreamingFor(null);
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
          onComposerChange={handleComposerChange}
          onSubmit={handleSubmit}
          isSending={isSending}
          errorMessage={chatError}
          focusedKpTitle={
            selectedKpId
              ? outline.outlines.find((kp) => kp.id === selectedKpId)?.title ?? null
              : null
          }
          discussionMode={discussionMode}
          discussionAvailable={discussionAvailable}
          onToggleDiscussion={handleToggleDiscussion}
          streamingFor={streamingFor}
        />
      </main>
    </div>
  );
}
