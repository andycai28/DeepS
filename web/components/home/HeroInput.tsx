"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Loader2 } from "lucide-react";
import { motion } from "framer-motion";

const MIN_HEIGHT = 140;
const MAX_HEIGHT = 300;

// Passed to /generate via sessionStorage to avoid long URL params.
const REQUIREMENT_STORAGE_KEY = "ds:requirement";

export default function HeroInput() {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(
      Math.max(el.scrollHeight, MIN_HEIGHT),
      MAX_HEIGHT,
    )}px`;
  }, [value]);

  const canSubmit = value.trim().length > 0 && !submitting;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      sessionStorage.setItem(REQUIREMENT_STORAGE_KEY, value.trim());
      router.push("/generate");
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : "无法进入生成页面");
    }
  }, [canSubmit, router, value]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      handleSubmit();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.2 }}
      className="w-full"
    >
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={submitting}
          placeholder="告诉我你想学什么——一个主题、一个问题、或者一段学习需求…"
          className="w-full resize-none rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-4 pr-16 text-base leading-relaxed text-[var(--foreground)] shadow-sm outline-none transition placeholder:text-[var(--muted-foreground)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-60"
          style={{ minHeight: MIN_HEIGHT }}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          aria-label="开始学习"
          className="absolute bottom-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] shadow transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowUp className="h-4 w-4" />
          )}
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
        <span>{submitting ? "正在打开…" : "Cmd/Ctrl + Enter 提交"}</span>
        <span>默认 15-30 分钟 · 中文</span>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 px-3 py-2 text-sm text-[var(--destructive)]">
          {error}
        </div>
      )}
    </motion.div>
  );
}
