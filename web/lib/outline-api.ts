/**
 * Outline API client — wraps POST /api/v1/outline/generate.
 */

import { apiUrl } from "@/lib/api";
import type { GenerateOutlineRequest, Outline } from "@/lib/types/outline";

const GENERATE_TIMEOUT_MS = 120_000;

export async function generateOutline(
  payload: GenerateOutlineRequest,
  signal?: AbortSignal,
): Promise<Outline> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    GENERATE_TIMEOUT_MS,
  );

  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", () => controller.abort(), {
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
        // ignore JSON parse error — fall back to statusText
      }
      throw new Error(`生成失败 (${response.status})：${detail}`);
    }

    return (await response.json()) as Outline;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
