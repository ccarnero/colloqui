// Concrete JetStream-backed implementation of `IApplyEventPublisher`
// (TAXONOMY.md rule 22, `manual-loops/declarative-provisioning.md` T04).
// Mirrors registry-service's `ServiceEventsPublisher` — best-effort,
// post-write, NEVER throws to the caller (a broker outage must never break
// the apply engine itself).
//
// Human-approved subject naming (2026-07-14), 8-token canonical shape:
//   evt.<tenant>.provisioning-service.provisioning.platform.internal.apply_started.v1
//   evt.<tenant>.provisioning-service.provisioning.platform.internal.resource_applied.v1
//   evt.<tenant>.provisioning-service.provisioning.platform.internal.apply_completed.v1
//   evt.<tenant>.provisioning-service.provisioning.platform.internal.apply_failed.v1
//
// Secret VALUES never appear in these payloads — apply-manifest.ts only ever
// passes resource kind/name/verdict/externalId, never manifest field values.

import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { ensureTenantIngressStream } from "@yoizen/database";
import {
  injectTraceContext,
  logWithEnvelope,
  PinoLoggerService,
} from "@yoizen/observability";
import {
  buildEventEnvelope,
  buildSubject,
  TENANT_HEADER,
} from "@yoizen/shared";
import type { JetStreamClient, JetStreamManager } from "nats";
import { headers as natsHeaders } from "nats";
import { JETSTREAM, JETSTREAM_MANAGER } from "../../../providers/nats.provider";
import type {
  ApplyCompletedEvent,
  ApplyFailedEvent,
  ApplyRunAudit,
  ApplyStartedEvent,
  IApplyEventPublisher,
  ResourceAppliedEvent,
} from "../domain/apply-event-publisher.interface";

const PRODUCER = "provisioning-service";
const DOMAIN = "provisioning";
const CHANNEL = "platform";
const PROVIDER = "internal";
const SOURCE = "//provisioning-service/manifests";

/** Depth of every sibling event (constant) — one hop off the run root. */
const SIBLING_DEPTH = 1;

/**
 * Causal wiring for one published envelope. The run root (`apply_started`)
 * fixes `id` and `correlationId` to the same generated UUID with a null
 * causation at depth 0; siblings inherit the root's `correlationId`, cite
 * its id as `causationId`, and sit at `SIBLING_DEPTH`. Mirrors
 * `execution-completed-publisher.activity.ts`'s sibling-hop wiring.
 */
interface PublishCausal {
  readonly id?: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly depth: number;
}

@Injectable()
export class ApplyEventsPublisher implements IApplyEventPublisher {
  private readonly logger = new PinoLoggerService(ApplyEventsPublisher.name);
  private readonly encoder = new TextEncoder();
  private readonly ensuredTenants = new Set<string>();

  constructor(
    @Inject(JETSTREAM) private readonly js: JetStreamClient,
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager
  ) {}

  async applyStarted(event: ApplyStartedEvent): Promise<ApplyRunAudit> {
    // The run ROOT: generate its id up front so correlation_id can equal it
    // (root correlation = own id) and every sibling can cite it as causation.
    const runId = randomUUID();
    await this.publish(
      event.tenantId,
      "apply_started",
      {
        manifestName: event.manifestName,
        revision: event.revision,
        resourceCount: event.resourceCount,
      },
      { id: runId, correlationId: runId, causationId: null, depth: 0 }
    );
    return { causationId: runId, correlationId: runId };
  }

  async resourceApplied(event: ResourceAppliedEvent): Promise<void> {
    await this.publish(
      event.tenantId,
      "resource_applied",
      {
        manifestName: event.manifestName,
        kind: event.kind,
        name: event.name,
        verdict: event.verdict,
        externalId: event.externalId,
      },
      {
        correlationId: event.correlationId,
        causationId: event.causationId,
        depth: SIBLING_DEPTH,
      }
    );
  }

