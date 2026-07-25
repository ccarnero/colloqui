// manual-loops/provisioning-manifest-gaps-2.md T03, gap 2.
//
// Substitutes allowlisted symbolic refs (today: `provider_connector_id` ->
// `connectorRef`, see `substitution-allowlist.ts`) inside a knowledge base's
// `ingestion_config` tree — a NEW tree root for the SAME mechanism T02/T03
// use for workflow `definition` / agent `profile` (`substitute-symbolic-refs.ts`
// itself is untouched, generic over `value`/`owningResourceKind`). HUMAN
// RULING (decision 4, resolved 2026-07-16): ALLOWLIST + KB-TREE WALK — no
// changes to agent-ai-service's credential-resolver.
//
// Only invoked when CREATING a new (non-external) KB
// (`reconcile-knowledge-base.ts`'s `findOrCreateKb`) — an ALREADY-EXISTING
// KB's `ingestion_config` is never touched by apply (documented pre-existing
// limitation: "no mutable KB fields to reconcile in T06"), so this function
// is never called against a live/found KB. Unaffected by that scope: no new
// behavior change for existing KBs, no bespoke error kind — a failure here
// returns the EXACT `KbReconcileErrorKind` string literal the walker
// produced (`unresolved_symbolic_ref` / `mismatched_symbolic_ref` /
// `unallowlisted_symbolic_ref`).

import type { SymbolicRefType } from "@yoizen/shared";
import { substituteSymbolicRefs } from "../../plan/lib/substitute-symbolic-refs";
import type { KbReconcileError, KbResolveRef } from "../domain/kb.interfaces";

export type SubstituteKbIngestionConfigResult =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly error: KbReconcileError };

export function substituteKbIngestionConfig(args: {
  readonly kbName: string;
  readonly ingestionConfig: Record<string, unknown>;
  readonly resolveRef: KbResolveRef;
  readonly onSubstituted?: (info: {
    argKey: string;
    refType: SymbolicRefType;
    name: string;
    realId: string;
    path: string;
  }) => void;
}): SubstituteKbIngestionConfigResult {
  const result = substituteSymbolicRefs({
    value: args.ingestionConfig,
    // T03 (gaps-2) — "knowledgeBase" is a narrow widening of the
    // ERROR-REPORTING type only (`ApplyWriteError.resourceKind`), never of
    // `ResourceKind` itself — see that type's own comment for why.
    owningResourceKind: "knowledgeBase",
    owningResourceName: args.kbName,
    resolveRef: args.resolveRef,
    onSubstituted: args.onSubstituted,
  });
  if (!result.ok) {
    // `substituteSymbolicRefs` only ever constructs `unresolved_symbolic_ref`
    // / `mismatched_symbolic_ref` / `unallowlisted_symbolic_ref` (see that
    // file) — all three are members of `KbReconcileErrorKind` (widened
    // above) — but `ApplyWriteError.kind`'s STATIC type is the full,
    // apply-engine-wide `ApplyWriteErrorKind`, so a narrowing cast is needed
    // at this boundary.
    return {
      ok: false,
      error: {
        kind: result.error.kind as KbReconcileError["kind"],
        kbName: args.kbName,
        message: result.error.message,
      },
    };
  }
  return { ok: true, value: result.value as Record<string, unknown> };
}
