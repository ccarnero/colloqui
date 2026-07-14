// Field-level diff between the manifest's desired resource shape and the
// live platform resource's projected `fields`. Pure — no I/O.
//
// Verdict rules:
// - live === null                → "create" (nothing to diff against)
// - live found, all fields equal → "noop"
// - live found, any field differs → "update", with one `FieldDiff` per
//   differing top-level key (present in either side).

import type { FieldDiff, ResourceVerdict } from "../domain/plan.interfaces";
import { deepEqual } from "./deep-equal";

export interface DiffResult {
  readonly verdict: ResourceVerdict;
  readonly diff: FieldDiff[];
}

export function diffResource(
  desired: Readonly<Record<string, unknown>>,
  live: Readonly<Record<string, unknown>> | null
): DiffResult {
  if (live === null) {
    return { verdict: "create", diff: [] };
  }

  const keys = new Set([...Object.keys(desired), ...Object.keys(live)]);
  const diff: FieldDiff[] = [];
  for (const key of keys) {
    const desiredValue = desired[key];
    const currentValue = live[key];
    if (!deepEqual(desiredValue, currentValue)) {
      diff.push({ field: key, current: currentValue, desired: desiredValue });
    }
  }

  return diff.length === 0
    ? { verdict: "noop", diff: [] }
    : { verdict: "update", diff };
}
