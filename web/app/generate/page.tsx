"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, FileText, Loader2 } from "lucide-react";

import { streamOutline } from "@/lib/outline-api";
import { streamStudyChat } from "@/lib/study-api";
import type {
  KnowledgePoint,
  Outline,
  StudyMessage,
} from "@/lib/types/outline";

import OutlineVisualizer from "./components/OutlineVisualizer";

const REQUIREMENT_STORAGE_KEY = "ds:requirement";
const OUTLINE_STORAGE_PREFIX = "ds:outline:";
const MESSAGES_STORAGE_PREFIX = "ds:study:";
// Tracks which outline is "active" in /chat. The chat layout reads this
// so the knowledge-point sidebar survives across the URL rewrites the
// chat page does when it assigns a server session id.
const ACTIVE_OUTLINE_STORAGE_KEY = "ds:chat:activeOutlineId";
const POST_COMPLETE_DELAY_MS = 500;

type Phase = "bootstrapping" | "outline" | "opening" | "complete" | "error";

/**
 * Generation preview page.
 *
 * Two-phase progress UX:
 *   1. outline  — stream the syllabus (KPs populate the visualizer as they land)
 *   2. opening  — ask the tutor for a course opening (no KP focus)
 *
 * Both artifacts land in sessionStorage before we redirect to /study,
 * so the study page is populated the moment it mounts.
 */
