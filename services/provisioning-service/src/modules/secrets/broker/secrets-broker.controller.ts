// INTERNAL-ONLY route — `POST /internal/secrets/resolve`.
//
// SPEC.md hard rule: this route is NEVER exposed via the api-gateway. T07's
// gateway proxy module (`/api/provisioning/*`) MUST NOT add a route for
// `/internal/*` — enforced by a T07 unit test asserting the broker route is
// absent from the gateway's route table. Reachable only inside the
// cluster's network (other provisioning-service internals call
// `SecretsBrokerService` directly via DI; this HTTP route exists for
// FUTURE out-of-process internal consumers, per SPEC.md's note that the
// broker contract "must not preclude" today's other credential-resolution
// modes unifying onto it later).
//
// Still tenant-scoped (`TenantGuard`) — internal-only is an ADDITIONAL
// constraint (never gateway-routed), not a replacement for tenant
// isolation.

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from "@nestjs/common";
import { TenantGuard, TenantId } from "@yoizen/database";
import { PinoLoggerService } from "@yoizen/observability";
import type { ResourceKind } from "../../plan/domain/plan.interfaces";
import { SecretsBrokerService } from "./secrets-broker.service";

interface ResolveSecretBody {
  readonly consumerService?: unknown;
  readonly secretName?: unknown;
  readonly actingResource?: {
    readonly kind?: unknown;
    readonly owner?: unknown;
  };
  readonly correlationId?: unknown;
}

const VALID_KINDS = new Set<ResourceKind>([
  "channel",
  "connector",
  "agent",
  "service",
  "workflow",
]);

@Controller("internal/secrets")
@UseGuards(TenantGuard)
export class SecretsBrokerController {
  private readonly logger = new PinoLoggerService(SecretsBrokerController.name);

  constructor(private readonly broker: SecretsBrokerService) {}

  @Post("resolve")
  @HttpCode(HttpStatus.OK)
  async resolve(@TenantId() tenantId: string, @Body() body: ResolveSecretBody) {
    this.logger.log(
      `POST /internal/secrets/resolve tenant='${tenantId}' (INTERNAL ONLY — never gateway-routed)`
    );

    const consumerService =
      typeof body.consumerService === "string" ? body.consumerService : "";
    const secretName =
      typeof body.secretName === "string" ? body.secretName : "";
    const kind = body.actingResource?.kind;
    const owner = body.actingResource?.owner;
    const correlationId =
      typeof body.correlationId === "string" ? body.correlationId : "";

    if (
      !consumerService ||
      !secretName ||
      typeof kind !== "string" ||
      !VALID_KINDS.has(kind as ResourceKind) ||
      typeof owner !== "string" ||
      !owner ||
      !correlationId
    ) {
      return {
        ok: false,
        error: {
          kind: "invalid_request",
          message:
            "consumerService, secretName, actingResource.{kind,owner}, correlationId are all required",
        },
      };
    }

    const result = await this.broker.resolve({
      tenantId,
      consumerService,
      secretName,
      actingResource: { kind: kind as ResourceKind, owner },
      correlationId,
    });

    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    // Ephemeral — this response body is the value's ONLY hop; never logged.
    return { ok: true, value: result.value };
  }
}
