/**
 * Study API client — wraps the /api/v1/outline/{id} and /chat endpoints.
 */

import { apiUrl } from "@/lib/api";
import type {
  Outline,
  StudyChatRequest,
  StudyChatResponse,
} from "@/lib/types/outline";

const CHAT_TIMEOUT_MS = 120_000;

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

export async function postStudyChat(
  outlineId: string,
  payload: StudyChatRequest,
  signal?: AbortSignal,
): Promise<StudyChatResponse> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    CHAT_TIMEOUT_MS,
  );

  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", () => controller.abort(), { once: true });
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
        // fall back
      }
      throw new Error(`对话失败 (${response.status})：${detail}`);
    }

    return (await response.json()) as StudyChatResponse;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
