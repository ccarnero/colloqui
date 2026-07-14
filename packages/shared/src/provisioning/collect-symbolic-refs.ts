// Pure walker over an opaque workflow `definition` object (or any nested
// JSON-like value) that collects symbolic ref occurrences — object keys that
// are exactly one of channelRef/agentRef/serviceRef/secretRef with a string
// value — at any nesting depth, alongside the dot/bracket path where each
// occurrence was found.

import { SYMBOLIC_REF_KEYS, type SymbolicRefType } from "./manifest.schema";

export interface SymbolicRefOccurrence {
  refType: SymbolicRefType;
  value: string;
  path: string;
}

const REF_KEY_SET: ReadonlySet<string> = new Set(SYMBOLIC_REF_KEYS);

export function collectSymbolicRefs(
  value: unknown,
  basePath: string
): SymbolicRefOccurrence[] {
  const occurrences: SymbolicRefOccurrence[] = [];
  walk(value, basePath, occurrences);
  return occurrences;
}

function walk(
  value: unknown,
  path: string,
  out: SymbolicRefOccurrence[]
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, out));
    return;
  }

  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>
    )) {
      const childPath = `${path}.${key}`;
      if (REF_KEY_SET.has(key) && typeof child === "string") {
        out.push({
          refType: key as SymbolicRefType,
          value: child,
          path: childPath,
        });
        continue;
      }
      walk(child, childPath, out);
    }
  }
}
