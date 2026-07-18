import { trimDetailLine } from "./trim-detail-line.js";

/**
 * Last-resort renderer for a response body whose shape none of the typed
 * renderers recognized — JSON-stringifies it and trims via `trimDetailLine`
 * so an unexpected shape is still surfaced (nothing is ever silently
 * swallowed) without flooding the terminal. Returns no lines for an
 * empty/`{}`/`[]` body, which carries no useful detail.
 */
export function formatRawBody(body: unknown): string[] {
  let raw: string;
  try {
    raw = JSON.stringify(body);
  } catch {
    raw = String(body);
  }
  if (!raw || raw === "{}" || raw === "[]") {
    return [];
  }
  return [`  ${trimDetailLine(raw)}`];
}
