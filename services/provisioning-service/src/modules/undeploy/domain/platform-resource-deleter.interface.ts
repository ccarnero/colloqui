// Port undeploy calls to remove ONE live resource through its downstream
// admin API (PENDIENTES/12-undeploy.spec.md T01).
//
// SEPARATE from `apply/domain/platform-resource-writer.interface.ts` on
// purpose: the writers stay create-or-update only ("decision 2, no
// prune/delete anywhere in this loop" — still true), and none of their apply
// functions gained a delete branch. The delete HTTP calls live in THIS
// module's `infrastructure/` client layer, next to the read clients they
// reuse for the find-by-name step.
//
// Two steps, deliberately split:
//   1. `findOwnedId` — resolves the LIVE id of the resource the manifest
//      declares, using that kind's documented deletion key (channels: name +
//      apply-provenance marker; every other kind: find-by-name — no key
//      proves WHICH manifest created a resource, see
//      `platform-resource-deleters.provider.ts` for the per-kind table).
//      `null` means "nothing matching the key is live" → `not_found`.
//   2. `deleteById` — issues the DELETE. `deleted: false` means the
//      downstream said "no such id" (404, or agent-admin's `200 false`), i.e.
//      it vanished between the two calls — still `not_found`, never an error.
//
// Never throws: every failure is a typed `UndeployStepError`, mirroring the
// read clients' `DownstreamError` contract.

import type { Result } from "../../../lib/result";
import type {
  UndeployResourceKind,
  UndeployStepError,
} from "./undeploy.interfaces";

export interface IPlatformResourceDeleter {
  findOwnedId(
    tenantId: string,
    resourceName: string,
    manifestName: string
  ): Promise<Result<string | null, UndeployStepError>>;

  deleteById(
    tenantId: string,
    externalId: string,
    resourceName: string
  ): Promise<Result<{ readonly deleted: boolean }, UndeployStepError>>;
}

/**
 * One deleter per resource kind. `Partial` on purpose: a kind whose
 * downstream admin API has NO delete route simply has no entry here, and the
 * engine reports `skipped_no_delete_api` for it instead of crashing. Every
 * one of the nine kinds IS wired today (live-verified 2026-08-12) — the
 * partiality is the documented degradation path, not a current gap.
 */
export type PlatformResourceDeleters = Readonly<
  Partial<Record<UndeployResourceKind, IPlatformResourceDeleter>>
>;

export const PLATFORM_RESOURCE_DELETERS = Symbol("PLATFORM_RESOURCE_DELETERS");
