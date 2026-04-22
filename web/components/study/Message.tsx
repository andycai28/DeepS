"use client";

import { Bot, User } from "lucide-react";

import MarkdownRenderer from "@/components/common/MarkdownRenderer";
import type { StudyMessage } from "@/lib/types/outline";

interface MessageProps {
  message: StudyMessage;
}

function firstChar(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.charAt(0);
}

export default function Message({ message }: MessageProps) {
  const isUser = message.role === "user";

  // Discussion-mode messages carry an agent identity — render a
  // colored avatar + name chip instead of the generic bot icon.
  const isCastMember =
    !isUser && Boolean(message.agentId) && Boolean(message.agentName);

  const avatarBackground = isUser
    ? "var(--primary)"
    : isCastMember && message.agentColor
      ? message.agentColor
      : "var(--muted)";

  const avatarColor = isUser || isCastMember
    ? "white"
    : "var(--muted-foreground)";

  const initial = isUser
    ? ""
    : isCastMember
      ? message.agentAvatarInitial ||
        firstChar(message.agentName, "AI")
      : "";

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
        style={{ backgroundColor: avatarBackground, color: avatarColor }}
        aria-label={isUser ? "你" : message.agentName || "AI 老师"}
      >
        {isUser ? (
          <User className="h-3.5 w-3.5" />
        ) : isCastMember ? (
          <span>{initial}</span>
        ) : (
          <Bot className="h-3.5 w-3.5" />
        )}
      </div>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
            : "border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)]"
        }`}
      >
        {isCastMember && message.agentName && (
          <div
            className="mb-1 text-[11px] font-medium"
            style={{ color: message.agentColor || "var(--muted-foreground)" }}
          >
            {message.agentName}
          </div>
        )}
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <MarkdownRenderer content={message.content} variant="compact" />
        )}
      </div>
    </div>
  );
}
