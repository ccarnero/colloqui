/**
 * Pure pattern matching for auto-reply rules (wildcard, substring, regex:).
 *
 * @param text    Incoming message text.
 * @param pattern Rule trigger pattern.
 * @param onInvalidRegex Optional callback when a regex: pattern is invalid.
 * @returns Whether the rule should fire.
 */
export function matchAutoReplyPattern(
  text: string,
  pattern: string,
  onInvalidRegex?: (message: string) => void,
): boolean {
  if (pattern === "*") {
    return true;
  }

  const lowerText = text.toLowerCase();
  const lowerPattern = pattern.toLowerCase();

  if (lowerPattern.startsWith("regex:")) {
    try {
      const regex = new RegExp(lowerPattern.slice(6), "i");
      return regex.test(text);
    } catch (e: unknown) {
      const detail = e instanceof Error ? e.message : String(e);
      onInvalidRegex?.(`Invalid regex in auto-reply pattern: ${detail}`);
      return false;
    }
  }

  return lowerText.includes(lowerPattern);
}
