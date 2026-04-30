import { BadRequestException } from "@nestjs/common";
import { tracedFetch } from "@yoizen/observability";

const GRAPH_API_BASE = "https://graph.facebook.com/v22.0";
const TOKEN_EXCHANGE_TIMEOUT_MS = 10_000;

export interface ITokenExchangeResult {
  readonly accessToken: string;
  readonly tokenType: string;
  /** Seconds until the long-lived token expires (~5 184 000 = 60 days). */
  readonly expiresIn: number;
}

export interface ITokenExchangeParams {
  readonly currentToken: string;
  readonly appId: string;
  readonly appSecret: string;
}

/**
 * Exchanges a short-lived (or long-lived) Meta token for a new
 * long-lived token (~60 days) using the `fb_exchange_token` grant.
 *
 * @see https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
 */
export async function exchangeForLongLivedToken(
  params: ITokenExchangeParams,
): Promise<ITokenExchangeResult> {
  const { currentToken, appId, appSecret } = params;

  const url = new URL(`${GRAPH_API_BASE}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("fb_exchange_token", currentToken);

  const res = await tracedFetch(url.toString(), {
    method: "GET",
    signal: AbortSignal.timeout(TOKEN_EXCHANGE_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new BadRequestException(
      `Meta token exchange failed (HTTP ${res.status}): ${body}`,
    );
  }

  const data = (await res.json()) as {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
  };

  if (!data.access_token) {
    throw new BadRequestException(
      "Meta token exchange response missing access_token",
    );
  }

  return {
    accessToken: data.access_token,
    tokenType: data.token_type ?? "bearer",
    expiresIn: data.expires_in ?? 5_184_000,
  };
}
