// manual-loops/provisioning-manifest-gaps-3.md T03, workstream d, decision 7.
//
// PARALLEL allowlist to `substitution-allowlist.ts`'s `SUBSTITUTION_ALLOWLIST`
// — same `{ argKey, refType, source }` entry shape, but each entry here
// governs a PLURAL argument key whose value is an ARRAY of single-key
// ref-objects (`[{ <refType>: <name> }, ...]`), substituted element-wise,
// instead of one scalar ref-object.
//
// Design choice (investigated against the walker's actual code shape, per
// decision 7's instruction): a SEPARATE map, not a scalar-or-array flag
// bolted onto `SubstitutionAllowlistEntry`. Reasons:
//   1. `SUBSTITUTION_ALLOWLIST`'s consuming code (`ALLOWLISTED_SUBSTITUTION_KEYS`,
//      `walk`'s per-key branch) is written assuming ONE ref-object value per
//      key; overloading it with an array flag would force every existing
//      scalar entry's read site to branch on that flag even though all
//      seven scalar entries (`accountId`/`adapterId`/`agentId`/`serviceId`/
//      `serverId`/`connectorId`/`provider_connector_id`) stay scalar forever
//      — a parallel map keeps the scalar path byte-identical.
//   2. `accountIds` is the ONLY known plural ref-bearing key today — one
//      small, auditable, separate map is proportionate to the one real
//      need, not a speculative general mechanism (see this SPEC's "Out of
//      scope" section: generalizing beyond this one entry is explicitly
//      deferred).
//
// THIS IS THE ONE PLACE THE ARRAY ALLOWLIST LIVES — same hand-kept-in-sync
// discipline as `SUBSTITUTION_ALLOWLIST` (no codegen, no automatic
// derivation).

import type { SymbolicRefType } from "@yoizen/shared";

export interface ArraySubstitutionAllowlistEntry {
  /** The workflow/agent-tree argument key this entry governs (plural). */
  readonly argKey: string;
  /** The ONE ref kind accepted by EACH ref-object element at this key. */
  readonly refType: SymbolicRefType;
  /** The exact @yoizen/shared type + field / manifest precedent this key mirrors. */
  readonly source: string;
}

export const ARRAY_SUBSTITUTION_ALLOWLIST: readonly ArraySubstitutionAllowlistEntry[] =
  [
    // manual-loops/provisioning-manifest-gaps-3.md T03, workstream d. Source:
    // the workflow trigger's `config.accountIds` array — every one of the
    // SEVEN already-migrated manifests (see
    // `provisioning-manifest-gaps-3.md`'s Prior art list, e.g.
    // `integrations/channels/telegram-transform-reply/manifest.yaml:32-37`'s
    // own "DEVIATION (reported to the human)" comment) documents that the
    // ORIGINAL imperative setup pinned this trigger's `accountIds` to its own
    // channel account id, a pin the manifest walker had no substitution path
    // for until this entry shipped. Mirrors `accountId`'s existing
    // `channelRef` mapping (`substitution-allowlist.ts`) one-for-one, just
    // plural.
    {
      argKey: "accountIds",
      refType: "channelRef",
      source:
        "workflow trigger `config.accountIds` — the plural sibling of " +
        "`ChannelSendArgs.accountId`; every migrated manifest's trigger " +
        "pins to its own manifest-created channel account, previously " +
        "documented as an unpinned deviation for lack of an array " +
        "substitution path (see the seven manifests cited in " +
        "provisioning-manifest-gaps-3.md's Prior art).",
    },
  ] as const;

/** `argKey -> refType`, derived once from `ARRAY_SUBSTITUTION_ALLOWLIST` above. */
export const ALLOWLISTED_ARRAY_SUBSTITUTION_KEYS: ReadonlyMap<
  string,
  SymbolicRefType
> = new Map(
  ARRAY_SUBSTITUTION_ALLOWLIST.map((entry) => [entry.argKey, entry.refType])
);
