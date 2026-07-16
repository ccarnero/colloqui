// manual-loops/provisioning-manifest-gaps.md T03, gap 3 — manifest-time
// real-ID substitution.
//
// Pure walker over a workflow `definition` (or agent `profile`) tree that
// replaces the recognized ref-object shape — `{ <refType>: <manifestName> }`,
// a single-key object whose key is one of `SYMBOLIC_REF_KEYS` — with the
// real platform id, but ONLY when it sits at an argument key from
// `SUBSTITUTION_ALLOWLIST` (decision 4 ruling — see that file's header for
// why this is an allowlist, never a structural "*Ref" walk).
//
// Works on a WORKING COPY only: every object/array touched is rebuilt via
// spread/`map`, the input `value` is never mutated. Callers (`apply-manifest.ts`)
// pass the manifest's own `definition`/`profile` object; because this
// function never mutates it, the ORIGINAL manifest object stored by
// `PUT /manifests/:name` is untouched and `GET /manifests/:name` keeps
// returning exactly what the tenant authored.
//
// RUNTIME `{{...}}` template strings are untouched by design: they are
// plain strings, never the `{ <refType>: <name> }` ref-object shape this
// walker recognizes, so they pass straight through at any nesting depth.
//
// Fails loud (never a silent passthrough of a symbolic ref that would reach
// the writer un-substituted), in two cases, both naming the ref kind, the
// symbolic name, and the owning resource so `apply-manifest.ts` can treat
// them exactly like a writer failure (stop-at-first-error, never call the
// writer):
//   - `unresolved_symbolic_ref`: an allowlisted key holds a recognized
//     ref-object of the RIGHT kind, but `resolveRef` has no real id for it.
//   - `mismatched_symbolic_ref`: an allowlisted key holds a recognized
//     ref-object whose kind is NOT the one that key accepts (e.g.
//     `{ agentRef }` in `accountId`, which only accepts `channelRef`).
// Only genuinely non-ref-shaped values (literal id strings, runtime
// `{{...}}` templates, multi-key objects, single-key objects whose key is
// not a SYMBOLIC_REF_KEYS member) legitimately pass through at an
// allowlisted key.

import type { SymbolicRefType } from "@yoizen/shared";
import { SYMBOLIC_REF_KEYS } from "@yoizen/shared";
import type { ResourceKind } from "../../plan/domain/plan.interfaces";
import type { ApplyWriteError } from "../domain/apply.interfaces";
import { ALLOWLISTED_SUBSTITUTION_KEYS } from "./substitution-allowlist";

const REF_KEY_SET: ReadonlySet<string> = new Set(SYMBOLIC_REF_KEYS);

export interface SubstituteSymbolicRefsArgs {
  readonly value: unknown;
  readonly owningResourceKind: ResourceKind;
  readonly owningResourceName: string;
  /** Resolves `(refType, manifestName) -> realId`, `undefined` if unresolved. */
  readonly resolveRef: (
    refType: SymbolicRefType,
    name: string
  ) => string | undefined;
  readonly onSubstituted?: (args: {
    argKey: string;
    refType: SymbolicRefType;
    name: string;
    realId: string;
    path: string;
  }) => void;
}

export type SubstituteSymbolicRefsResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: ApplyWriteError };

/** Returns the single `{ refType: name }` entry recognized as a ref object, or `null`. */
function readRecognizedRefObject(
  value: unknown
): { refType: SymbolicRefType; name: string } | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length !== 1) {
    return null;
  }
  const [key, refValue] = entries[0] as [string, unknown];
  if (!REF_KEY_SET.has(key) || typeof refValue !== "string") {
    return null;
  }
  return { refType: key as SymbolicRefType, name: refValue };
}

export function substituteSymbolicRefs(
  args: SubstituteSymbolicRefsArgs
): SubstituteSymbolicRefsResult {
  return walk(args.value, "definition", args);
}

function walk(
  value: unknown,
  path: string,
  args: SubstituteSymbolicRefsArgs
): SubstituteSymbolicRefsResult {
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      const result = walk(value[i], `${path}[${String(i)}]`, args);
      if (!result.ok) {
        return result;
      }
      out.push(result.value);
    }
    return { ok: true, value: out };
  }

  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>
    )) {
      const childPath = `${path}.${key}`;
      const expectedRefType = ALLOWLISTED_SUBSTITUTION_KEYS.get(key);

      if (expectedRefType !== undefined) {
        const recognized = readRecognizedRefObject(child);
        if (recognized) {
          // A recognized single-key ref-object sits at an allowlisted key —
          // it MUST carry the one ref kind this key accepts. A mismatched
          // kind is still a symbolic ref that would never resolve;
          // forwarding it raw to the writer would only surface at runtime
          // with no trail, so fail loud naming expected vs actual.
          if (recognized.refType !== expectedRefType) {
            return {
              ok: false,
              error: {
                kind: "mismatched_symbolic_ref",
                resourceKind: args.owningResourceKind,
                resourceName: args.owningResourceName,
                message: `${args.owningResourceKind} '${args.owningResourceName}' at ${childPath} references ${recognized.refType} '${recognized.name}', but the allowlisted key '${key}' only accepts ${expectedRefType} — mismatched symbolic ref kind`,
              },
            };
          }
          const realId = args.resolveRef(recognized.refType, recognized.name);
          if (realId === undefined) {
            return {
              ok: false,
              error: {
                kind: "unresolved_symbolic_ref",
                resourceKind: args.owningResourceKind,
                resourceName: args.owningResourceName,
                message: `${args.owningResourceKind} '${args.owningResourceName}' at ${childPath} references unresolved ${recognized.refType} '${recognized.name}' — no real id available for it (never created/resolved, or a dependency-order gap)`,
              },
            };
          }
          args.onSubstituted?.({
            argKey: key,
            refType: recognized.refType,
            name: recognized.name,
            realId,
            path: childPath,
          });
          out[key] = realId;
          continue;
        }
        // The value is NOT a recognized single-key ref-object (a literal id
        // string, a runtime `{{...}}` template, a multi-key object, or a
        // single-key object whose key is not a SYMBOLIC_REF_KEYS member) —
        // legitimately passes through untouched. Keep walking in case it
        // nests further allowlisted keys.
      }

      const result = walk(child, childPath, args);
      if (!result.ok) {
        return result;
      }
      out[key] = result.value;
    }
    return { ok: true, value: out };
  }

  // Primitive (string, number, boolean, null, undefined) — including
  // RUNTIME `{{...}}` template strings — passes through untouched.
  return { ok: true, value };
}
