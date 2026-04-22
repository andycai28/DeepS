/**
 * Outline generation API client.
 *
 * POST /api/v1/outline/generate is an SSE stream that emits the course's
 * meta fields and KPs as they're parsed out of the LLM token stream, then
 * a final `done` event carrying the fully-assembled Outline.
 */

import { apiUrl } from "@/lib/api";
import type {
  GenerateOutlineRequest,
  KnowledgePoint,
  Outline,
} from "@/lib/types/outline";

const GENERATE_TIMEOUT_MS = 180_000;

export interface StreamOutlineHandlers {
  onTitle?: (value: string) => void;
  onDescription?: (value: string) => void;
  onLanguageDirective?: (value: string) => void;
  onKp?: (kp: KnowledgePoint) => void;
}

/**
 * Drive the /api/v1/outline/generate SSE stream.
 *
 * Fires the appropriate handler for each `event: <name>` frame and resolves
 * with the final `Outline` on the `event: done` frame. Rejects on
 * `event: error`, non-2xx, parse errors, abort or timeout.
 */
export async function streamOutline(
  payload: GenerateOutlineRequest,
  handlers: StreamOutlineHandlers,
  externalSignal?: AbortSignal,
): Promise<Outline> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    GENERATE_TIMEOUT_MS,
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
    const response = await fetch(apiUrl("/api/v1/outline/generate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const body = await response.json();
        if (body && typeof body.detail === "string") detail = body.detail;
      } catch {
        // fall through to statusText
      }
      throw new Error(`生成失败 (${response.status})：${detail}`);
    }

    const body = response.body;
    if (!body) throw new Error("浏览器不支持流式读取");

    const reader = body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    let finalOutline: Outline | null = null;
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
        case "courseTitle":
          if (typeof obj.value === "string") handlers.onTitle?.(obj.value);
          break;
        case "courseDescription":
          if (typeof obj.value === "string") handlers.onDescription?.(obj.value);
          break;
        case "languageDirective":
          if (typeof obj.value === "string")
            handlers.onLanguageDirective?.(obj.value);
          break;
        case "kp":
          handlers.onKp?.(obj as unknown as KnowledgePoint);
          break;
        case "done":
          if (obj.outline && typeof obj.outline === "object") {
            finalOutline = obj.outline as Outline;
          }
          break;
        case "error":
          errorMessage =
            typeof obj.message === "string" ? obj.message : "生成失败";
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
    if (!finalOutline) throw new Error("大纲生成未完成（流被中断）");

    return finalOutline;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
