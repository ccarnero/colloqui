/**
 * Phase 6.3 — Integration: SIGTERM with in-flight messages (REQ-ASIS-004).
 *
 * Validates the runner's graceful-shutdown contract: when `stop()` is
 * called mid-burst with N in-flight handlers, every in-flight message
 * MUST end up `ack`'d OR `nak`'d before the test process exits — never
 * silently dropped, never silently `ack`'d.
 *
 * Approach:
 *   • concurrency=4 + slow-handler stub (sleeps 200ms before resolving).
 *   • Publish 20 messages on a single tenant stream.
 *   • Sleep ~100ms — enough time for the runner to pick up the first
 *     batch of (up to) 4 messages but NOT enough for them to finish.
 *   • Call `manager.stop()` (the production graceful path —
 *     `bootstrap-worker.ts` invokes the same on SIGTERM).
 *   • Tally dispositions via a custom `INatsConsumerMetrics` sink:
 *       - sum(ack, nak, term) == handler invocations (no silent drop)
 *       - all handler invocations completed before `stop()` resolved
 *
 * Note on `shutdown_naked_inflight`: the current `NatsConsumerRunner`
 * does NOT emit a dedicated metric for "grace exceeded → forced nak"
 * (the runner waits via `Promise.allSettled(active)` so handlers
 * settle cleanly). The spec language in REQ-ASIS-004 uses
 * "shutdown_naked_inflight" as a placeholder for whatever signal the
 * runner exposes — in practice the runner's `nat` counter increments
 * if a handler throws while shutting down. We assert the stronger
 * invariant: "every dispatched message is observably either ack'd or
 * nak'd by the time `stop()` resolves" — that is the loss-free
 * guarantee the proposal demands.
 *
 * Requires Docker.
 */

import "reflect-metadata";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from "bun:test";
import type { JsMsg } from "nats";
import {
  MultiTenantConsumerManager,
  type INatsConsumerLogger,
  type INatsConsumerMetrics,
  type IMultiTenantConsumerConfig,
  type NatsMessageResult,
  type NatsReattachReason,
} from "@yoizen/database";
import {
  ACK_WAIT_MS,
  BACKOFF_MS,
  connectNats,
  createTenantStream,
  MAX_DELIVER,
  publishUpserted,
  resetIntegrationCaches,
  sleep,
  startNatsTestcontainer,
  waitFor,
  type NatsClients,
  type NatsTestcontainer,
} from "./setup";

const HAS_DOCKER = (() => {
  try {
    Bun.file("/var/run/docker.sock").size;
    return true;
  } catch {
    return Boolean(process.env.DOCKER_HOST);
  }
})();

const describeIfDocker = HAS_DOCKER ? describe : describe.skip;

/**
 * Bun's lifecycle hooks reject a per-hook timeout argument
 * (`beforeAll(fn, ms)` throws at module load), so the container-boot
 * budget is declared file-wide instead — same 120s ceiling the
 * `beforeAll` used to carry.
 */
setDefaultTimeout(120_000);

const silentLogger: INatsConsumerLogger & {
  log: (m: string) => void;
  warn: (m: string) => void;
} = {
  error: () => {},
  warn: () => {},
  log: () => {},
};

/**
 * Implements `INatsConsumerMetrics` with O(1) counters per outcome.
 * The interface is the only surface the runner uses — the test sink
 * mirrors the production OTEL sink without pulling the meter provider.
 */
class CountingMetrics implements INatsConsumerMetrics {
  ack = 0;
  nak = 0;
  term = 0;
  inFlightAdjustments = 0;
  reattach = 0;

  recordProcessed(_durable: string, result: NatsMessageResult): void {
    if (result === "ack") this.ack++;
    else if (result === "nak") this.nak++;
    else if (result === "term") this.term++;
  }

  recordDuration(_durable: string, _ms: number): void {
    // unused — duration not asserted in this spec
  }

  adjustInFlight(_durable: string, delta: number): void {
    this.inFlightAdjustments += delta;
  }

  recordReattach(_durable: string, _reason: NatsReattachReason): void {
    this.reattach++;
  }

  total(): number {
    return this.ack + this.nak + this.term;
  }
}

