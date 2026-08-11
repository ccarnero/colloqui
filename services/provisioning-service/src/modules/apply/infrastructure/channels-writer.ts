// `IPlatformResourceWriter` for channel-service's `POST /channels/accounts`
// / `PATCH /channels/accounts/:id`.
//
// T05: a `ManifestChannel` with a `secretRef` first attempts broker
// resolution (`secretResolver`, wired to the T05 secrets broker) — if that
// resolves, the real value is used as `accessToken` and NEVER logged. If no
// resolver is wired (tests, or a not-yet-bound secret) it fails loud with a
// typed `secret_not_resolvable` error, exactly like T04.
//
// For channels WITHOUT a `secretRef` (the only shape T04's e2e manifest
// uses — an `http` channel), `accessToken: "placeholder"` is used. This is
// NOT a fabricated secret: it mirrors the existing convention already used
// by `scripts/e2e/http-workflow.sh` for the same `http` provider, which does
// not validate token authenticity.
//
// Update: the T03 comparable-fields contract for channels projects ONLY
// `type` (see `comparable-fields.ts`), and `UpdateAccountDto` has no field to
// change a live account's channel/type. So an `update` verdict for a channel
// has zero mappable fields — per SPEC.md ("an update verdict updates only
// mappable fields"), that means no HTTP call is made; the existing
// `externalId` is returned unchanged.

import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import type { ManifestChannel } from "@yoizen/shared";
import { TENANT_HEADER } from "@yoizen/shared";
import type { ApplyWriteError } from "../domain/apply.interfaces";
import type {
  CreateOrUpdateResult,
  IPlatformResourceWriter,
} from "../domain/platform-resource-writer.interface";
import type { ISecretValueResolver } from "../domain/secret-value-resolver.interface";

const DEFAULT_TIMEOUT_MS = 10_000;

type ResolveSecretOutcome =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: ApplyWriteError };

/**
 * Resolves a channel's `secretRef` through the broker (T05) if one is
 * wired, else returns the T04 `secret_not_resolvable` typed error. NEVER
 * logs the resolved value — only the outcome.
 */
async function resolveChannelSecret(
  secretResolver: ISecretValueResolver | undefined,
  logger: PinoLoggerService,
  tenantId: string,
  channel: ManifestChannel,
  correlationId: string | undefined
): Promise<ResolveSecretOutcome> {
  const secretRef = channel.secretRef as string;

  if (secretResolver) {
    const resolved = await secretResolver.resolve({
      tenantId,
      kind: "channel",
      owner: channel.name,
      secretName: secretRef,
      correlationId,
    });
    if (resolved.ok) {
      logger.log(
        `create: channel '${channel.name}' resolved secretRef '${secretRef}' via the T05 broker (value NEVER logged)`
      );
      return { ok: true, value: resolved.value };
    }
    logger.warn(
      `create: channel '${channel.name}' secretRef '${secretRef}' broker resolution FAILED: ${resolved.error}`
    );
    return {
      ok: false,
      error: {
        kind: "secret_not_resolvable",
        resourceKind: "channel",
        resourceName: channel.name,
        message: `broker could not resolve secretRef '${secretRef}': ${resolved.error}`,
      },
    };
  }

  const message = `channel '${channel.name}' declares secretRef '${secretRef}' but no secrets broker resolver is wired`;
  logger.warn(`create: ${message}`);
  return {
    ok: false,
    error: {
      kind: "secret_not_resolvable",
      resourceKind: "channel",
      resourceName: channel.name,
      message,
    },
  };
}

/**
 * Manifest channel `type` values `CreateAccountDto` accepts today. Must stay
 * in step with the `@IsIn` on channel-service's `CreateAccountDto.channel` —
 * this set exists to fail the apply with a named `unsupported_kind_shape`
 * instead of a bare 400 from downstream, so a type missing here is rejected
 * even when channel-service would have accepted it.
 */
const SUPPORTED_CHANNEL_TYPES = new Set([
  "telegram",
  "http",
  // Outbound-only sink used by the e2e suite to cover the egress publish path.
  "e2e-tests",
]);

/**
 * Channel type → `provider` for the `POST /channels/accounts` body.
 *
 * Exhaustive over the surviving channels: each is served by its own
 * single-channel provider, so the mapping is the identity. There is NO
 * fallback — the decommissioned Meta family used to absorb every unmapped
 * type, which is how e2e-tests accounts ended up stamped with a Meta
 * provider. An unknown type is a caller bug and throws; `SUPPORTED_CHANNEL_TYPES`
 * is the guard that turns it into a typed `unsupported_kind_shape` apply
 * error before it can ever reach here.
 */
