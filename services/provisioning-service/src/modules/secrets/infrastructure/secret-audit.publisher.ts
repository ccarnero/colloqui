// Concrete JetStream-backed implementation of `ISecretAuditPublisher`
// (TAXONOMY.md rule 23, `manual-loops/declarative-provisioning.md` T05).
// Mirrors `ApplyEventsPublisher` (T04) almost verbatim — same tenant
// stream, same envelope shape, same best-effort/never-throw contract —
// differing only in the `kind`s published and the causal wiring documented
// in `secret-audit-publisher.interface.ts`.
//
// Secret VALUES never appear in these payloads — only name/kind/owner/
// consumer/correlation metadata (SPEC.md hard rule).

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
  ISecretAuditPublisher,
  SecretAccessDeniedEvent,
  SecretResolvedEvent,
  SecretWrittenEvent,
} from "../domain/secret-audit-publisher.interface";

const PRODUCER = "provisioning-service";
const DOMAIN = "provisioning";
const CHANNEL = "platform";
const PROVIDER = "internal";
const SOURCE = "//provisioning-service/secrets";

const SIBLING_DEPTH = 1;

type SecretAuditKind =
  | "secret_written"
  | "secret_resolved"
  | "secret_access_denied";

interface PublishCausal {
  readonly id?: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly depth: number;
}

@Injectable()
export class SecretAuditPublisher implements ISecretAuditPublisher {
  private readonly logger = new PinoLoggerService(SecretAuditPublisher.name);
  private readonly encoder = new TextEncoder();
  private readonly ensuredTenants = new Set<string>();

  constructor(
    @Inject(JETSTREAM) private readonly js: JetStreamClient,
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager
  ) {}

  async secretWritten(event: SecretWrittenEvent): Promise<void> {
    // Standalone root: PUT /secrets/:name is an operator action, not a step
    // inside an existing apply-run chain (see interface doc comment).
    const rootId = randomUUID();
    await this.publish(
      event.tenantId,
      "secret_written",
      {
        secretName: event.secretName,
        kind: event.kind,
        owner: event.owner,
      },
      { id: rootId, correlationId: rootId, causationId: null, depth: 0 }
    );
  }

  async secretResolved(event: SecretResolvedEvent): Promise<void> {
    await this.publish(
      event.tenantId,
      "secret_resolved",
      {
        secretName: event.secretName,
        kind: event.kind,
        owner: event.owner,
        consumerService: event.consumerService,
      },
      {
        correlationId: event.correlationId,
        // Sibling hop off the caller's chain root — see interface doc.
        causationId: event.correlationId,
        depth: SIBLING_DEPTH,
      }
    );
  }

  async secretAccessDenied(event: SecretAccessDeniedEvent): Promise<void> {
    await this.publish(
      event.tenantId,
      "secret_access_denied",
      {
        secretName: event.secretName,
        kind: event.kind,
        owner: event.owner,
        consumerService: event.consumerService,
        reason: event.reason,
      },
      {
        correlationId: event.correlationId,
        causationId: event.correlationId,
        depth: SIBLING_DEPTH,
      }
    );
  }

  private async publish(
    tenantId: string,
    kind: SecretAuditKind,
    payload: Record<string, unknown>,
    causal: PublishCausal
  ): Promise<void> {
    if (!tenantId) {
      this.logger.warn(
        `secret-audit.publish_dropped reason=missing_tenant kind=${kind}`
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
      resource: `secret/${String(payload.kind ?? "unknown")}/${String(payload.owner ?? "unknown")}`,
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
        `secrets.${kind}.publish_failed`,
        `${kind} publish FAILED subject=${subject}: ${message}`,
        "error"
      );
      return;
    }

    logWithEnvelope(
      this.logger,
      envelope,
      `secrets.${kind}.published`,
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
        `secret-audit.ensure_stream_failed kind=${kind} tenant='${tenantId}': ${message}`
      );
      return false;
    }
  }
}
