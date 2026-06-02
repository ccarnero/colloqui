import { Inject, Injectable } from "@nestjs/common";
import type { NatsConnection } from "nats";
import {
  NATS_CONNECTION,
  type TenantConnectionManager,
  type TenantMongoConnectionManager,
} from "@yoizen/database";
import { isWorkerMode } from "@yoizen/observability";
import { AdapterTenantConnectionManager } from "../../providers/tenant-connection-manager";
import { InternalSyncService } from "../internal-sync/internal-sync.service";

/**
 * Discrete readiness gates surfaced in the JSON body when `/readyz`
 * fails. Stable strings — operators wire alerts and dashboards off
 * these labels (REQ-AST-004: "machine-readable indication of which
 * gate is failing").
 */
export type ReadinessGate = "nats" | "db" | "durables" | "shutting_down";

export type ServiceModeName = "api" | "worker";

export interface IReadinessResult {
  readonly ready: boolean;
  readonly status: "ok" | "fail";
  readonly failed: readonly ReadinessGate[];
  readonly mode: ServiceModeName;
}

/**
 * Module-level shutdown flag. Singleton on purpose: every consumer
 * (HealthService instances, tests) must observe the same drain state
 * once SIGTERM is received (REQ-AST-003 graceful-shutdown scenario).
 *
 * Backed by a bare boolean (8 bytes hot in the JIT cache) and read
 * once per `/readyz` invocation — O(1) on the hot path.
 */
let isShuttingDownFlag = false;

let sigtermRegistered = false;

/**
 * Idempotent SIGTERM/SIGINT registration. Multiple Nest providers
 * (logger, telemetry, bootstrap-worker) already register their own
 * handlers; node fires every registered listener so coexistence is
 * safe. We register only once and use `process.once` so the listener
 * never re-arms across a duplicate signal.
 */
function ensureSigtermFlagHandler(): void {
  if (sigtermRegistered) return;
  sigtermRegistered = true;
  const handler = (): void => {
    isShuttingDownFlag = true;
  };
  process.once("SIGTERM", handler);
  process.once("SIGINT", handler);
}

/**
 * Test-only: synchronously flip the shutdown flag. Lets unit tests
 * exercise the SIGTERM gate without dispatching real signals (which
 * would race with the test runner). Mirrors the
 * `__resetServiceModeCacheForTests` convention.
 */
export function markShuttingDown(): void {
  isShuttingDownFlag = true;
}

/** Test-only: clears the shutdown flag between cases. */
export function __resetShutdownFlagForTests(): void {
  isShuttingDownFlag = false;
}

/**
 * Mode-aware health logic.
 *
 * Liveness (`/healthz`) returns 200 unconditionally while the process
 * is up (REQ-AST-003 liveness scenario): no dependency probe — the
 * orchestrator MUST NOT restart the pod for transient broker/DB
 * outages.
 *
 * Readiness (`/readyz`) gates differ per `SERVICE_MODE`:
 *
 * - `worker` (REQ-AST-004): all of NATS connected, ≥1 active tenant
 *   Postgres pool reachable, AND ≥1 `NatsConsumerRunner` reporting
 *   healthy MUST be true. Failing gates are returned as a stable
 *   string set (`nats` | `db` | `durables`).
 * - `api` (REQ-AST-005): only the per-tenant Postgres reachability
 *   gates readiness. NATS health is intentionally NOT consulted —
 *   HTTP CRUD must keep serving even when the broker is down or the
 *   worker is at zero replicas.
 *
 * Both modes return `failed: ["shutting_down"]` once SIGTERM is
 * received so kubelet stops routing while in-flight work drains
 * (REQ-AST-003 graceful-shutdown scenario).
 *
 * O(1) on the api path (one `verifyConnectivity` await — index-hit).
 * O(T) on the worker path where T = bound-stream count (tens to low
 * hundreds in practice). No allocations in the SIGTERM-fast path
 * beyond the `failed` literal.
 */
@Injectable()
export class HealthService {
  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    @Inject(AdapterTenantConnectionManager)
    private readonly tenantConnections:
      | TenantConnectionManager
      | TenantMongoConnectionManager,
    private readonly internalSync: InternalSyncService,
  ) {
    ensureSigtermFlagHandler();
  }

  /**
   * Liveness payload. NEVER include dependency state here — kubelet's
   * liveness failure restarts the pod, which would amplify a transient
   * broker outage into a restart storm (REQ-AST-003 liveness).
   */
  liveness(): { status: "ok" } {
    return { status: "ok" };
  }

  /** True once a SIGTERM/SIGINT has been observed by this process. */
  isShuttingDown(): boolean {
    return isShuttingDownFlag;
  }

  /** Resolved at every probe (cached upstream by the runtime helper). */
  mode(): ServiceModeName {
    return isWorkerMode() ? "worker" : "api";
  }

  /**
   * Computes readiness with mode-aware gating. Caller (controller)
   * decides the HTTP status code from `result.ready`.
   */
  async readiness(): Promise<IReadinessResult> {
    const mode: ServiceModeName = this.mode();

    if (isShuttingDownFlag) {
      return {
        ready: false,
        status: "fail",
        failed: ["shutting_down"],
        mode,
      };
    }

    if (mode === "api") {
      const dbOk = await this.checkDb();
      if (!dbOk) {
        return { ready: false, status: "fail", failed: ["db"], mode };
      }
      return { ready: true, status: "ok", failed: [], mode };
    }

    const failed: ReadinessGate[] = [];

    if (!this.checkNats()) failed.push("nats");
    if (!(await this.checkDb())) failed.push("db");
    if (!this.checkDurables()) failed.push("durables");

    return {
      ready: failed.length === 0,
      status: failed.length === 0 ? "ok" : "fail",
      failed,
      mode,
    };
  }

  /**
   * Cheap synchronous probe: NATS client tracks connection state in
   * memory, so `isClosed()` is O(1) with no broker round-trip. Falls
   * back to "unhealthy" on any unexpected throw — the spec's NATS
   * gate must err on the side of 503.
   */
  private checkNats(): boolean {
    try {
      return !this.nc.isClosed();
    } catch {
      return false;
    }
  }

  /**
   * `verifyConnectivity()` walks the in-process pool cache and
   * returns true on the first `SELECT 1` that succeeds. Returns true
   * when no pools are cached yet (cold start) — matches the audit /
   * metrics convention so api `/readyz` doesn't false-fail before
   * the first tenant request hydrates a pool.
   */
  private async checkDb(): Promise<boolean> {
    try {
      return await this.tenantConnections.verifyConnectivity();
    } catch {
      return false;
    }
  }

  /**
   * Worker-mode durable gate (REQ-AST-004 #3): pass when ≥1 bound
   * `NatsConsumerRunner` reports healthy. Snapshot is read-only and
   * does not call into the broker.
   */
  private checkDurables(): boolean {
    const snapshot = this.internalSync.getRunnerHealthSnapshot();
    for (let i = 0; i < snapshot.length; i++) {
      if (snapshot[i]?.healthy === true) return true;
    }
    return false;
  }
}