describeIfDocker(
  "InternalSync graceful shutdown with in-flight messages (Phase 6.3) — requires docker",
  () => {
    let natsTc: NatsTestcontainer;
    let clients: NatsClients;
    const TENANT_ID = "shutdown";
    let streamName: string;

    beforeAll(async () => {
      // Reset the process-global ensure-cache before this spec
      // contacts a fresh broker — the durable cache is shared with
      // sibling specs and otherwise short-circuits on stale keys.
      resetIntegrationCaches();
      natsTc = await startNatsTestcontainer();
      clients = await connectNats(natsTc.url);
      streamName = await createTenantStream(clients.jsm, TENANT_ID);
    });

    afterAll(async () => {
      try {
        await clients?.nc.drain();
      } catch {
        // already closed
      }
      await natsTc?.stop();
    });

    it(
      "stop() mid-burst → every dispatched message is ack'd or nak'd, no silent drops (REQ-ASIS-004)",
      async () => {
        const HANDLER_DELAY_MS = 200;
        const CONCURRENCY = 4;
        const TOTAL_MESSAGES = 20;
        const KILL_DELAY_MS = 100;

        const handlerInvocations = { count: 0, completed: 0 };
        const handler = async (_msg: JsMsg): Promise<void> => {
          handlerInvocations.count++;
          await sleep(HANDLER_DELAY_MS);
          handlerInvocations.completed++;
        };

        const metrics = new CountingMetrics();
        const config: IMultiTenantConsumerConfig = {
          streamPattern: /^INGRESS-/,
          durableName: "adapter-internal-sync-shutdown",
          filterSubject:
            "evt.*.registry-service.platform.service.system.*.v1",
          description: "phase-6.3 graceful shutdown",
          runnerOptions: {
            concurrency: CONCURRENCY,
            // tighter than default (100) so the runner pulls all
            // available messages on the first session and we have
            // a deterministic in-flight set to assert against.
            maxMessages: TOTAL_MESSAGES,
          },
          ensureOnly: false,
          maxDeliver: MAX_DELIVER,
          ackWaitMs: ACK_WAIT_MS,
          backoffMs: BACKOFF_MS,
          metrics,
        };

        const manager = new MultiTenantConsumerManager(
          clients.jsm,
          clients.js,
          config,
          handler,
          silentLogger,
        );
        await manager.start();
        await waitFor(
          async () => manager.getBoundStreams().length === 1,
          { timeoutMs: 10_000 },
        );

        // Publish 20 events ON the single tenant stream.
        const publishPromises: Promise<unknown>[] = [];
        for (let i = 0; i < TOTAL_MESSAGES; i++) {
          publishPromises.push(
            publishUpserted(clients.js, {
              tenantId: TENANT_ID,
              payload: {
                serviceId: `svc-${i}`,
                tenantId: TENANT_ID,
                name: `svc-${i}`,
                knativeName: `svc-${i}`,
                namespace: `tenant-${TENANT_ID}`,
                port: 8080,
                status: "active",
              },
              idempotencyKey: `evt-${i}`,
            }),
          );
        }
        await Promise.all(publishPromises);

        // Wait for the runner to pick up at least one message — we
        // want a non-trivial in-flight set when we kill it. The slow
        // handler guarantees the in-flight set has not yet drained.
        await waitFor(
          async () => handlerInvocations.count >= 1,
          { timeoutMs: 5_000, intervalMs: 25 },
        );

        // Brief settle so up to CONCURRENCY messages are mid-flight,
        // then call stop(). The runner's `runConcurrent` finally-block
        // does `Promise.allSettled(active)` — every in-flight handler
        // resolves and is `ack`'d before `stop()` returns.
        await sleep(KILL_DELAY_MS);

        const inFlightAtStop = handlerInvocations.count - handlerInvocations.completed;
        // We expect 1 ≤ inFlightAtStop ≤ CONCURRENCY at this moment —
        // sanity-checks the experimental setup; if zero, the broker
        // is unusually slow and the assertion would be vacuous.
        expect(inFlightAtStop).toBeGreaterThanOrEqual(1);
        expect(inFlightAtStop).toBeLessThanOrEqual(CONCURRENCY);

        const stopStart = Date.now();
        await manager.stop();
        const stopDuration = Date.now() - stopStart;

        // CRITICAL: the only path through `runConcurrent` finally is
        // `Promise.allSettled(active)`, so when `stop()` resolves all
        // in-flight handlers MUST have completed (success or failure).
        expect(handlerInvocations.completed).toBe(handlerInvocations.count);

        // No silent drop: every handler invocation produced exactly
        // one outcome (ack/nak/term) — the runner's metrics sink is
        // the source of truth.
        expect(metrics.total()).toBe(handlerInvocations.count);

        // No nak/term in the happy path — the slow handler always
        // resolves, so every disposition is `ack`. If the test fires
        // before the in-flight burst settles, naks would surface here.
        expect(metrics.nak).toBe(0);
        expect(metrics.term).toBe(0);
        expect(metrics.ack).toBe(handlerInvocations.count);

        // Stop must complete within the runner's grace window — bound
        // it generously (handler 200ms × concurrency drains in <1s,
        // plus a few hundred ms for iterator teardown). 5s is the
        // failure tripwire — anything slower is a genuine regression.
        expect(stopDuration).toBeLessThan(5_000);

        // In-flight gauge MUST be balanced — every +1 had a matching
        // -1, regardless of disposition. This is the analogue of the
        // "shutdown_naked_inflight" tripwire: a non-zero residual
        // means a handler exited without going through the metrics
        // path, which would be an observability hole.
        expect(metrics.inFlightAdjustments).toBe(0);

        // Anything published but not yet pulled remains in the stream
        // (durable position survives stop), guaranteeing the broker
        // redelivers them on the next worker start — i.e. zero loss.
        expect(metrics.total()).toBeLessThan(TOTAL_MESSAGES);
      },
      60_000,
    );
  },
);
