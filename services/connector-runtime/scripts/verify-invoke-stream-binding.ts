#!/usr/bin/env bun
/**
 * verify-invoke-stream-binding.ts — human-run verification tool for the
 * connector-invoke transport subjects (`manual-loops/connector-invoke-api.md`
 * T05 design change, human-approved 2026-07-14):
 *   evt.<tenant>.connector-runtime.platform.endpoint.system.invoke_requested.v1
 *   evt.<tenant>.connector-runtime.platform.endpoint.system.invoke_completed.v1
 *
 * REPLACES `provision-invoke-stream.ts` (T04). A dedicated `CONNECTOR-INVOKE`
 * stream turned out to be IMPOSSIBLE: per-tenant `INGRESS-<TENANT>` streams
 * already bind `evt.<tenant>.>`, and JetStream forbids overlapping stream
 * subject bindings. Both invoke subjects above already fall inside that
 * wildcard, so they ride the tenant's existing `INGRESS-<tenant>` stream
 * (created at tenant provisioning) — same mechanism every other
 * `evt.<tenant>.*` publisher in the platform relies on.
 *
 * This script therefore CREATES NOTHING. It asserts, for each given tenant,
 * that BOTH invoke subjects resolve to a bound JetStream stream (expected:
 * `INGRESS-<tenant>`) and fails loud (non-zero exit, clear message) if
 * either does not — e.g. because the tenant was never provisioned, or its
 * `INGRESS-<tenant>` stream was deleted out of band.
 *
 * Usage:
 *   NATS_URL=nats://localhost:4222 bun run scripts/verify-invoke-stream-binding.ts <tenant> [tenant...]
 *
 * Connection: port-forward first (OrbStack, namespace support-services-dev):
 *   kubectl port-forward -n support-services-dev svc/nats 4222:4222
 */

import { buildSubject } from "@yoizen/shared";
import { connect } from "nats";

function log(message: string): void {
  console.log(`[verify-invoke-stream-binding] ${message}`);
}

function buildInvokeSubjects(tenantId: string): readonly string[] {
  return [
    buildSubject({
      tenant: tenantId,
      producer: "connector-runtime",
      domain: "platform",
      channel: "endpoint",
      provider: "system",
      kind: "invoke_requested",
      version: "v1",
    }),
    buildSubject({
      tenant: tenantId,
      producer: "connector-runtime",
      domain: "platform",
      channel: "endpoint",
      provider: "system",
      kind: "invoke_completed",
      version: "v1",
    }),
  ];
}

async function main(): Promise<void> {
  const tenants = process.argv.slice(2);
  if (tenants.length === 0) {
    console.error(
      "[verify-invoke-stream-binding] usage: bun run scripts/verify-invoke-stream-binding.ts <tenant> [tenant...]"
    );
    process.exit(1);
  }

  const natsUrl = process.env.NATS_URL ?? "nats://localhost:4222";
  log(`connecting to ${natsUrl}...`);
  const nc = await connect({
    servers: natsUrl,
    name: "connector-runtime-verify-invoke-stream-binding",
    waitOnFirstConnect: true,
  });

  let allBound = true;
  try {
    const jsm = await nc.jetstreamManager();

    for (const tenantId of tenants) {
      const subjects = buildInvokeSubjects(tenantId);
      for (const subject of subjects) {
        try {
          const streamName = await jsm.streams.find(subject);
          log(
            `OK   tenant=${tenantId} subject=${subject} -> stream=${streamName}`
          );
        } catch (cause) {
          allBound = false;
          const message =
            cause instanceof Error ? cause.message : String(cause);
          log(
            `FAIL tenant=${tenantId} subject=${subject} — not bound to any JetStream stream: ${message}`
          );
        }
      }
    }
  } finally {
    await nc.close();
  }

  if (!allBound) {
    console.error(
      "[verify-invoke-stream-binding] FAILED — one or more invoke subjects are not stream-bound. " +
        "Expected each tenant's INGRESS-<tenant> stream to already exist (created at tenant " +
        "provisioning, evt.<tenant>.> subject filter). This script creates nothing; if a tenant " +
        "is missing its stream, provision the tenant (or investigate why INGRESS-<tenant> is " +
        "absent) rather than re-running this script with --apply (there is no --apply — see the " +
        "module header for why a dedicated invoke stream is impossible)."
    );
    process.exit(1);
  }

  log("ALL invoke subjects for the given tenant(s) are stream-bound.");
}

main().catch((err) => {
  console.error(
    `[verify-invoke-stream-binding] fatal: ${err instanceof Error ? err.stack : err}`
  );
  process.exit(1);
});
