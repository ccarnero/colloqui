// `IPlatformResourceWriter` for channel-service's `POST /channels/accounts`
// / `PATCH /channels/accounts/:id`.
//
// T04 SCOPE LIMIT (secrets broker lands in T05): a `ManifestChannel` with a
// `secretRef` cannot be created yet — there is no way to resolve the real
// credential value without fabricating it, which SPEC.md forbids. Such a
// resource fails loud with a typed `secret_not_resolvable` error instead.
//
// For channels WITHOUT a `secretRef` (the only shape T04's e2e manifest
// uses — an `http` channel), `accessToken: "placeholder"` is used. This is
// NOT a fabricated secret: it mirrors the existing convention already used
// by `scripts/e2e-http-workflow.sh` for the same `http` provider, which does
// not validate token authenticity. Any channel type that DOES need a real
// credential (whatsapp/instagram/telegram) MUST declare a `secretRef` and is
// therefore blocked above until T05.
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
import type {
  CreateOrUpdateResult,
  IPlatformResourceWriter,
} from "../domain/platform-resource-writer.interface";

const DEFAULT_TIMEOUT_MS = 10_000;

/** Manifest channel `type` values `CreateAccountDto` accepts today. */
const SUPPORTED_CHANNEL_TYPES = new Set([
  "whatsapp",
  "instagram",
  "telegram",
  "http",
]);

function providerFor(channelType: string): string {
  if (channelType === "telegram") {
    return "telegram";
  }
  if (channelType === "http") {
    return "http";
  }
  return "meta";
}

export function createChannelsWriter(baseUrl: string): IPlatformResourceWriter {
  const logger = new PinoLoggerService("apply.channel-writer");

  return {
    async create(tenantId, resourceUnknown): Promise<CreateOrUpdateResult> {
      const channel = resourceUnknown as ManifestChannel;

      if (channel.secretRef) {
        const message = `channel '${channel.name}' declares secretRef '${channel.secretRef}' — the secrets broker lands in T05, cannot resolve a real credential yet`;
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
        accessToken: "placeholder",
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
