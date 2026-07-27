export interface IIdSelectOption {
  readonly id: string;
  readonly label: string;
}

export interface IIdSelectDisplay {
  /** Text to render in the closed `mat-select` trigger. */
  readonly text: string;
  /**
   * `true` when the stored value does NOT match any currently loaded
   * option — i.e. the referenced record was removed/renamed server-side
   * (a stale reference), not merely "options haven't loaded yet".
   */
  readonly unavailable: boolean;
}

/**
 * Root fix for the "select shows its placeholder even though a value IS
 * configured" bug family (same family as `split-variable-path.ts`'s IF
 * variable pill fix). Angular Material's `mat-select` only paints a
 * selected option's label into the closed trigger when the bound value
 * strictly matches one of the currently rendered `<mat-option [value]>`s.
 * Because every option list this fixes (adapters, endpoints, MCP
 * servers/tools, registered services, AI agents, channel accounts) loads
 * asynchronously, and because the referenced record can legitimately be
 * removed/renamed after the workflow was saved, the bound value can be
 * non-empty while never matching an option — Material then silently falls
 * back to the placeholder, indistinguishable from "nothing configured".
 *
 * This function decouples the trigger's DISPLAY from that option-matching
 * entirely: it is driven purely by (value, options, optionsLoaded), so a
 * configured value ALWAYS renders — as the matched option's label when
 * found, or as `fallbackText` (or the raw id) marked `unavailable` once
 * the options are known to have loaded and still don't contain it. While
 * options are still loading, the value is shown WITHOUT the unavailable
 * mark — a load-in-progress is not evidence of staleness.
 *
 * Returns `null` only for the genuine empty state (no value configured at
 * all), which is the ONLY case the placeholder should render for.
 */
export function resolveIdSelectDisplay(params: {
  readonly value: unknown;
  readonly options: readonly IIdSelectOption[];
  readonly optionsLoaded: boolean;
  readonly fallbackText?: string | null;
}): IIdSelectDisplay | null {
  const { value, options, optionsLoaded, fallbackText } = params;
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const match = options.find((o) => o.id === value);
  if (match) {
    return { text: match.label, unavailable: false };
  }

  const fallback =
    fallbackText && fallbackText.trim().length > 0 ? fallbackText : value;
  return { text: fallback, unavailable: optionsLoaded };
}
