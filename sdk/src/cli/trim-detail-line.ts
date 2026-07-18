/** Longest a single rendered detail line may get before it is trimmed. */
const MAX_DETAIL_LINE_LENGTH = 500;

/**
 * Caps one rendered CLI error-detail line at {@link MAX_DETAIL_LINE_LENGTH}
 * characters, appending `...` when it overflows. Applied uniformly to BOTH
 * the raw-body fallback (`format-raw-body.ts`) and the typed-shape message
 * lines (`format-typed-error.ts`) so a pathological server message can never
 * flood the terminal — the trim policy lives in ONE place instead of being
 * duplicated per renderer.
 */
export function trimDetailLine(value: string): string {
  if (value.length <= MAX_DETAIL_LINE_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_DETAIL_LINE_LENGTH)}...`;
}
