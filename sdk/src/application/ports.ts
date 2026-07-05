/**
 * Port interfaces (hexagonal). The application layer depends on these shapes and
 * infrastructure adapters implement them.
 */

import type { Token } from "../domain/token.js";

export interface AuthPort {
  login(creds: {
    email: string;
    password: string;
    tenant?: string;
  }): Promise<Token>;
  refresh(refreshToken: string): Promise<Token>;
}

export interface ChannelDirectoryPort {
  resolveHttpSecret(args: {
    token: string;
    tenant: string;
    selector?: { name?: string; externalId?: string };
  }): Promise<{ appSecret: string; accountId: string; externalId?: string }>;
}

export interface IngestPort {
  ingest(args: {
    tenant: string;
    appSecret: string;
    body: Record<string, unknown>;
    instance?: string | null;
  }): Promise<{ status: string; accountId?: string; messageId?: string }>;
}

export interface Clock {
  /** epoch ms */
  now(): number;
}
