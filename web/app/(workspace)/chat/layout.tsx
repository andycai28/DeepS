"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BookOpen } from "lucide-react";

import OutlineSidebar from "@/components/study/OutlineSidebar";
import { fetchOutline } from "@/lib/study-api";
import type { Outline } from "@/lib/types/outline";

const OUTLINE_STORAGE_PREFIX = "ds:outline:";
const ACTIVE_OUTLINE_STORAGE_KEY = "ds:chat:activeOutlineId";

function EmptyOutlineSidebar() {
  return (
    <aside className="flex h-screen w-[280px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--secondary)]">
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <BookOpen className="h-8 w-8 text-[var(--muted-foreground)]/60" />
        <p className="text-sm text-[var(--muted-foreground)]">
          还没有正在学习的课程
        </p>
        <p className="text-xs leading-relaxed text-[var(--muted-foreground)]/70">
          回到首页输入一个主题，生成大纲后自动带到这里
        </p>
      </div>
    </aside>
  );
}

/**
 * /chat layout — swaps the main nav for the outline's knowledge-point
 * tree when an outline is active. Active outline_id comes from either:
 *   1. ?outline_id=xxx on /chat when the user lands via /generate
 *   2. sessionStorage fallback, which survives the chat page's URL
 *      rewrite (/chat → /chat/{sessionId}) on first message send
 *
 * Lives outside the (nav) route group so swapping between /chat and the
 * rest of the workspace doesn't remount either sidebar.
 */
export default function ChatLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const searchParams = useSearchParams();
  const [outline, setOutline] = useState<Outline | null>(null);
  const [selectedKpId, setSelectedKpId] = useState<string | null>(null);

  useEffect(() => {
    const fromUrl = searchParams?.get("outline_id") ?? null;
    if (fromUrl) {
      sessionStorage.setItem(ACTIVE_OUTLINE_STORAGE_KEY, fromUrl);
    }
    const activeId =
      fromUrl ?? sessionStorage.getItem(ACTIVE_OUTLINE_STORAGE_KEY);

    if (!activeId) {
      setOutline(null);
      return;
    }

    // SessionStorage cache first (hot path when returning to /chat).
    const cacheKey = `${OUTLINE_STORAGE_PREFIX}${activeId}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      try {
        setOutline(JSON.parse(cached) as Outline);
        return;
      } catch {
        sessionStorage.removeItem(cacheKey);
      }
    }

    // Cache miss → fetch from backend.
    let alive = true;
    fetchOutline(activeId)
      .then((data) => {
        if (!alive) return;
        setOutline(data);
        sessionStorage.setItem(cacheKey, JSON.stringify(data));
      })
      .catch((err) => {
        if (!alive) return;
        // Bad id — wipe the active-outline pointer so the sidebar
        // doesn't keep trying to resolve a dead outline.
        if (err instanceof Error && /404/.test(err.message)) {
          sessionStorage.removeItem(ACTIVE_OUTLINE_STORAGE_KEY);
          setOutline(null);
        }
        // eslint-disable-next-line no-console
        console.warn("chat layout: failed to load outline", err);
      });

    return () => {
      alive = false;
    };
  }, [searchParams]);

  return (
    <>
      {outline ? (
        <OutlineSidebar
          outline={outline}
          selectedKpId={selectedKpId}
          onSelectKp={(kp) => setSelectedKpId(kp.id)}
          onNewTopic={() => setSelectedKpId(null)}
          isBusy={false}
        />
      ) : (
        <EmptyOutlineSidebar />
      )}
      <main className="flex-1 overflow-hidden bg-[var(--background)]">
        {children}
      </main>
    </>
  );
}
