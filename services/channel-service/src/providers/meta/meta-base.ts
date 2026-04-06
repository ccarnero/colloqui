import type { LoggerService } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "crypto";
import { tracedFetch } from "@yoizen/observability";
import type { SendMessageResult } from "@yoizen/shared";

const SEND_TIMEOUT_MS = 10_000;

/** POST JSON to Meta Graph API with Bearer auth, shared timeout and error handling. */
export interface ISendMetaMessageParams {
  readonly url: string;
  readonly token: string;
  readonly body: Record<string, unknown>;
  readonly logger: LoggerService;
  /** Prefix for log lines, e.g. "WhatsApp" or "Instagram". */
  readonly logLabel: string;
  /** Maps successful JSON body to provider message id (channel-specific). */
  readonly parseSuccessBody: (data: unknown) => string | undefined;
}

/**
 * POST JSON to Meta Graph API with Bearer auth, shared timeout and error handling.
 */
export async function sendMetaMessage(
  params: ISendMetaMessageParams,
): Promise<SendMessageResult> {
  const { url, token, body, logger, logLabel, parseSuccessBody } = params;

  try {
    const res = await tracedFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      logger.warn(`${logLabel} send failed: ${res.status} ${errorBody}`);
      return {
        success: false,
        error: `HTTP ${res.status}: ${errorBody}`,
        timestamp: new Date().toISOString(),
      };
    }

    const data: unknown = await res.json();
    return {
      success: true,
      providerMessageId: parseSuccessBody(data),
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(`${logLabel} send error: ${errorMsg}`);
    return {
      success: false,
      error: errorMsg,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Verifies `X-Hub-Signature-256` (sha256=hex) for Meta webhooks.
 */
export function verifyWebhookSignature(
  rawBody: Buffer,
  signature: string,
  secret: string,
): boolean {
  const expectedSig = createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const expected = `sha256=${expectedSig}`;
  if (signature.length !== expected.length) return false;

  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