export default function GeneratePage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("bootstrapping");
  const [title, setTitle] = useState<string | null>(null);
  const [kps, setKps] = useState<KnowledgePoint[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requirementRef = useRef<string>("");

  useEffect(() => {
    const requirement = sessionStorage.getItem(REQUIREMENT_STORAGE_KEY);
    if (!requirement) {
      router.replace("/");
      return;
    }

    requirementRef.current = requirement;

    const controller = new AbortController();
    abortRef.current = controller;

    setPhase("outline");

    const run = async () => {
      // Phase 1: stream the outline. Visualizer picks up KPs one by one.
      const outline: Outline = await streamOutline(
        { requirement },
        {
          onTitle: (value) => setTitle(value),
          onKp: (kp) => setKps((prev) => [...prev, kp]),
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;

      sessionStorage.setItem(
        `${OUTLINE_STORAGE_PREFIX}${outline.id}`,
        JSON.stringify(outline),
      );
      sessionStorage.removeItem(REQUIREMENT_STORAGE_KEY);
      // Use the server-authoritative list once done (covers any KPs the
      // client missed if the stream was slow to flush).
      setKps(outline.outlines);
      setTitle(outline.title);
      setPhase("opening");

      // Phase 2: pre-generate the tutor's course opening. No KP focus yet,
      // so the system prompt's State section is the brief overview. We drain
      // the SSE stream silently — /generate only needs the final text.
      const { reply } = await streamStudyChat(
        outline.id,
        { history: [], currentKpId: null },
        {},
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const initialMessages: StudyMessage[] = [
        { role: "assistant", content: reply },
      ];
      sessionStorage.setItem(
        `${MESSAGES_STORAGE_PREFIX}${outline.id}:messages`,
        JSON.stringify(initialMessages),
      );
      setPhase("complete");

      setTimeout(() => {
        if (controller.signal.aborted) return;
        // Pin this as the active outline so the chat sidebar keeps
        // showing it after the chat page mutates the URL on first send.
        sessionStorage.setItem(ACTIVE_OUTLINE_STORAGE_KEY, outline.id);
        router.replace(`/chat?outline_id=${encodeURIComponent(outline.id)}`);
      }, POST_COMPLETE_DELAY_MS);
    };

    run().catch((err) => {
      if (controller.signal.aborted) return;
      setPhase("error");
      setErrorMessage(
        err instanceof Error ? err.message : "生成失败，请返回重试",
      );
    });

    return () => {
      controller.abort();
    };
  }, [router]);

  const handleBack = useCallback(() => {
    abortRef.current?.abort();
    sessionStorage.removeItem(REQUIREMENT_STORAGE_KEY);
    router.replace("/");
  }, [router]);

  const handleRetry = useCallback(() => {
    if (requirementRef.current) {
      sessionStorage.setItem(REQUIREMENT_STORAGE_KEY, requirementRef.current);
    }
    abortRef.current?.abort();
    router.replace("/");
  }, [router]);

  if (phase === "bootstrapping") {
    return null;
  }

  const isComplete = phase === "complete";
  const isError = phase === "error";
  const isWorking = phase === "outline" || phase === "opening";

  const headline = isError
    ? "生成失败"
    : phase === "outline"
      ? title
        ? `正在生成《${title}》`
        : "正在生成大纲…"
      : phase === "opening"
        ? "正在准备课堂导读…"
        : "准备就绪";

  const subline = isError
    ? "请返回主页修改主题后再试一次"
    : phase === "outline"
      ? kps.length > 0
        ? `已梳理出 ${kps.length} 个知识点，继续生成中…`
        : "AI 正在理解你的主题并梳理知识结构"
      : phase === "opening"
        ? "AI 老师正在为你写开场白"
        : "正在进入学习空间";

  const progressBar = isError
    ? "w-2 bg-[var(--destructive)]"
    : isComplete
      ? "w-16 bg-[var(--primary)]"
      : phase === "opening"
        ? "w-12 bg-[var(--primary)]"
        : kps.length > 0
          ? "w-8 bg-[var(--primary)]"
          : "w-4 bg-[var(--primary)]";

  return (
    <div className="relative flex h-screen w-screen items-center justify-center overflow-y-auto px-6 py-10">
      <button
        type="button"
        onClick={handleBack}
        aria-label="返回主页"
        className="absolute left-6 top-6 flex items-center gap-1 rounded-md px-2 py-1 text-sm text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
      >
        <ArrowLeft className="h-4 w-4" />
        返回主页
      </button>

      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-[20%] top-[15%] h-64 w-64 rounded-full bg-[var(--primary)]/15 blur-3xl animate-pulse [animation-duration:5s]" />
        <div className="absolute bottom-[15%] right-[20%] h-72 w-72 rounded-full bg-[var(--primary)]/10 blur-3xl animate-pulse [animation-duration:7s]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm"
      >
        <div className="mb-6 flex justify-center">
          <span
            className={`h-1.5 rounded-full transition-all duration-500 ${progressBar}`}
          />
        </div>

        <div className="flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--primary)]/10 text-[var(--primary)]">
            <AnimatePresence mode="wait">
              {isWorking ? (
                <motion.span
                  key="spinner"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <Loader2 className="h-6 w-6 animate-spin" />
                </motion.span>
              ) : (
                <motion.span
                  key="done"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <FileText className="h-6 w-6" />
                </motion.span>
              )}
            </AnimatePresence>
          </div>

          <h2 className="text-lg font-semibold text-[var(--foreground)]">
            {headline}
          </h2>

          <p className="max-w-sm text-center text-sm text-[var(--muted-foreground)]">
            {subline}
          </p>
        </div>

        <div className="mt-6 border-t border-[var(--border)] pt-6">
          <OutlineVisualizer outlines={kps} />
        </div>

        <div className="mt-6 flex items-center justify-center text-xs text-[var(--muted-foreground)]">
          {isError ? (
            <button
              type="button"
              onClick={handleRetry}
              className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm text-[var(--primary-foreground)] transition hover:opacity-90"
            >
              返回重试
            </button>
          ) : (
            <span>AI 正在工作…</span>
          )}
        </div>

        {errorMessage && (
          <div className="mt-4 rounded-md border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 px-3 py-2 text-sm text-[var(--destructive)]">
            {errorMessage}
          </div>
        )}
      </motion.div>
    </div>
  );
}
