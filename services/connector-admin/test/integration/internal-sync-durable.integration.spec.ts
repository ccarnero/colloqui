/**
 * Phase 6.1 — Integration: durable consumer lifecycle (REQ-ASIS-001/002/003).
 *
 * Spins up a real `nats:2.10` JetStream container, provisions two synthetic
 * tenant ingress streams (`INGRESS-ACME`, `INGRESS-GLOBEX`), and exercises
 * a real `MultiTenantConsumerManager` against it — NO mocks below the
 * NATS client surface. The Phase 3 unit tests already cover the wiring
 * with mocks; this spec is the safety-net for the manager's actual
 * reconcile loop, the `ensureDurableConsumer` round-trip, and the
 * runner's ack/nak/term path.
 *
 * Acceptance gates:
 *   • REQ-ASIS-001: durable bound on every matching stream after start().
 *   • REQ-ASIS-002: 100 events split across two tenants are all ack'd
 *     (`num_ack_pending == 0`) within the drain window.
 *   • REQ-ASIS-003: handler that throws transient on first delivery and
 *     succeeds on second is redelivered + ack'd; durable's
 *     `num_redelivered` advances by exactly one.
 *
 * Requires Docker. The whole `describe` block is skipped automatically
 * when the testcontainer can't start (CI without Docker / local sandbox).
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
  type IMultiTenantConsumerConfig,
} from "@yoizen/database";
import {
  PermanentError,
  SERVICE_UPSERTED_EVENT_TYPE,
} from "@yoizen/shared";
import {
  ACK_WAIT_MS,
  BACKOFF_MS,
  connectNats,
  createTenantStream,
  DURABLE_NAME,
  getDurableInfo,
  MAX_DELIVER,
  publishUpserted,
  resetIntegrationCaches,
  startNatsTestcontainer,
  waitFor,
  type NatsClients,
  type NatsTestcontainer,
} from "./setup";

/**
 * Toggle every test in this suite to `it.skip` if Docker is not
 * reachable (e.g. PR sandbox CI without DOCKER_HOST). The static
 * NATS+Postgres testcontainer dance ALWAYS requires a daemon —
 * silently skipping is preferable to a hard `beforeAll` failure that
 * would mask the real signal.
 */
