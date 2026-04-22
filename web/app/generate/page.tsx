"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, FileText, Loader2 } from "lucide-react";

import { generateOutline } from "@/lib/outline-api";
import type { Outline } from "@/lib/types/outline";

import OutlineVisualizer from "./components/OutlineVisualizer";

const REQUIREMENT_STORAGE_KEY = "ds:requirement";
const OUTLINE_STORAGE_PREFIX = "ds:outline:";
const POST_COMPLETE_DELAY_MS = 700;

type Status = "bootstrapping" | "generating" | "complete" | "error";

/**
 * Generation preview page.
 *
 * Reads the requirement from sessionStorage (populated by HeroInput),
 * calls the outline API, shows progress, then redirects to /chat with
 * the new outline_id. If no requirement is present we bounce back home.
 */
export default function GeneratePage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("bootstrapping");
  const [outline, setOutline] = useState<Outline | null>(null);
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

    setStatus("generating");

    generateOutline({ requirement }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        sessionStorage.setItem(
          `${OUTLINE_STORAGE_PREFIX}${result.id}`,
          JSON.stringify(result),
        );
        sessionStorage.removeItem(REQUIREMENT_STORAGE_KEY);
        setOutline(result);
        setStatus("complete");
        // brief visual pause before redirect so user sees it landed
        setTimeout(() => {
          if (controller.signal.aborted) return;
          router.replace(`/study/${encodeURIComponent(result.id)}`);
        }, POST_COMPLETE_DELAY_MS);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setStatus("error");
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
    // preserve the requirement so the user can tweak it on the home input
    if (requirementRef.current) {
      sessionStorage.setItem(REQUIREMENT_STORAGE_KEY, requirementRef.current);
    }
    abortRef.current?.abort();
    router.replace("/");
  }, [router]);

  if (status === "bootstrapping") {
    return null;
  }

  const isComplete = status === "complete";
  const isError = status === "error";

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
            className={`h-1.5 rounded-full transition-all duration-500 ${
              isComplete
                ? "w-16 bg-[var(--primary)]"
                : isError
                  ? "w-2 bg-[var(--destructive)]"
                  : "w-8 bg-[var(--primary)]"
            }`}
          />
        </div>

        <div className="flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--primary)]/10 text-[var(--primary)]">
            <AnimatePresence mode="wait">
              {!isComplete && !isError ? (
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
            {isError ? "生成失败" : isComplete ? "大纲已就绪" : "正在生成大纲…"}
          </h2>

          <p className="max-w-sm text-center text-sm text-[var(--muted-foreground)]">
            {isError
              ? "请返回主页修改主题后再试一次"
              : isComplete
                ? "正在进入学习空间"
                : "AI 正在理解你的主题并梳理知识结构"}
          </p>
        </div>

        <div className="mt-6 border-t border-[var(--border)] pt-6">
          <OutlineVisualizer outline={outline} />
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