  async applyCompleted(event: ApplyCompletedEvent): Promise<void> {
    await this.publish(
      event.tenantId,
      "apply_completed",
      {
        manifestName: event.manifestName,
        appliedCount: event.appliedCount,
        noopCount: event.noopCount,
        durationMs: event.durationMs,
      },
      {
        correlationId: event.correlationId,
        causationId: event.causationId,
        depth: SIBLING_DEPTH,
      }
    );
  }

  async applyFailed(event: ApplyFailedEvent): Promise<void> {
    await this.publish(
      event.tenantId,
      "apply_failed",
      {
        manifestName: event.manifestName,
        kind: event.failure.resourceKind,
        name: event.failure.resourceName,
        message: event.failure.message,
        appliedSoFar: event.appliedSoFar,
      },
      {
        correlationId: event.correlationId,
        causationId: event.causationId,
        depth: SIBLING_DEPTH,
      }
    );
  }

  private async publish(
    tenantId: string,
    kind:
      | "apply_started"
      | "resource_applied"
      | "apply_completed"
      | "apply_failed",
    payload: Record<string, unknown>,
    causal: PublishCausal
  ): Promise<void> {
    if (!tenantId) {
      this.logger.warn(
        `apply-events.publish_dropped reason=missing_tenant kind=${kind}`
      );
      return;
    }

    const subject = buildSubject({
      tenant: tenantId,
      producer: PRODUCER,
      domain: DOMAIN,
      channel: CHANNEL,
      provider: PROVIDER,
      kind,
      version: "v1",
    });

    const envelope = buildEventEnvelope({
      ...(causal.id !== undefined && { id: causal.id }),
      type: `io.yoizen.provisioning.${kind}.v1`,
      source: SOURCE,
      resource: `manifest/${String(payload.manifestName ?? "unknown")}`,
      tenant: tenantId,
      producer: PRODUCER,
      domain: DOMAIN,
      channel: CHANNEL,
      provider: PROVIDER,
      accountid: tenantId,
      payload,
      correlationId: causal.correlationId,
      causationId: causal.causationId,
      depth: causal.depth,
      // These events ride JetStream (per-tenant INGRESS stream), so the
      // transport method is "stream" — matches the golden fixtures
      // (seq1322-1326) and registry-service/connector-runtime publishers.
      transport: {
        method: "stream",
        protocol: "internal",
        depth: causal.depth,
      },
    });

    const ensured = await this.ensureTenantStream(tenantId, kind);
    if (!ensured) {
      return;
    }

    const hdrs = natsHeaders();
    hdrs.set(TENANT_HEADER, tenantId);
    hdrs.set("Nats-Msg-Id", envelope.idempotencykey);
    hdrs.set("X-Correlation-Id", envelope.correlation_id);
    if (envelope.causation_id) {
      hdrs.set("X-Causation-Id", envelope.causation_id);
    }
    injectTraceContext(hdrs);

    try {
      await this.js.publish(
        subject,
        this.encoder.encode(JSON.stringify(envelope)),
        { headers: hdrs, msgID: envelope.idempotencykey }
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      logWithEnvelope(
        this.logger,
        envelope,
        `provisioning.${kind}.publish_failed`,
        `${kind} publish FAILED subject=${subject}: ${message}`,
        "error"
      );
      return;
    }

    logWithEnvelope(
      this.logger,
      envelope,
      `provisioning.${kind}.published`,
      `${kind} published subject=${subject}`
    );
  }

  private async ensureTenantStream(
    tenantId: string,
    kind: string
  ): Promise<boolean> {
    if (this.ensuredTenants.has(tenantId)) {
      return true;
    }
    try {
      await ensureTenantIngressStream(this.jsm, tenantId);
      this.ensuredTenants.add(tenantId);
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      this.logger.error(
        `apply-events.ensure_stream_failed kind=${kind} tenant='${tenantId}': ${message}`
      );
      return false;
    }
  }
}
