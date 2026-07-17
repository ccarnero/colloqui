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
// the writer un-substituted), in THREE cases, all naming the ref kind, the
// symbolic name, and the owning resource so `apply-manifest.ts` can treat
// them exactly like a writer failure (stop-at-first-error, never call the
// writer):
//   - `unresolved_symbolic_ref`: an allowlisted key holds a recognized
//     ref-object of the RIGHT kind, but `resolveRef` has no real id for it.
//   - `mismatched_symbolic_ref`: an allowlisted key holds a recognized
//     ref-object whose kind is NOT the one that key accepts (e.g.
//     `{ agentRef }` in `accountId`, which only accepts `channelRef`).
//   - `unallowlisted_symbolic_ref` (manual-loops/provisioning-manifest-gaps-2.md
//     T02, gap 3, decision 5 ruling 2026-07-16, FAIL LOUD): a key that is
//     NOT in `SUBSTITUTION_ALLOWLIST` at all holds a recognized single-key
//     ref-object of a SUBSTITUTABLE kind anyway (e.g. today's un-substituted
//     `connectorId`). Before this fix such an object was walked as a plain
//     nested object and persisted verbatim — silent corruption, since the
//     writer would receive a `{ <refType>: <name> }` object where it expects
//     a plain string/id that some upstream step should have substituted.
//     Checked at EVERY non-allowlisted key, at any nesting depth, exactly
//     like the allowlisted-key check.
//
//     EXEMPTION: `secretRef`. Unlike the substitutable kinds
//     (channelRef/agentRef/serviceRef/connectorRef/mcpServerRef, which resolve
//     to a real platform id at APPLY time and are corrupt if they reach a
//     writer un-substituted), `secretRef` has a fundamentally different
//     lifecycle: it is NEVER substituted by this walker — it is validated
//     against `spec.secrets` at manifest time and resolved by the secrets
//     broker / downstream consumers at RUNTIME. Two sources confirm a
//     `{ secretRef: <name> }` object legitimately appears inside a walked
//     workflow `definition` at ANY depth, and this walker must let it pass:
//       1. `packages/shared/src/provisioning/manifest.schema.ts:610-618` —
//          the workflow schema's own comment states definition steps "may
//          embed channelRef/agentRef/serviceRef/secretRef/connectorRef keys
//          at any depth; those are walked and resolved by the structural-rule
//          validators".
//       2. `packages/shared/src/provisioning/validate-structural-rules.ts`
//          `checkRefResolution` — runs `collectSymbolicRefs` over EVERY
//          `workflow.definition` and has a live `case "secretRef"` validating
//          the ref against `spec.secrets`. The structural validator is built
//          to ACCEPT a secretRef embedded in a definition; failing it loud
//          here would reject a manifest that validate was designed to pass.
//     So a recognized `{ secretRef }` at a non-allowlisted key passes through
//     untouched (recurse/continue), while every OTHER SYMBOLIC_REF_KEYS kind
//     at a non-allowlisted key still fails loud.
//
// Only genuinely non-ref-shaped values (literal id strings, runtime
// `{{...}}` templates, multi-key objects, single-key objects whose key is
// not a SYMBOLIC_REF_KEYS member) — plus `{ secretRef }` at any key, per the
// exemption above — legitimately pass through, at ANY key.
//
// manual-loops/provisioning-manifest-gaps-3.md T03, workstream d — ARRAY
// symbolic-ref substitution. `ARRAY_SUBSTITUTION_ALLOWLIST`
// (`array-substitution-allowlist.ts`) pairs a PLURAL argument key (today,
// only `accountIds`) with the ONE ref kind each of its array elements must
// carry. When the current key is array-allowlisted AND its value is an
// ARRAY, every element is substituted independently via the SAME
// `readRecognizedRefObject`/`resolveRef` logic proven for the scalar case,
// BEFORE falling through to the generic array-recursion branch:
//   - a recognized ref-object element of the RIGHT kind -> resolved to its
//     real id, exactly like the scalar case;
//   - a recognized ref-object element of the WRONG kind ->
//     `mismatched_symbolic_ref`, naming the ELEMENT'S path (e.g.
//     `...trigger.config.accountIds[0]`);
//   - a recognized ref-object element of the RIGHT kind but unresolved ->
//     `unresolved_symbolic_ref`, same per-element path naming;
//   - a MIXED array is legal: elements that are NOT a recognized ref-object
//     (already-real id strings, runtime `{{...}}` templates) pass through
//     untouched (recursed generically, in case they nest further content),
//     alongside ref-object elements that DO get substituted.
// A NON-array value at an array-allowlisted key fails loud
// (`invalid_array_substitution_shape`) rather than silently falling back to
// scalar handling — the key is documented as plural, so a non-array value
// there is an authoring-shape mismatch, not a legitimate scalar use.
//
// The `unallowlisted_symbolic_ref` safety fix (T02, gap 3) is likewise
// extended to fire PER-ELEMENT for an array of ref-objects sitting at a key
// that is in NEITHER allowlist — a stray ref-shaped array element at a
// non-allowlisted plural key is exactly as corrupting as a stray scalar one,
// with the same `secretRef` exemption applied per element.

import type { SymbolicRefType } from "@yoizen/shared";
import { SYMBOLIC_REF_KEYS } from "@yoizen/shared";
import type { ResourceKind } from "../../plan/domain/plan.interfaces";
import type { ApplyWriteError } from "../domain/apply.interfaces";
import { ALLOWLISTED_ARRAY_SUBSTITUTION_KEYS } from "./array-substitution-allowlist";
import { ALLOWLISTED_SUBSTITUTION_KEYS } from "./substitution-allowlist";

