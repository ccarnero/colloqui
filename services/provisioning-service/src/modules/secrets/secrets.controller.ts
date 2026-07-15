// `PUT /secrets/:name` / `GET /secrets` — SPEC.md write-only Secret API.
// No route on this controller (or anywhere else in the service) ever
// returns a secret value — `PUT` echoes back only `{name, scope}`, `GET`
// lists `{name, scope}` entries only.

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Put,
  UseGuards,
} from "@nestjs/common";
import { TenantGuard, TenantId } from "@yoizen/database";
import { PinoLoggerService } from "@yoizen/observability";
import { nameSchema } from "@yoizen/shared";
import type { ResourceKind } from "../plan/domain/plan.interfaces";
import { SecretsService } from "./secrets.service";

interface PutSecretBody {
  readonly value?: unknown;
  readonly scope?: { readonly kind?: unknown; readonly owner?: unknown };
}

const VALID_SCOPE_KINDS = new Set<ResourceKind>([
  "channel",
  "connector",
  "agent",
  "service",
  "workflow",
]);

@Controller("secrets")
@UseGuards(TenantGuard)
export class SecretsController {
  private readonly logger = new PinoLoggerService(SecretsController.name);

  constructor(private readonly secretsService: SecretsService) {}

  @Put(":name")
  @HttpCode(HttpStatus.OK)
  async put(
    @TenantId() tenantId: string,
    @Param("name") name: string,
    @Body() body: PutSecretBody
  ) {
    this.logger.log(
      `PUT /secrets/${name} tenant='${tenantId}' (request body value NEVER logged)`
    );

    if (!nameSchema.safeParse(name).success) {
      throw new HttpException(
        {
          errors: [
            `secret name '${name}' must be slug-like (see @yoizen/shared nameSchema)`,
          ],
        },
        HttpStatus.BAD_REQUEST
      );
    }

    const value = typeof body.value === "string" ? body.value : "";
    const kind = body.scope?.kind;
    const owner = body.scope?.owner;

    if (
      !value ||
      typeof kind !== "string" ||
      !VALID_SCOPE_KINDS.has(kind as ResourceKind) ||
      typeof owner !== "string" ||
      !nameSchema.safeParse(owner).success
    ) {
      throw new HttpException(
        {
          errors: [
            "body must be { value: non-empty string, scope: { kind: channel|connector|agent|service|workflow, owner: slug-like name } }",
          ],
        },
        HttpStatus.BAD_REQUEST
      );
    }

    const result = await this.secretsService.write(tenantId, name, {
      value,
      scope: { kind: kind as ResourceKind, owner },
    });
    if (!result.ok) {
      throw new HttpException(
        { errors: [result.error.message] },
        HttpStatus.BAD_GATEWAY
      );
    }
    // Echoes ONLY name + scope — never the value (write-only guarantee).
    return result.value;
  }

  @Get()
  async list(@TenantId() tenantId: string) {
    this.logger.log(`GET /secrets tenant='${tenantId}'`);
    const result = await this.secretsService.list(tenantId);
    if (!result.ok) {
      throw new HttpException(
        { errors: [result.error.message] },
        HttpStatus.BAD_GATEWAY
      );
    }
    // Names + bindings ONLY — never values.
    return { secrets: result.value };
  }
}