function providerFor(channelType: string): string {
  switch (channelType) {
    case "telegram":
      return "telegram";
    case "http":
      return "http";
    case "e2e-tests":
      return "e2e-tests";
    default:
      throw new Error(
        `providerFor: unknown channel type '${channelType}' — no provider mapping exists (surviving channels: telegram, http, e2e-tests)`
      );
  }
}

export function createChannelsWriter(
  baseUrl: string,
  secretResolver?: ISecretValueResolver
): IPlatformResourceWriter {
  const logger = new PinoLoggerService("apply.channel-writer");

  return {
    async create(
      tenantId,
      resourceUnknown,
      context
    ): Promise<CreateOrUpdateResult> {
      const channel = resourceUnknown as ManifestChannel;
      let accessToken = "placeholder";

      if (channel.secretRef) {
        const resolved = await resolveChannelSecret(
          secretResolver,
          logger,
          tenantId,
          channel,
          context?.correlationId
        );
        if (!resolved.ok) {
          return resolved;
        }
        // Never logged: `resolved.value` is the real credential.
        accessToken = resolved.value;
      }

      if (!SUPPORTED_CHANNEL_TYPES.has(channel.type)) {
        const message = `channel '${channel.name}' has unsupported type '${channel.type}' for channel-service's CreateAccountDto`;
        logger.warn(`create: ${message}`);
        return {
          ok: false,
          error: {
            kind: "unsupported_kind_shape",
            resourceKind: "channel",
            resourceName: channel.name,
            message,
          },
        };
      }

      const url = `${baseUrl}/channels/accounts`;
      const body = {
        channel: channel.type,
        provider: providerFor(channel.type),
        name: channel.name,
        // T04 simplification: manifest schema has no externalId field for
        // channels (only wiring, per SPEC decision 3). Derived deterministically
        // from the manifest name — never a secret value.
        externalId: `manifest:${channel.name}`,
        accessToken,
      };

      logger.log(
        `create: POST ${url} channel='${channel.name}' type='${channel.type}' tenant='${tenantId}'`
      );

      let response: Response;
      try {
        response = await tracedFetch(url, {
          method: "POST",
          headers: {
            [TENANT_HEADER]: tenantId,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });
      } catch (cause) {
        const message = `network failure calling ${url}: ${cause instanceof Error ? cause.message : String(cause)}`;
        logger.warn(`create: ${message}`);
        return {
          ok: false,
          error: {
            kind: "downstream_error",
            resourceKind: "channel",
            resourceName: channel.name,
            message,
          },
        };
      }

      if (!response.ok) {
        const message = `HTTP ${String(response.status)} from ${url}`;
        logger.warn(`create: ${message}`);
        return {
          ok: false,
          error: {
            kind: "downstream_error",
            resourceKind: "channel",
            resourceName: channel.name,
            message,
          },
        };
      }

      const created = (await response.json()) as { id: string };
      logger.log(
        `create: channel '${channel.name}' created -> externalId='${created.id}'`
      );
      return { ok: true, value: { externalId: created.id } };
    },

    async update(
      tenantId,
      externalId,
      resourceUnknown,
      diff
    ): Promise<CreateOrUpdateResult> {
      const channel = resourceUnknown as ManifestChannel;
      const mappableFields = diff.filter((d) => d.field === "name");

      if (mappableFields.length === 0) {
        logger.log(
          `update: channel '${channel.name}' diff has no mappable field for UpdateAccountDto (comparable field is 'type', not patchable) — no-op`
        );
        return { ok: true, value: { externalId } };
      }

      const url = `${baseUrl}/channels/accounts/${externalId}`;
      logger.log(
        `update: PATCH ${url} channel='${channel.name}' tenant='${tenantId}'`
      );

      try {
        const response = await tracedFetch(url, {
          method: "PATCH",
          headers: {
            [TENANT_HEADER]: tenantId,
            "content-type": "application/json",
          },
          body: JSON.stringify({ name: channel.name }),
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });
        if (!response.ok) {
          const message = `HTTP ${String(response.status)} from ${url}`;
          logger.warn(`update: ${message}`);
          return {
            ok: false,
            error: {
              kind: "downstream_error",
              resourceKind: "channel",
              resourceName: channel.name,
              message,
            },
          };
        }
      } catch (cause) {
        const message = `network failure calling ${url}: ${cause instanceof Error ? cause.message : String(cause)}`;
        logger.warn(`update: ${message}`);
        return {
          ok: false,
          error: {
            kind: "downstream_error",
            resourceKind: "channel",
            resourceName: channel.name,
            message,
          },
        };
      }

      return { ok: true, value: { externalId } };
    },
  };
}
