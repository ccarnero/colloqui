/**
 * Truncates free-text (prompt/completion) to a safe size for logging/publishing.
 * Mirrors `truncate-body.ts:15-24` in connector-runtime (same 8192-char
 * convention) — agent-ai-service had no equivalent helper before this task
 * (`manual-loops/connectors/connection-call-inspector.md` T04).
 *
 * - Returns undefined for null/undefined input
 * - Passes through string input as-is (up to the limit)
 * - Truncates to 8192 characters if longer
 *
 * @param text - Prompt or completion text (may be undefined)
 * @returns Text truncated to 8192 chars, or undefined
 */
export function truncateText(
  text: string | undefined | null
): string | undefined {
  if (text === undefined || text === null) {
    return undefined;
  }

  const MAX_TEXT_CHARS = 8192;
  return text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
}
