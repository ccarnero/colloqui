import type { ChannelDirectoryPort } from "../application/ports.js";
import type { Transport } from "../core/transport.js";
import { ChannelResolutionError, SdkError } from "../domain/errors.js";

export interface ChannelDirectoryAdapterDeps {
  transport: Transport;
}

interface ChannelAccount {
  id: string;
  channel?: string;
  isActive?: boolean;
  appSecret?: string;
  name?: string;
  externalId?: string;
}

/**
 * ChannelDirectoryPort implementation over the shared {@link Transport}.
 * Lists the tenant's channel accounts, picks the active http account, and
 * returns its appSecret (returned in plaintext by the gateway). The caller
 * passes an already-resolved `token` explicitly (from `Session.ensureToken`)
 * rather than relying on a transport-bound session, so this adapter works
 * the same whether or not the transport instance has a session attached.
 */
export function createChannelDirectoryAdapter({
  transport,
}: ChannelDirectoryAdapterDeps): ChannelDirectoryPort {
  async function resolveHttpSecret({
    token,
    tenant,
    selector,
  }: {
    token: string;
    tenant: string;
    selector?: { name?: string; externalId?: string };
  }) {
    let accounts: ChannelAccount[];
    try {
      const { body } = await transport.request<ChannelAccount[]>({
        path: "/channels/accounts?channel=http",
        method: "GET",
        token,
        tenant,
      });
      accounts = Array.isArray(body) ? body : [];
    } catch (err) {
      throw new ChannelResolutionError("failed to list channel accounts", {
        cause: err,
        details: err instanceof SdkError ? err.details : undefined,
      });
    }

    let candidates = accounts.filter(
      (a) => a?.channel === "http" && a?.isActive === true
    );
    if (selector?.externalId) {
      candidates = candidates.filter(
        (a) => a.externalId === selector.externalId
      );
    } else if (selector?.name) {
      candidates = candidates.filter((a) => a.name === selector.name);
    }

    const account = candidates[0];
    if (!account) {
      throw new ChannelResolutionError("no active http channel account found", {
        details: { tenant, selector },
      });
    }
    if (
      typeof account.appSecret !== "string" ||
      account.appSecret.length === 0
    ) {
      throw new ChannelResolutionError(
        "http channel account has no appSecret",
        {
          details: { accountId: account.id },
        }
      );
    }

    return {
      appSecret: account.appSecret,
      accountId: account.id,
      ...(account.externalId !== undefined
        ? { externalId: account.externalId }
        : {}),
    };
  }

  return { resolveHttpSecret };
}
