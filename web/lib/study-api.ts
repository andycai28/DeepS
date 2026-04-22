/**
 * Study API client — wraps /api/v1/outline/{id} fetch + /chat streaming.
 */

import { apiUrl } from "@/lib/api";
import type {
  AgentProfile,
  DiscussionRequest,
  Outline,
  StudyChatRequest,
} from "@/lib/types/outline";

const CHAT_TIMEOUT_MS = 180_000;
const DISCUSS_TIMEOUT_MS = 240_000;

export async function fetchOutline(
  outlineId: string,
  signal?: AbortSignal,
): Promise<Outline> {
  const response = await fetch(
    apiUrl(`/api/v1/outline/${encodeURIComponent(outlineId)}`),
    { signal },
  );

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      if (body && typeof body.detail === "string") detail = body.detail;
    } catch {
      // fall back to statusText
    }
    throw new Error(`加载大纲失败 (${response.status})：${detail}`);
  }

  return (await response.json()) as Outline;
}

export interface StreamStudyChatHandlers {
  /** Called with each token/chunk the tutor emits. */
  onChunk?: (content: string) => void;
}

export interface StreamStudyChatResult {
  reply: string;
  isOpening: boolean;
}

/**
 * Open an SSE stream for POST /api/v1/outline/{id}/chat.
 *
 * Calls `onChunk` for every `event: chunk` frame. Resolves with the
 * concatenated reply + `isOpening` flag on the `event: done` frame.
 * Rejects on `event: error`, non-2xx HTTP, parse errors, or abort.
 */
export async function streamStudyChat(
  outlineId: string,
  payload: StudyChatRequest,
  handlers: StreamStudyChatHandlers,
  externalSignal?: AbortSignal,
): Promise<StreamStudyChatResult> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    CHAT_TIMEOUT_MS,
  );

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }
  }

  try {
    const response = await fetch(
      apiUrl(`/api/v1/outline/${encodeURIComponent(outlineId)}/chat`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const body = await response.json();
        if (body && typeof body.detail === "string") detail = body.detail;
      } catch {
        // fall through
      }
      throw new Error(`对话失败 (${response.status})：${detail}`);
    }

    const body = response.body;
    if (!body) {
      throw new Error("浏览器不支持流式读取");
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    let reply = "";
    let isOpening = false;
    let errorMessage: string | null = null;
    let doneSeen = false;

    // Parse one SSE frame (a `\n\n`-separated block) into (event, data).
    const parseFrame = (raw: string): { event: string; data: string } | null => {
      let event = "message";
      let data = "";
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          data += line.slice(5).replace(/^\s/, "");
        }
      }
      if (!data) return null;
      return { event, data };
    };

    const handleFrame = (raw: string) => {
      const parsed = parseFrame(raw);
      if (!parsed) return;
      let payloadObj: unknown;
      try {
        payloadObj = JSON.parse(parsed.data);
      } catch {
        return;
      }
      const obj = payloadObj as Record<string, unknown>;

      if (parsed.event === "chunk") {
        const content = typeof obj.content === "string" ? obj.content : "";
        if (content) {
          reply += content;
          handlers.onChunk?.(content);
        }
      } else if (parsed.event === "done") {
        isOpening = Boolean(obj.isOpening);
        doneSeen = true;
      } else if (parsed.event === "error") {
        errorMessage =
          typeof obj.message === "string" ? obj.message : "tutor stream error";
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep = buffer.indexOf("\n\n");
      while (sep !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        if (frame.trim()) handleFrame(frame);
        sep = buffer.indexOf("\n\n");
      }

      if (errorMessage) break;
    }

    // Drain any trailing (unterminated) frame.
    if (buffer.trim() && !errorMessage) {
      handleFrame(buffer);
    }

    if (errorMessage) {
      throw new Error(errorMessage);
    }
    if (!doneSeen) {
      throw new Error("对话流被意外中断");
    }

    return { reply, isOpening };
  } finally {
    window.clearTimeout(timeoutId);
  }
}


export interface StreamDiscussHandlers {
  onDirectorThinking?: () => void;
  onAgentStart?: (agent: AgentProfile) => void;
  onAgentChunk?: (agentId: string, content: string) => void;
  onAgentEnd?: (agentId: string) => void;
  onCueUser?: () => void;
  onEnd?: () => void;
}

/**
 * Drive the /api/v1/outline/{id}/discuss SSE stream.
 *
 * Resolves when the stream closes (after `cue_user` / `end` / `error`).
 * Unlike the tutor stream, there is no single aggregated reply — the
 * caller tracks per-agent buffers via the `onAgentChunk` handler.
 */
export async function streamDiscuss(
  outlineId: string,
  payload: DiscussionRequest,
  handlers: StreamDiscussHandlers,
  externalSignal?: AbortSignal,
): Promise<void> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    DISCUSS_TIMEOUT_MS,
  );

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }
  }

  try {
    const response = await fetch(
      apiUrl(
        `/api/v1/outline/${encodeURIComponent(outlineId)}/discuss`,
      ),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const body = await response.json();
        if (body && typeof body.detail === "string") detail = body.detail;
      } catch {
        // fall through
      }
      throw new Error(`讨论失败 (${response.status})：${detail}`);
    }

    const body = response.body;
    if (!body) throw new Error("浏览器不支持流式读取");

    const reader = body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    let errorMessage: string | null = null;

    const parseFrame = (raw: string): { event: string; data: string } | null => {
      let event = "message";
      let data = "";
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          data += line.slice(5).replace(/^\s/, "");
        }
      }
      if (!data) return null;
      return { event, data };
    };

    const handleFrame = (raw: string) => {
      const parsed = parseFrame(raw);
      if (!parsed) return;
      let payloadObj: unknown;
      try {
        payloadObj = JSON.parse(parsed.data);
      } catch {
        return;
      }
      const obj = payloadObj as Record<string, unknown>;

      switch (parsed.event) {
        case "director_thinking":
          handlers.onDirectorThinking?.();
          break;
        case "agent_start": {
          // Backend wraps the profile under an "agent" key; unwrap before
          // handing to the handler.
          const profile = (obj as { agent?: unknown }).agent;
          if (profile && typeof profile === "object") {
            handlers.onAgentStart?.(profile as AgentProfile);
          }
          break;
        }
        case "agent_chunk": {
          const agentId =
            typeof obj.agentId === "string" ? obj.agentId : "";
          const content =
            typeof obj.content === "string" ? obj.content : "";
          if (agentId && content) handlers.onAgentChunk?.(agentId, content);
          break;
        }
        case "agent_end": {
          const agentId =
            typeof obj.agentId === "string" ? obj.agentId : "";
          if (agentId) handlers.onAgentEnd?.(agentId);
          break;
        }
        case "cue_user":
          handlers.onCueUser?.();
          break;
        case "end":
          handlers.onEnd?.();
          break;
        case "error":
          errorMessage =
            typeof obj.message === "string" ? obj.message : "讨论流错误";
          break;
        default:
          break;
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep = buffer.indexOf("\n\n");
      while (sep !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        if (frame.trim()) handleFrame(frame);
        sep = buffer.indexOf("\n\n");
      }

      if (errorMessage) break;
    }

    if (buffer.trim() && !errorMessage) handleFrame(buffer);

    if (errorMessage) throw new Error(errorMessage);
  } finally {
    window.clearTimeout(timeoutId);
  }
}
