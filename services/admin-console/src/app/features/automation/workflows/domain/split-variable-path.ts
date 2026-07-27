export interface ISplitVariablePath {
  /** Everything up to and including the last `.`, dimmed in the pill. */
  readonly root: string;
  /** The final path segment, emphasized in the pill. */
  readonly leaf: string;
}

/**
 * Splits a variable path into a dimmed "root" prefix and an emphasized
 * "leaf" segment for the branch condition pill (SPEC
 * console-redesign-builder-v2 IF-editor task, idea 6 — mock's
 * `results.buildAgentContext.` (dim) + `tier` (emphasized)).
 *
 * THIS is the root fix for the "placeholder shown even though a variable is
 * set" bug: the pill always renders the literal stored path text via this
 * pure split, independent of whether that exact path also happens to appear
 * as a `<mat-option>` in the picker's suggestion list. The previous
 * implementation used a native `mat-select` bound directly to
 * `branch.condition.variable`; Angular Material only paints a selected
 * option's label in the trigger when the bound value strictly matches one
 * of the rendered `<mat-option [value]>`s — any stored path outside that
 * synthetically-generated list (e.g. a dot-path like
 * `results.buildAgentContext.tier` when `variableGroups()` only ever emits
 * `results["NodeName"].data...` bracket paths) silently falls back to the
 * placeholder, with no error and no visual sign anything is wrong. Splitting
 * the display from the options list removes that failure mode entirely.
 */
export function splitVariablePath(path: string): ISplitVariablePath {
  const trimmed = path.trim();
  if (!trimmed) {
    return { root: "", leaf: "" };
  }
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot === -1) {
    return { root: "", leaf: trimmed };
  }
  return {
    root: trimmed.slice(0, lastDot + 1),
    leaf: trimmed.slice(lastDot + 1),
  };
}
