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

// DRIFT GUARD (manual-loops/provisioning-manifest-gaps-2.md T07): this is the
// THIRD hand-kept copy of the valid secret-scope-kind set — the parent SPEC's
// T07 dedup unified only the two CLI copies into
// `sdk/src/cli/valid-scope-kinds.ts`; this server-side controller copy was
// missed and drifted (it lacked `mcpServer`, silently rejecting every
// mcpServer-scoped binding at PUT /secrets even though T06-parent shipped
// mcpServer `auth`/`headers` secretRef bindings). Kept in sync MANUALLY with
// `@yoizen/shared`'s `secretScopeKindSchema`
// (`packages/shared/src/provisioning/manifest.schema.ts`) and the CLI mirror.
// `mcpServer` IS valid — T06's `mcpServer.auth`/`headers` bind secrets to it,
// and `validate-structural-rules.ts` checks the binding's `scope.kind ===
// "mcpServer"`. `systemVariable` is DELIBERATELY OMITTED (semantically dead,
// mirroring the CLI's reviewed rationale): `secretScopeKindSchema` gained it
// in T04 only so `ResourceKind` (literally `= SecretScopeKind` here, see
// `plan/domain/plan.interfaces.ts`) could carry systemVariables through the
// generic plan/apply pipeline — the manifest schema rejects
// `systemVariables[].type: "secret"` entirely, so no system variable can ever
// declare a nested secretRef and no binding to a systemVariable owner is ever
// consumed.
const VALID_SCOPE_KINDS = new Set<ResourceKind>([
  "channel",
  "connector",
  "agent",
  "service",
  "mcpServer",
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
            "body must be { value: non-empty string, scope: { kind: channel|connector|agent|service|mcpServer|workflow, owner: slug-like name } }",
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
