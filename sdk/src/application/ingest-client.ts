import { createSession } from "../core/session.js";
import { IngestError, ValidationError } from "../domain/errors.js";
import { normalizeMessage } from "../domain/message.js";
import type {
  AuthPort,
  ChannelDirectoryPort,
  Clock,
  IngestPort,
} from "./ports.js";

export interface IngestClientConfig {
  tenant: string;
  email: string;
  password: string;
  defaultFrom?: string;
  appSecret?: string | null;
  channelSelector?: { name?: string; externalId?: string };
  instance?: string | null;
  tokenExpiryBufferMs?: number;
  onWarn?: (msg: string) => void;
}

export interface IngestClientDeps {
  ports: {
    auth: AuthPort;
    channelDirectory: ChannelDirectoryPort;
    ingest: IngestPort;
  };
  config: IngestClientConfig;
  clock: Clock;
}

export interface SendResult {
  status: string;
  tenant: string;
  accountId?: string;
  messageId?: string;
}

export interface SendTextOpts {
  from?: string;
  type?: string;
  raw?: object;
}

/**
 * The use-case orchestrator. Owns the lazy token + appSecret lifecycle and exposes the
 * `send` / `sendText` primitives. Pure application logic — it talks only to injected
 * ports, never to fetch/env/Date directly.
 */
export function createIngestClient({ ports, config, clock }: IngestClientDeps) {
  const { auth, channelDirectory, ingest } = ports;
  const tenant = config.tenant;
  const defaultFrom = config.defaultFrom ?? config.email;

  // Token lifecycle (login, refresh, expiry buffer, relogin fallback,
  // tenant-scope check) is delegated to the shared Session component
  // (src/core/session.ts) — this client keeps only its appSecret concerns.
  const session = createSession({
    auth,
    clock,
    config: {
      tenant,
      email: config.email,
      password: config.password,
      tokenExpiryBufferMs: config.tokenExpiryBufferMs,
      onWarn: config.onWarn,
    },
  });

  let appSecret: string | null = config.appSecret ?? null;
  let secretPromise: Promise<string> | null = null;
  /**
   * Account externalId for the per-instance ingress URL. Seeded from explicit
   * config / channelSelector; otherwise filled from the directory resolution.
   */
  let instance: string | null =
    config.instance ?? config.channelSelector?.externalId ?? null;

  function ensureSecret(): Promise<string> {
    if (appSecret) {
      return Promise.resolve(appSecret);
    }
    if (!secretPromise) {
      secretPromise = session
        .ensureToken()
        .then((t) =>
          channelDirectory.resolveHttpSecret({
            token: t.accessToken,
            tenant,
            selector: config.channelSelector,
          })
        )
        .then(({ appSecret: resolved, externalId }) => {
          appSecret = resolved;
          if (
            !instance &&
            typeof externalId === "string" &&
            externalId.length > 0
          ) {
            instance = externalId;
          }
          return resolved;
        })
        .finally(() => {
          secretPromise = null;
        });
    }
    return secretPromise;
  }

  function invalidateSecret(): void {
    // Only drop secrets we resolved ourselves; keep an explicitly-configured one.
    if (!config.appSecret) {
      appSecret = null;
    }
  }

  async function ingestOnce(body: Record<string, unknown>) {
    await session.ensureToken();
    const secret = await ensureSecret();
    return ingest.ingest({ tenant, appSecret: secret, body, instance });
  }

  async function send(
    message: Record<string, unknown> = {}
  ): Promise<SendResult> {
    const from = message.from ?? defaultFrom;
    const body = normalizeMessage({ ...message, from });

    let result;
    try {
      result = await ingestOnce(body);
    } catch (err) {
      const isMismatch =
        err instanceof IngestError && err.ingestStatus === "signature_mismatch";
      if (isMismatch && !config.appSecret) {
        invalidateSecret();
        result = await ingestOnce(body); // one retry with a freshly-resolved secret
      } else {
        throw err;
      }
    }

    return {
      status: result.status,
      tenant,
      accountId: result.accountId,
      messageId: result.messageId,
    };
  }

  function sendText(
    text: string,
    opts: SendTextOpts = {}
  ): Promise<SendResult> {
    if (typeof text !== "string" || text.trim().length === 0) {
      return Promise.reject(
        new ValidationError("`text` must be a non-empty string")
      );
    }
    return send({ from: opts.from, text, type: opts.type, raw: opts.raw });
  }

  return { send, sendText };
}
