"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";

import HeroInput from "@/components/home/HeroInput";

/**
 * DeepStudy landing page.
 *
 * Users describe what they want to learn; the LLM produces a flat knowledge-point
 * outline (Phase 1) and we hand it off to the chat workspace (Phase 3).
 *
 * Backward compatibility: `/?session=xxx` still redirects to `/chat/xxx`, so
 * existing shared links keep working.
 */
export default function HomePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session");

    if (sessionId) {
      const capability = params.get("capability");
      const tools = params.getAll("tool");
      let target = `/chat/${sessionId}`;
      const query: string[] = [];
      if (capability) query.push(`capability=${encodeURIComponent(capability)}`);
      tools.forEach((tool) => query.push(`tool=${encodeURIComponent(tool)}`));
      if (query.length) target += `?${query.join("&")}`;
      router.replace(target);
      return;
    }

    setReady(true);
  }, [router]);

  if (!ready) return null;

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-y-auto px-6 py-10">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-[20%] top-[15%] h-64 w-64 rounded-full bg-[var(--primary)]/15 blur-3xl animate-pulse [animation-duration:5s]" />
        <div className="absolute bottom-[15%] right-[20%] h-72 w-72 rounded-full bg-[var(--primary)]/10 blur-3xl animate-pulse [animation-duration:7s]" />
      </div>

      <div className="flex w-full max-w-2xl flex-col items-center">
        <motion.h1
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="text-5xl font-semibold tracking-tight text-[var(--foreground)]"
        >
          DeepStudy
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="mt-3 text-sm text-[var(--muted-foreground)]"
        >
          从一个主题开始，让 AI 陪你一起深入学习
        </motion.p>

        <div className="mt-10 w-full">
          <HeroInput />
        </div>
      </div>
    </div>
  );
}
