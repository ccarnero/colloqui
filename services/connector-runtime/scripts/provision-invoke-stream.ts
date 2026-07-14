#!/usr/bin/env bun
/**
 * provision-invoke-stream.ts — idempotent JetStream provisioning for the
 * connector-invoke transport subjects (`manual-loops/connector-invoke-api.md`
 * T04): binds
 *   evt.*.connector-runtime.platform.endpoint.system.invoke_requested.v1
 *   evt.*.connector-runtime.platform.endpoint.system.invoke_completed.v1
 * (invoke_completed is published by the T05 consumer/result path — not
 * built yet, but its subject is provisioned here too so a single stream
 * ADD covers the whole family and T05 needs no further provisioning) to a
 * NEW, dedicated stream (`CONNECTOR-INVOKE`). This is additive: it does not
 * touch any existing stream's subject filters (`INGRESS-<TENANT>`, DLQ,
 * GATEWAY_AUDIT, etc.) — "never repurpose existing streams" (SPEC.md T04
 * constraint).
 *
 * DRY-RUN BY DEFAULT: prints the desired stream config and whether it
 * already matches the broker, without writing anything. Pass `--apply` to
 * actually create/reconcile the stream via `ensureStream` (`@yoizen/database`
 * — the same idempotent create-or-reconcile helper every other provisioned
 * stream in this repo uses, e.g. the per-tenant `INGRESS-<TENANT>` streams).
 *
 * Idempotent: safe to re-run. `ensureStream` creates the stream if missing
 * and reconciles subjects/limits if drifted; running `--apply` again with an
 * unchanged desired config is a no-op round-trip.
 *
 * Human-runs-first rule: Claude wrote this script; a human runs the first
 * `--apply` against the live cluster (same rule as
 * `services/tracking-ingester-service/src/scripts/scrub-payloads.ts`).
 *
 * Usage:
 *   NATS_URL=nats://localhost:4222 bun run scripts/provision-invoke-stream.ts            # dry-run
 *   NATS_URL=nats://localhost:4222 bun run scripts/provision-invoke-stream.ts --apply     # execute
 *
 * Connection: port-forward first (OrbStack, namespace support-services-dev):
 *   kubectl port-forward -n support-services-dev svc/nats 4222:4222
 */

import { ensureStream } from "@yoizen/database";
import { buildSubject } from "@yoizen/shared";
import { connect, RetentionPolicy } from "nats";

const CONNECTOR_INVOKE_STREAM_NAME = "CONNECTOR-INVOKE";

// Multi-tenant wildcard subjects — `buildSubject`'s `tenant` param accepts
// the literal `*` token, which is valid NATS subject-wildcard syntax at
// that position (same technique other cross-tenant streams use for their
// subject filters, e.g. `GATEWAY_AUDIT`'s `audit.gateway.>`).
const INVOKE_REQUESTED_SUBJECT_PATTERN = buildSubject({
  tenant: "*",
  producer: "connector-runtime",
  domain: "platform",
  channel: "endpoint",
  provider: "system",
  kind: "invoke_requested",
  version: "v1",
});

const INVOKE_COMPLETED_SUBJECT_PATTERN = buildSubject({
  tenant: "*",
  producer: "connector-runtime",
  domain: "platform",
  channel: "endpoint",
  provider: "system",
  kind: "invoke_completed",
  version: "v1",
});

// 7 days / 256MiB — same defaults `packages/database/src/nats-provider.ts`
// uses for the channel ingress streams; this family's traffic volume is
// far lower (one message per invoke request/result), so these limits are
// generous headroom rather than a tuned budget.
const MAX_AGE_NS = 7 * 24 * 60 * 60 * 1_000_000_000;
const MAX_BYTES = 256 * 1024 * 1024;

function log(message: string): void {
  console.log(`[provision-invoke-stream] ${message}`);
}

function resolveApplyFlag(argv: readonly string[]): boolean {
  return argv.includes("--apply");
}

async function main(): Promise<void> {
  const apply = resolveApplyFlag(process.argv.slice(2));
  const natsUrl = process.env.NATS_URL ?? "nats://localhost:4222";

  log(`connecting to ${natsUrl}...`);
  const nc = await connect({
    servers: natsUrl,
    name: "connector-runtime-provision-invoke-stream",
    waitOnFirstConnect: true,
  });

  try {
    const jsm = await nc.jetstreamManager();
    const subjects = [
      INVOKE_REQUESTED_SUBJECT_PATTERN,
      INVOKE_COMPLETED_SUBJECT_PATTERN,
    ] as const;

    log(`desired stream: ${CONNECTOR_INVOKE_STREAM_NAME}`);
    log(`desired subjects: ${subjects.join(", ")}`);

    let currentSubjects: readonly string[] | undefined;
    try {
      const info = await jsm.streams.info(CONNECTOR_INVOKE_STREAM_NAME);
      currentSubjects = info.config.subjects;
      log(
        `current subjects on broker: ${currentSubjects.join(", ") || "(none)"}`
      );
    } catch {
      log("stream does not exist yet on the broker");
    }

    if (!apply) {
      log("DRY RUN — no changes made. Re-run with --apply to provision.");
      return;
    }

    await ensureStream(jsm, {
      name: CONNECTOR_INVOKE_STREAM_NAME,
      subjects,
      maxAge: MAX_AGE_NS,
      maxBytes: MAX_BYTES,
      retention: RetentionPolicy.Limits,
      logger: { log, warn: log },
    });

    const after = await jsm.streams.info(CONNECTOR_INVOKE_STREAM_NAME);
    log(
      `APPLIED — stream '${CONNECTOR_INVOKE_STREAM_NAME}' subjects now: ${after.config.subjects.join(", ")}`
    );
  } finally {
    await nc.close();
  }
}

main().catch((err) => {
  console.error(
    `[provision-invoke-stream] fatal: ${err instanceof Error ? err.stack : err}`
  );
  process.exit(1);
});
