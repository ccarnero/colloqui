#!/usr/bin/env bun
/**
 * scrub-payloads.ts — retention scrub runner for `tracking.tracked_events`
 * payload content (T03 of manual-loops/payload-capture.md).
 *
 * DRY-RUN BY DEFAULT: prints the candidate row count per tenant for the
 * configured retention window and exits WITHOUT modifying anything. Pass
 * `--apply` to actually run the batched scrub UPDATE.
 *
 * Idempotent: the scrub predicate (`payload_status IN ('inline','resolved')`)
 * is self-eliminating, so a second `--apply` run against the same (or later)
 * cutoff always affects 0 rows.
 *
 * Usage:
 *   POSTGRES_URL=postgres://... bun run src/scripts/scrub-payloads.ts            # dry-run
 *   POSTGRES_URL=postgres://... bun run src/scripts/scrub-payloads.ts --apply    # execute
 *
 * Env:
 *   POSTGRES_URL / DATABASE_URL   Postgres DSN (never defaulted — see resolveDsn).
 *   PAYLOAD_RETENTION_DAYS        Retention window in days. @default 30
 *                                 (resolve-retention-days.ts — the ONE place
 *                                 this interval is read; never hardcode 30
 *                                 elsewhere).
 *   SCRUB_BATCH_SIZE              Rows per round trip. @default 5000
 *
 * Human-runs-first rule: Claude wrote this script; a human runs the first
 * `--apply` against the live cluster (see the CronJob manifest comment in
 * knative/services/base/tracking-payload-scrub-cronjob.yaml for the
 * automated/subsequent runs, which DO apply unattended once a human has
 * verified the first pass).
 *
 * Connection: port-forward first (OrbStack, namespace support-services-dev):
 *   kubectl port-forward -n support-services-dev svc/postgres 5432:5432
 */

import postgres from "postgres";
import {
  buildScrubCandidateCountQuery,
  type ScrubCandidateCountRow,
} from "../lib/build-scrub-candidate-count-query.js";
import { computeScrubCutoff } from "../lib/compute-scrub-cutoff.js";
import { resolveApplyFlag } from "../lib/resolve-apply-flag.js";
import { resolveRetentionDays } from "../lib/resolve-retention-days.js";
import {
  DEFAULT_SCRUB_BATCH_SIZE,
  scrubPayloads,
} from "../lib/scrub-payloads.js";

const DSN_ENV: readonly string[] = ["POSTGRES_URL", "DATABASE_URL"];

function log(message: string): void {
  console.log(`[scrub-payloads] ${message}`);
}

/** Mirrors apply-schema.ts: connection is never defaulted. */
function resolveDsn(): string | undefined {
  for (const name of DSN_ENV) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function resolveBatchSize(): number {
  const raw = process.env.SCRUB_BATCH_SIZE?.trim();
  if (!raw) {
    return DEFAULT_SCRUB_BATCH_SIZE;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    log(
      `SCRUB_BATCH_SIZE="${raw}" is not a positive integer — falling back to ${DEFAULT_SCRUB_BATCH_SIZE}`
    );
    return DEFAULT_SCRUB_BATCH_SIZE;
  }
  return parsed;
}

async function main(): Promise<void> {
  const apply = resolveApplyFlag(process.argv);

  const dsn = resolveDsn();
  if (!dsn) {
    log(`Missing required env — set one of: ${DSN_ENV.join(", ")}`);
    log(
      "Hint: kubectl port-forward -n support-services-dev svc/postgres 5432:5432"
    );
    process.exit(1);
  }

  const retentionDays = resolveRetentionDays(process.env);
  const batchSize = resolveBatchSize();
  const cutoff = computeScrubCutoff(new Date(), retentionDays);

  // Never print credentials — only host/db so the operator can confirm target.
  const redacted = dsn.replace(/\/\/[^@]*@/, "//***@");
  log(`Connecting to ${redacted}`);
  log(
    `Mode: ${apply ? "APPLY (will modify rows)" : "DRY-RUN (pass --apply to execute)"}`
  );
  log(
    `Retention: ${retentionDays} day(s) — cutoff=${cutoff.toISOString()} batch_size=${batchSize}`
  );

  const sql = postgres(dsn, { max: 1, prepare: false });

  try {
    const countQuery = buildScrubCandidateCountQuery(cutoff);
    const rows = await sql.unsafe<ScrubCandidateCountRow[]>(countQuery.text, [
      ...countQuery.params,
    ]);

    if (rows.length === 0) {
      log("Candidate scan: 0 row(s) eligible for scrub — nothing to do");
    } else {
      log(`Candidate scan (per tenant, occurred_at < cutoff):`);
      let total = 0;
      for (const row of rows) {
        log(`  tenant=${row.tenant ?? "(null)"} count=${row.count}`);
        total += row.count;
      }
      log(`Candidate scan total: ${total} row(s)`);
    }

    if (!apply) {
      log("DRY-RUN complete — no rows modified. Pass --apply to execute.");
      return;
    }

    const result = await scrubPayloads(cutoff, batchSize, {
      runBatch: async (query) => {
        const batchResult = await sql.unsafe(query.text, [...query.params]);
        return typeof batchResult.count === "number" ? batchResult.count : 0;
      },
      log,
    });

    log(
      `APPLY complete — scrubbed ${result.totalScrubbed} row(s) across ${result.batches} batch(es)`
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(
    `[scrub-payloads] fatal: ${error instanceof Error ? error.stack : error}`
  );
  process.exit(1);
});
