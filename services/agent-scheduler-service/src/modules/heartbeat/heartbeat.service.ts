import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import {
  AGENT_SCHEDULER_PRODUCER,
  AUTOMATION_DOMAIN,
  buildPlatformSubject,
  PLATFORM_CHANNEL,
  PLATFORM_PROVIDER,
  SCHEDULER_HEARTBEAT,
  SCHEDULER_HEARTBEAT_TYPE,
} from "@yoizen/shared";
import type { JetStreamClient } from "nats";
import type { IHeartbeatEngine } from "../../abstractions/heartbeat-engine.interface";
import { JETSTREAM } from "../../providers/nats.provider";

const HEARTBEAT_INTERVAL_MS = 15_000;
const TENANT_ACTIVITY_TTL_MS = 5 * 60_000;

@Injectable()
export class HeartbeatService
  implements IHeartbeatEngine, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new PinoLoggerService(HeartbeatService.name);
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly activeTenants = new Map<string, number>();
  private running = false;

  constructor(
    @Inject(JETSTREAM) private readonly js: JetStreamClient,
  ) {}

  // ── IHeartbeatEngine ──────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    this.intervalId = setInterval(
      () => this.publishHeartbeats(),
      HEARTBEAT_INTERVAL_MS
    );
    this.logger.log(
      `[heartbeat] Started with interval ${HEARTBEAT_INTERVAL_MS}ms`
    );
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
        // Identity fields come from the same shared constants the subject
        // (SCHEDULER_HEARTBEAT) is built from, so envelope and subject cannot
        // disagree (envelope-drift open decision 3; values pinned by this
        // service's heartbeat.service.spec.ts against literals).
        const envelope = {
          specversion: "1.0",
          id: crypto.randomUUID(),
          type: SCHEDULER_HEARTBEAT_TYPE,
          source: AGENT_SCHEDULER_PRODUCER,
          resource: `${AGENT_SCHEDULER_PRODUCER}/heartbeat`,
          time: timestamp,
          correlation_id: correlationId,
          idempotencykey: idempotencyKey,
          tenant: tenantId,
          producer: AGENT_SCHEDULER_PRODUCER,
          domain: AUTOMATION_DOMAIN,
          channel: PLATFORM_CHANNEL,
          provider: PLATFORM_PROVIDER,
          transport: { name: "nats", version: "1.0" },
          data: {
            payload: {
              activeTenants: tenants.length,
              status: "online",
              service: AGENT_SCHEDULER_PRODUCER,
              timestamp,
            },
          },
        };

        const subject = buildPlatformSubject(SCHEDULER_HEARTBEAT, tenantId);
        await this.js.publish(subject, JSON.stringify(envelope));
      } catch (error) {
        this.logger.warn(
          `[heartbeat] Failed to publish for tenant '${tenantId}': ${error}`
        );
      }
    }
  }
}
