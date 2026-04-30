/**
 * Standalone post-suite cleanup for the E2E tenant.
 *
 * Why this is NOT a `*.spec.ts` (and why the previous
 * `zz-cleanup.e2e.spec.ts` was removed):
 *
 *   • Bun's test runner does NOT execute spec files in alphabetic order
 *     (despite the `zz-` prefix convention from Jest). Empirically the
 *     order is roughly readdir/inode order, so a spec named `zz-…` may
 *     run anywhere — in our case, position 9 of 16, BEFORE
 *     `workflow.e2e.spec.ts`.
 *   • When the cleanup spec ran mid-suite for the dedicated tier, it
 *     destroyed the tenant namespace `acme-dedicated-dev-ns`. Subsequent
 *     calls re-provisioned a fresh namespace with a NEW Service IP, but
 *     `workflow-service-api` (and other long-lived API pods) keep their
 *     `postgres.js` pool keyed by hostname. The pool's cached
 *     connection then targets the freed IP and every query throws
 *     `connect ECONNREFUSED <old-ip>:5432`.
 *
 * Running cleanup as a SEPARATE bun process AFTER `bun test` finishes
 * guarantees:
 *   1. No spec ever sees a destroyed tenant.
 *   2. Cleanup runs even if specs fail (the calling shell uses
 *      `trap` / `; rc=$?; …; exit $rc` so the test exit code is
 *      preserved while cleanup still executes).
 *   3. Stale pools inside services don't matter — the pods are no
 *      longer being asked questions when this runs.
 *
 * Skip via `E2E_KEEP_TENANT=1` for ad-hoc local debugging.
 */
import { destroyTenant, getTenant, getTenantTier } from "../auth.setup";

const KEEP_TENANT = process.env.E2E_KEEP_TENANT === "1";

async function main(): Promise<void> {
  const tenant = getTenant();
  const tier = getTenantTier();

  if (KEEP_TENANT) {
    console.log(
      `[cleanup-tenant] E2E_KEEP_TENANT=1, leaving tenant '${tenant}' (tier=${tier}) provisioned`,
    );
    return;
  }

  const start = Date.now();
  try {
    await destroyTenant();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(
      `[cleanup-tenant] tenant '${tenant}' (tier=${tier}) destroyed in ${elapsed}s`,
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // Cleanup failure must NOT mask the real test exit code from the
    // run. Log loudly so the dev sees orphaned state, but exit 0 so
    // the wrapper preserves the test runner's exit code as the
    // process exit.
    console.error(
      `[cleanup-tenant] FAILED to destroy tenant '${tenant}' (tier=${tier}): ${detail}`,
    );
  }
}

await main();