const HAS_DOCKER = (() => {
  try {
    const sock = "/var/run/docker.sock";
    Bun.file(sock).size; // throws if missing
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

interface ITenantSetup {
  readonly tenantId: string;
  readonly streamName: string;
}

describeIfDocker(
  "InternalSync durable lifecycle (Phase 6.1) — requires docker",
  () => {
    let natsTc: NatsTestcontainer;
    let clients: NatsClients;
    const tenants: ITenantSetup[] = [];

    beforeAll(async () => {
      // Each spec spawns its own ephemeral broker; the
      // `ensureDurableConsumer` cache is process-global, so reset it
      // before the first ensure of this run to avoid cross-spec
      // pollution (`consumer not found` on a fresh container).
      resetIntegrationCaches();
      natsTc = await startNatsTestcontainer();
      clients = await connectNats(natsTc.url);

      const acmeStream = await createTenantStream(clients.jsm, "acme");
      const globexStream = await createTenantStream(clients.jsm, "globex");
      tenants.push({ tenantId: "acme", streamName: acmeStream });
      tenants.push({ tenantId: "globex", streamName: globexStream });
    });

    afterAll(async () => {
      try {
        await clients?.nc.drain();
      } catch {
        // noop — broker may already be torn down
      }
      await natsTc?.stop();
    });

    it(
      "binds the durable on every matching tenant stream and ack's all messages (REQ-ASIS-001/002)",
      async () => {
        /**
         * Worker-mode handler — pure happy path: every delivery resolves,
         * the manager's runner ack()s on success. We tally per-tenant
         * counts so we can assert the split between `acme` and `globex`
         * matches what we publish.
         */
        const perTenantHandled = new Map<string, number>();
        const handler = async (msg: JsMsg): Promise<void> => {
          const subjectTenant = msg.subject.split(".")[1] ?? "<unknown>";
          perTenantHandled.set(
            subjectTenant,
            (perTenantHandled.get(subjectTenant) ?? 0) + 1,
          );
        };

        const config: IMultiTenantConsumerConfig = {
          streamPattern: /^INGRESS-/,
          durableName: DURABLE_NAME,
          filterSubject:
            "evt.*.registry-service.platform.service.system.*.v1",
          description: "phase-6.1 lifecycle test",
          runnerOptions: { concurrency: 4 },
          ensureOnly: false,
          maxDeliver: MAX_DELIVER,
          ackWaitMs: ACK_WAIT_MS,
          backoffMs: BACKOFF_MS,
        };

        const manager = new MultiTenantConsumerManager(
          clients.jsm,
          clients.js,
          config,
          handler,
          silentLogger,
        );
        await manager.start();

        try {
          // Wait for the manager to bind a runner on each tenant stream.
          // O(T) with T=2 — manager iterates streams once on start().
          await waitFor(
            async () => manager.getBoundStreams().length === tenants.length,
            { timeoutMs: 10_000 },
          );

          for (let i = 0; i < tenants.length; i++) {
            const t = tenants[i]!;
            const info = await getDurableInfo(
              clients.jsm,
              t.streamName,
              DURABLE_NAME,
            );
            expect(info.config.durable_name).toBe(DURABLE_NAME);
            expect(info.config.ack_policy).toBeDefined();
          }

          /**
           * Publish 100 events split 60/40 across acme/globex. The 60/40
           * split (rather than 50/50) makes the per-tenant assertion
           * non-degenerate: a bug that crossed the streams would still
           * pass an aggregate==100 check.
           */
          const pubAcks: number[] = [];
          for (let i = 0; i < 60; i++) {
            const ack = await publishUpserted(clients.js, {
              tenantId: "acme",
              payload: {
                serviceId: `svc-acme-${i}`,
                tenantId: "acme",
                name: `svc-acme-${i}`,
                knativeName: `svc-acme-${i}`,
                namespace: "tenant-acme",
                port: 8080,
                status: "active",
              },
            });
            pubAcks.push(ack.seq);
          }
          for (let i = 0; i < 40; i++) {
            const ack = await publishUpserted(clients.js, {
              tenantId: "globex",
              payload: {
                serviceId: `svc-globex-${i}`,
                tenantId: "globex",
                name: `svc-globex-${i}`,
                knativeName: `svc-globex-${i}`,
                namespace: "tenant-globex",
                port: 8080,
                status: "active",
              },
            });
            pubAcks.push(ack.seq);
          }
          expect(pubAcks).toHaveLength(100);

          // Drain: every per-tenant durable's `num_ack_pending` must
          // converge to 0 within a reasonable window. With concurrency=4
          // and a no-op handler this typically settles in <2s.
          await waitFor(
            async () => {
              for (let i = 0; i < tenants.length; i++) {
                const t = tenants[i]!;
                const info = await getDurableInfo(
                  clients.jsm,
                  t.streamName,
                  DURABLE_NAME,
                );
                if (
                  info.num_ack_pending !== 0 ||
                  info.num_pending !== 0
                ) {
                  return false;
                }
              }
              return true;
            },
            { timeoutMs: 30_000, intervalMs: 200 },
          );

          // Per-tenant handler counts must match what we published.
          expect(perTenantHandled.get("acme")).toBe(60);
          expect(perTenantHandled.get("globex")).toBe(40);
        } finally {
          await manager.stop();
        }
      },
      90_000,
    );

    it(
      "redelivery: handler throws transient on first delivery, succeeds on second → ack on redeliver (REQ-ASIS-003)",
      async () => {
        /**
         * Use a separate durable name to avoid colliding with the
         * previous test's already-drained durable on the same stream
         * (consumer state survives in JetStream).
         */
        const redeliverDurable = "adapter-internal-sync-redeliver";

        // Track per-message attempt count keyed by `idempotencykey` so
        // a single redelivery is unambiguously visible. Also capture the
        // broker-reported `deliveryCount` on the second attempt — that
        // is the authoritative redelivery signal once `num_redelivered`
        // has decayed back to zero post-ack.
        const attemptByKey = new Map<string, number>();
        const deliveryCountByKey = new Map<string, number>();
        const handler = async (msg: JsMsg): Promise<void> => {
          const decoder = new TextDecoder();
          const env = JSON.parse(decoder.decode(msg.data)) as {
            idempotencykey?: string;
            type?: string;
          };
          const key = env.idempotencykey ?? "unknown";
          const attempt = (attemptByKey.get(key) ?? 0) + 1;
          attemptByKey.set(key, attempt);
          deliveryCountByKey.set(key, msg.info.deliveryCount);
          if (env.type !== SERVICE_UPSERTED_EVENT_TYPE) {
            throw new PermanentError("unknown_type", "test");
          }
          if (attempt === 1) {
            // Plain Error → runner naks → broker redelivers.
            throw new Error("transient: simulated db reset");
          }
          // 2nd delivery succeeds — runner ack()s.
        };

        const config: IMultiTenantConsumerConfig = {
          streamPattern: /^INGRESS-/,
          durableName: redeliverDurable,
          filterSubject:
            "evt.*.registry-service.platform.service.system.*.v1",
          description: "phase-6.1 redelivery test",
          runnerOptions: { concurrency: 1 },
          ensureOnly: false,
          maxDeliver: 3,
          /**
           * `ack_wait` controls when the broker redelivers an unacked
           * message. We set it tight (300 ms) so the second delivery
           * occurs well within the test budget. `backoff[0]` is also
           * 300 ms — recall the broker invariant
           * (`nats-durable-consumer.ts:31-42`) that the *first* backoff
           * value doubles as `ack_wait`.
           */
          ackWaitMs: 300,
          backoffMs: [300, 1_000, 3_000],
        };

        const manager = new MultiTenantConsumerManager(
          clients.jsm,
          clients.js,
          config,
          handler,
          silentLogger,
        );
        await manager.start();

        try {
          await waitFor(
            async () => manager.getBoundStreams().length === tenants.length,
            { timeoutMs: 10_000 },
          );

          const idempotencyKey = `redeliver-${Date.now()}`;
          const ack = await publishUpserted(clients.js, {
            tenantId: "acme",
            payload: {
              serviceId: "svc-redeliver",
              tenantId: "acme",
              name: "svc-redeliver",
              knativeName: "svc-redeliver",
              namespace: "tenant-acme",
              port: 8080,
              status: "active",
            },
            idempotencyKey,
          });
          expect(ack.seq).toBeGreaterThan(0);

          // Wait for the redelivery + ack cycle to complete.
          await waitFor(
            async () => {
              const info = await getDurableInfo(
                clients.jsm,
                "INGRESS-ACME",
                redeliverDurable,
              );
              return (
                info.num_ack_pending === 0 &&
                info.num_pending === 0 &&
                (attemptByKey.get(idempotencyKey) ?? 0) >= 2
              );
            },
            { timeoutMs: 15_000, intervalMs: 200 },
          );

          expect(attemptByKey.get(idempotencyKey)).toBe(2);
          /**
           * `JsMsg.info.deliveryCount` is the broker-authoritative
           * redelivery counter for THIS specific delivery. The 2nd
           * attempt MUST report `deliveryCount >= 2` (NATS uses 1-based
           * delivery numbers; the first delivery is `1`). We do NOT
           * assert against the durable's `num_redelivered` because that
           * gauge tracks currently-pending redeliveries — once we ack
           * the 2nd delivery it returns to 0, so it is not a stable
           * post-condition signal.
           */
          expect(deliveryCountByKey.get(idempotencyKey)).toBeGreaterThanOrEqual(2);
        } finally {
          await manager.stop();
        }
      },
      60_000,
    );
  },
);
