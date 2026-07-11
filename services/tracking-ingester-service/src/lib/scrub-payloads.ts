// Batched retention scrub orchestration (T03 of manual-loops/payload-capture.md).
//
// Loops `buildScrubBatchQuery` batches of `batchSize` (default 5000) through
// the injected `runBatch` executor until a batch affects zero rows — the
// same injected-I/O shape as `handle-chain-request.ts`'s `queryEvents`/
// `querySpans`: this module never touches a concrete Postgres client, so it
// stays trivially unit-testable with a fake executor.
//
// IDEMPOTENT by construction: the batch UPDATE's WHERE clause
// (`payload_status IN ('inline','resolved')`) is self-eliminating — once a
// row is flipped to 'scrubbed' it can never match again, so a second full
// run against the same cutoff always affects 0 rows on its first (only)
// batch.

import { buildScrubBatchQuery } from "./build-scrub-batch-query.js";

/** Default rows-per-round-trip — SPEC.md T03 ("Batches of 5000"). */
export const DEFAULT_SCRUB_BATCH_SIZE = 5000;

export interface ScrubPayloadsDeps {
  /**
   * Executes one batch UPDATE and returns the number of rows the server
   * affected. `main.ts`/the script binds this to
   * `sql.unsafe(query.text, query.params).then((r) => r.count ?? 0)`.
   */
  readonly runBatch: (
    query: ReturnType<typeof buildScrubBatchQuery>
  ) => Promise<number>;
  /** Verbose line logger. @default no-op */
  readonly log?: (message: string) => void;
}

export interface ScrubPayloadsResult {
  /** Total rows scrubbed across every batch. */
  readonly totalScrubbed: number;
  /** How many round trips were issued (including the terminal zero-affected one). */
  readonly batches: number;
}

/**
 * Runs the batched scrub loop for every row with
 * `occurred_at < cutoff AND payload_status IN ('inline','resolved')`,
 * `batchSize` rows at a time, until a batch affects zero rows.
 */
export async function scrubPayloads(
  cutoff: Date,
  batchSize: number = DEFAULT_SCRUB_BATCH_SIZE,
  deps: ScrubPayloadsDeps
): Promise<ScrubPayloadsResult> {
  const log = deps.log ?? (() => {});
  let totalScrubbed = 0;
  let batches = 0;

  log(
    `scrubPayloads: starting — cutoff=${cutoff.toISOString()} batch_size=${batchSize}`
  );

  for (;;) {
    batches++;
    const query = buildScrubBatchQuery(cutoff, batchSize);
    log(`scrubPayloads: batch ${batches} — scanning up to ${batchSize} row(s)`);
    const affected = await deps.runBatch(query);
    totalScrubbed += affected;
    log(`scrubPayloads: batch ${batches} — scrubbed ${affected} row(s)`);

    if (affected === 0) {
      break;
    }
  }

  log(
    `scrubPayloads: complete — ${totalScrubbed} row(s) scrubbed across ${batches} batch(es)`
  );

  return { totalScrubbed, batches };
}
