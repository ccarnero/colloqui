/**
 * Pretty-prints an arbitrary execution-result payload for display. Lifted
 * verbatim from `workflow-test-panel.component.ts`'s private
 * `stringifyPayload` (IF-editor round-2 task) so the builder inspector's
 * Output tab and the test panel share ONE formatting rule instead of
 * duplicating it — `null`/`undefined` render as no value, strings pass
 * through unchanged, everything else is `JSON.stringify`'d with 2-space
 * indentation, falling back to `String(v)` if stringification itself
 * throws (e.g. a circular structure).
 */
export function stringifyPayload(v: unknown): string | null {
  if (v === null || v === undefined) {
    return null;
  }
  if (typeof v === "string") {
    return v;
  }
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
