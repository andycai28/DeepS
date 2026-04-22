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

/**
 * Append `chunk` to the content of the last message in the list, returning a
 * new array. Used while streaming an assistant reply token-by-token.
 */
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

/**
 * Drop messages whose content didn't land (stream cut early, agent returned
 * empty, etc.). The backend's Pydantic schemas require content.length >= 1,
 * so empty entries must never make it into sessionStorage or the next
 * request payload.
 */
function dropEmptyContent(list: StudyMessage[]): StudyMessage[] {
  return list.filter(
    (m) => typeof m.content === "string" && m.content.length > 0,
  );
}

function toDiscussionHistory(messages: StudyMessage[]): DiscussionMessage[] {
  return messages
    .filter((m) => m.content.length > 0)
    .map((m) => ({
      role: m.role,
      content: m.content,
      agentId: m.agentId ?? null,
      agentName: m.agentName ?? null,
    }));
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
  const [discussionMode, setDiscussionMode] = useState(false);
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

  // 2. Hydrate chat history + discussion-mode flag from sessionStorage.
  useEffect(() => {
    if (!outline || messagesHydrated) return;
    const cached = sessionStorage.getItem(messagesKey(outlineId));
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as StudyMessage[];
        // Older sessions (pre-fix) may have persisted empty placeholders —
        // scrub them on load so the next submit doesn't hit the 422.
        const cleaned = dropEmptyContent(parsed);
        setMessages(cleaned);
        if (cleaned.length !== parsed.length) {
          sessionStorage.setItem(
            messagesKey(outlineId),
            JSON.stringify(cleaned),
          );
        }
      } catch {
        sessionStorage.removeItem(messagesKey(outlineId));
      }
    }
    const modeCache = sessionStorage.getItem(discussionModeKey(outlineId));
    if (modeCache === "on") setDiscussionMode(true);
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

    // Placeholder assistant bubble that streams in.
    setMessages([{ role: "assistant", content: "" }]);

    streamStudyChat(
      outlineId,
      { history: [], currentKpId: null },
      {
        onChunk: (chunk) => {
          if (controller.signal.aborted) return;
          setMessages((prev) => appendToLast(prev, chunk));
        },
      },
      controller.signal,
    )
      .then(({ reply }) => {
        if (controller.signal.aborted) return;
        const final: StudyMessage[] = [{ role: "assistant", content: reply }];
        setMessages(final);
        sessionStorage.setItem(messagesKey(outlineId), JSON.stringify(final));
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setChatError(err instanceof Error ? err.message : "课堂开篇失败");
        setMessages([]);
        kickoffStartedRef.current = false;
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setIsSending(false);
      });

    return () => {
      controller.abort();
    };
  }, [outline, outlineId, messages.length, messagesHydrated]);

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

  const persistMessages = useCallback(
    (next: StudyMessage[]) => {
      sessionStorage.setItem(messagesKey(outlineId), JSON.stringify(next));
    },
    [outlineId],
  );

  const handleSubmit = useCallback(async () => {
    const trimmed = composerValue.trim();
    if (!trimmed || isSending) return;

    const priorMessages = messages;
    // Strip any empty-content stragglers (e.g. an agent placeholder left
    // behind by a prior discussion-mode turn that the model returned
    // nothing for). The backend's ChatMessage / DiscussionMessage schemas
    // require content.length >= 1, so empty entries would trip 422.
    const cleanPrior = dropEmptyContent(priorMessages);
    const historyWithUser: StudyMessage[] = [
      ...cleanPrior,
      { role: "user", content: trimmed },
    ];

    setIsSending(true);
    setChatError(null);
    setComposerValue("");

    const controller = new AbortController();
    abortRef.current = controller;

    if (discussionMode) {
      // Discussion mode: multiple agent bubbles may land per user turn.
      // We don't push a placeholder yet — agent_start events do that.
      setMessages(historyWithUser);

      try {
        await streamDiscuss(
          outlineId,
          {
            history: toDiscussionHistory(historyWithUser),
            currentKpId: selectedKpId,
          },
          {
            onAgentStart: (agent) => {
              if (controller.signal.aborted) return;
              setMessages((prev) => [
                ...prev,
                {
                  role: "assistant",
                  content: "",
                  agentId: agent.id,
                  agentName: agent.name,
                  agentColor: agent.color,
                  agentAvatarInitial: agent.avatarInitial,
                },
              ]);
            },
            onAgentChunk: (agentId, content) => {
              if (controller.signal.aborted) return;
              setMessages((prev) =>
                appendToLastByAgent(prev, agentId, content),
              );
            },
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;

        // Snapshot + clean the final transcript. Agents that produced
        // no text leave behind empty placeholders here; drop them so
        // the next turn's request doesn't fail validation.
        setMessages((prev) => {
          const cleaned = dropEmptyContent(prev);
          persistMessages(cleaned);
          return cleaned;
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        setChatError(err instanceof Error ? err.message : "讨论失败");
        // Drop any partial agent bubbles — restore the pre-submit transcript.
        setMessages(cleanPrior);
        setComposerValue(trimmed);
      } finally {
        if (!controller.signal.aborted) setIsSending(false);
      }
      return;
    }

    // Single-tutor mode: one assistant bubble, streamed in place.
    setMessages([...historyWithUser, { role: "assistant", content: "" }]);

    try {
      const { reply } = await streamStudyChat(
        outlineId,
        {
          history: historyWithUser,
          currentKpId: selectedKpId,
        },
        {
          onChunk: (chunk) => {
            if (controller.signal.aborted) return;
            setMessages((prev) => appendToLast(prev, chunk));
          },
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;

      const final: StudyMessage[] = [
        ...historyWithUser,
        { role: "assistant", content: reply },
      ];
      setMessages(final);
      persistMessages(final);
    } catch (err) {
      if (controller.signal.aborted) return;
      setChatError(err instanceof Error ? err.message : "发送失败");
      setMessages(priorMessages);
      setComposerValue(trimmed);
    } finally {
      if (!controller.signal.aborted) setIsSending(false);
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

  const handleNewTopic = useCallback(() => {
    abortRef.current?.abort();
    sessionStorage.removeItem(messagesKey(outlineId));
    setMessages([]);
    setComposerValue("");
    setSelectedKpId(null);
    setChatError(null);
    kickoffStartedRef.current = false;
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
          discussionMode={discussionMode}
          discussionAvailable={discussionAvailable}
          onToggleDiscussion={handleToggleDiscussion}
        />
      </main>
    </div>
  );
}
