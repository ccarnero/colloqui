import { Inject, Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import type { JetStreamClient } from "nats";
import { PinoLoggerService } from "@yoizen/observability";
import { buildPlatformSubject, SCHEDULER_HEARTBEAT } from "@yoizen/shared";
import { JETSTREAM } from "../../providers/nats.provider";
import type { IHeartbeatEngine } from "../../abstractions/heartbeat-engine.interface";

const HEARTBEAT_INTERVAL_MS = 15_000;
const TENANT_ACTIVITY_TTL_MS = 5 * 60_000;

@Injectable()
export class HeartbeatService implements IHeartbeatEngine, OnModuleInit, OnModuleDestroy {
  private readonly logger = new PinoLoggerService(HeartbeatService.name);
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly activeTenants = new Map<string, number>();
  private running = false;

  constructor(
    @Inject(JETSTREAM) private readonly js: JetStreamClient,
  ) {}

  // ── IHeartbeatEngine ──────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.intervalId = setInterval(
      () => this.publishHeartbeats(),
      HEARTBEAT_INTERVAL_MS,
    );
    this.logger.log(`[heartbeat] Started with interval ${HEARTBEAT_INTERVAL_MS}ms`);
  }

  async stop(): Promise<void> {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
    this.logger.log("[heartbeat] Stopped");
  }

  isRunning(): boolean {
    return this.running;
  }

  // ── Lifecycle hooks ───────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    await this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  // ── Tenant activity tracking ──────────────────────────────────────────────

  markTenantActive(tenantId: string): void {
    this.activeTenants.set(tenantId, Date.now());
  }

  getActiveTenants(): string[] {
    const now = Date.now();
    const active: string[] = [];

    for (const [tenantId, lastActivity] of this.activeTenants) {
      if (now - lastActivity < TENANT_ACTIVITY_TTL_MS) {
        active.push(tenantId);
      } else {
        this.activeTenants.delete(tenantId);
      }
    }

    return active;
  }

  // ── Heartbeat publishing ──────────────────────────────────────────────────

  private async publishHeartbeats(): Promise<void> {
    const tenants = this.getActiveTenants();
    if (tenants.length === 0) {
      return;
    }

    const timestamp = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();

    for (const tenantId of tenants) {
      try {
        const envelope = {
          specversion: "1.0",
          id: crypto.randomUUID(),
          type: "io.yoizen.platform.scheduler.heartbeat.v1",
          source: "agent-scheduler-service",
          resource: "agent-scheduler-service/heartbeat",
          time: timestamp,
          correlation_id: correlationId,
          idempotencykey: idempotencyKey,
          tenant: tenantId,
          producer: "agent-scheduler-service",
          domain: "automation",
          channel: "platform",
          provider: "internal",
          transport: { name: "nats", version: "1.0" },
          data: {
            payload: {
              activeTenants: tenants.length,
              status: "online",
              service: "agent-scheduler-service",
              timestamp,
            },
          },
        };

        const subject = buildPlatformSubject(SCHEDULER_HEARTBEAT, tenantId);
        await this.js.publish(subject, JSON.stringify(envelope));
      } catch (error) {
        this.logger.warn(
          `[heartbeat] Failed to publish for tenant '${tenantId}': ${error}`,
        );
      }
    }
  }
}
