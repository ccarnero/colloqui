import { httpJson } from "./http.js";
import { ChannelResolutionError } from "../domain/errors.js";

/** Tenant routing header enforced by the api-gateway. */
const TENANT_HEADER = "x-yoizen-tenant";

/**
 * ChannelDirectoryPort implementation. Lists the tenant's channel accounts, picks the
 * active http account, and returns its appSecret (returned in plaintext by the gateway).
 *
 * @param {{ fetchImpl: typeof fetch, baseUrl: string, timeoutMs: number }} deps
 * @returns {import("../application/ports.js").ChannelDirectoryPort}
 */
export function createChannelDirectoryAdapter({ fetchImpl, baseUrl, timeoutMs }) {
  async function resolveHttpSecret({ token, tenant, selector }) {
    const { status, ok, body } = await httpJson(fetchImpl, {
      url: `${baseUrl}/api/channels/accounts?channel=http`,
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        [TENANT_HEADER]: tenant,
      },
      timeoutMs,
    });

    if (!ok) {
      throw new ChannelResolutionError("failed to list channel accounts", {
        details: { httpStatus: status, body },
      });
    }

    const accounts = Array.isArray(body) ? body : [];
    let candidates = accounts.filter(
      (a) => a?.channel === "http" && a?.isActive === true,
    );
    if (selector?.externalId) {
      candidates = candidates.filter((a) => a.externalId === selector.externalId);
    } else if (selector?.name) {
      candidates = candidates.filter((a) => a.name === selector.name);
    }

    const account = candidates[0];
    if (!account) {
      throw new ChannelResolutionError("no active http channel account found", {
        details: { tenant, selector },
      });
    }
    if (typeof account.appSecret !== "string" || account.appSecret.length === 0) {
      throw new ChannelResolutionError("http channel account has no appSecret", {
        details: { accountId: account.id },
      });
    }

    return { appSecret: account.appSecret, accountId: account.id };
  }

  return { resolveHttpSecret };
}