const REF_KEY_SET: ReadonlySet<string> = new Set(SYMBOLIC_REF_KEYS);

export interface SubstituteSymbolicRefsArgs {
  readonly value: unknown;
  // manual-loops/provisioning-manifest-gaps-2.md T03, gap 2 — widened with
  // "knowledgeBase" so `substitute-kb-ingestion-config.ts` (a NEW tree root,
  // `knowledgeBases[].ingestion_config`) can reuse this SAME walker; see
  // `apply.interfaces.ts`'s `ApplyWriteError.resourceKind` comment for why
  // this is a narrow widening of the error-reporting type only, not of
  // `ResourceKind` itself.
  readonly owningResourceKind: ResourceKind | "knowledgeBase";
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
      const expectedArrayRefType = ALLOWLISTED_ARRAY_SUBSTITUTION_KEYS.get(key);

      if (expectedArrayRefType !== undefined) {
        // manual-loops/provisioning-manifest-gaps-3.md T03, workstream d —
        // `key` is in `ARRAY_SUBSTITUTION_ALLOWLIST` (today, only
        // `accountIds`). Substitute per-element BEFORE falling through to
        // the generic array-recursion branch below.
        if (!Array.isArray(child)) {
          return {
            ok: false,
            error: {
              kind: "invalid_array_substitution_shape",
              resourceKind: args.owningResourceKind,
              resourceName: args.owningResourceName,
              message: `${args.owningResourceKind} '${args.owningResourceName}' at ${childPath} is array-allowlisted (key '${key}' expects an array of ${expectedArrayRefType} ref-objects) but its value is not an array — cannot substitute`,
            },
          };
        }
        const outArr: unknown[] = [];
        for (let i = 0; i < child.length; i++) {
          const element = child[i];
          const elementPath = `${childPath}[${String(i)}]`;
          const recognized = readRecognizedRefObject(element);
          if (recognized) {
            if (recognized.refType !== expectedArrayRefType) {
              return {
                ok: false,
                error: {
                  kind: "mismatched_symbolic_ref",
                  resourceKind: args.owningResourceKind,
                  resourceName: args.owningResourceName,
                  message: `${args.owningResourceKind} '${args.owningResourceName}' at ${elementPath} references ${recognized.refType} '${recognized.name}', but the array-allowlisted key '${key}' only accepts ${expectedArrayRefType} — mismatched symbolic ref kind`,
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
                  message: `${args.owningResourceKind} '${args.owningResourceName}' at ${elementPath} references unresolved ${recognized.refType} '${recognized.name}' — no real id available for it (never created/resolved, or a dependency-order gap)`,
                },
              };
            }
            args.onSubstituted?.({
              argKey: key,
              refType: recognized.refType,
              name: recognized.name,
              realId,
              path: elementPath,
            });
            outArr.push(realId);
            continue;
          }
          // Not a recognized ref-object element — a literal id string or a
          // runtime `{{...}}` template, legally mixed alongside ref-object
          // elements. Recurse generically (mirrors the scalar-key
          // passthrough) in case it nests further allowlisted content.
          const elementResult = walk(element, elementPath, args);
          if (!elementResult.ok) {
            return elementResult;
          }
          outArr.push(elementResult.value);
        }
        out[key] = outArr;
        continue;
      }

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
      } else {
        // T02, gap 3, decision 5 (FAIL LOUD) — `key` is NOT in
        // `SUBSTITUTION_ALLOWLIST` at all, so it was never a candidate for
        // substitution. If its value is STILL a recognized single-key
        // ref-object of a SUBSTITUTABLE kind, persisting it verbatim would
        // silently corrupt the resource — fail loud instead of recursing.
        // EXEMPTION: `secretRef` is never substituted by this walker (it is
        // validated against `spec.secrets` at manifest time and resolved by
        // the broker/consumers at runtime); it legitimately appears inside a
        // workflow `definition` at any depth (see this file's header, sources
        // 1 and 2), so it passes through untouched like a plain value.
        //
        // manual-loops/provisioning-manifest-gaps-3.md T03, workstream d —
        // the SAME check must fire PER-ELEMENT for an array of ref-objects
        // sitting at a key that is in NEITHER allowlist: a stray ref-shaped
        // array element here is exactly as corrupting as a stray scalar one.
        if (Array.isArray(child)) {
          for (let i = 0; i < child.length; i++) {
            const recognized = readRecognizedRefObject(child[i]);
            if (recognized && recognized.refType !== "secretRef") {
              return {
                ok: false,
                error: {
                  kind: "unallowlisted_symbolic_ref",
                  resourceKind: args.owningResourceKind,
                  resourceName: args.owningResourceName,
                  message: `${args.owningResourceKind} '${args.owningResourceName}' at ${childPath}[${String(i)}] holds a recognized ${recognized.refType} ref-object '${recognized.name}' at key '${key}', which is not in ARRAY_SUBSTITUTION_ALLOWLIST — this ref would never be substituted and persisting it verbatim would silently corrupt the resource`,
                },
              };
            }
          }
        } else {
          const recognized = readRecognizedRefObject(child);
          if (recognized && recognized.refType !== "secretRef") {
            return {
              ok: false,
              error: {
                kind: "unallowlisted_symbolic_ref",
                resourceKind: args.owningResourceKind,
                resourceName: args.owningResourceName,
                message: `${args.owningResourceKind} '${args.owningResourceName}' at ${childPath} holds a recognized ${recognized.refType} ref-object '${recognized.name}' at key '${key}', which is not in SUBSTITUTION_ALLOWLIST — this ref would never be substituted and persisting it verbatim would silently corrupt the resource`,
              },
            };
          }
        }
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
