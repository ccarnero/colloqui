import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import type { JetStreamClient } from "nats";
import { JETSTREAM } from "../../providers/nats.provider";

const HEARTBEAT_INTERVAL_MS = 15_000;
const TENANT_ACTIVITY_TTL_MS = 5 * 60_000;

@Injectable()
export class HeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PinoLoggerService(HeartbeatService.name);
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly activeTenants = new Map<string, number>();

  constructor(@Inject(JETSTREAM) private readonly js: JetStreamClient) {}

  onModuleInit(): void {
    this.intervalId = setInterval(
      () => this.publishHeartbeats(),
      HEARTBEAT_INTERVAL_MS
    );
    this.logger.log(
      `[heartbeat] Started with interval ${HEARTBEAT_INTERVAL_MS}ms`
    );
  }

  onModuleDestroy(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.logger.log("[heartbeat] Stopped");
  }

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

  private async publishHeartbeats(): Promise<void> {
    const tenants = this.getActiveTenants();
    if (tenants.length === 0) {
      return;
    }

    const timestamp = new Date().toISOString();
    const envelope = {
      specversion: "1.0",
      id: crypto.randomUUID(),
      source: "agent-ai-service/heartbeat",
      type: "io.yoizen.platform.runtime.online.v1",
      resource: "agent-ai-service/heartbeat",
      time: timestamp,
      traceid: "",
      causation_id: null,
      correlation_id: crypto.randomUUID(),
      tenant: "",
      producer: "agent-ai-service",
      domain: "automation",
      channel: "platform",
      provider: "internal",
      accountid: "",
      idempotencykey: crypto.randomUUID(),
      transport: { name: "nats", version: "1.0" },
      data: {
        payload: {
          status: "online",
          service: "agent-ai-service",
          timestamp,
          activeTenants: tenants.length,
        },
      },
    };

    for (const tenantId of tenants) {
      try {
        const subject = `evt.${tenantId}.ai-agent-gateway.automation.platform.internal.online.v1`;
        const msg = { ...envelope, tenant: tenantId, id: crypto.randomUUID() };
        this.js.publish(subject, JSON.stringify(msg));
      } catch (error) {
        this.logger.warn(
          `[heartbeat] Failed to publish for tenant '${tenantId}': ${error}`
        );
      }
    }

    this.logger.debug(
      `[heartbeat] Published online status for ${tenants.length} tenant(s)`
    );
  }
}
