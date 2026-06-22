/**
 * Port interfaces (hexagonal). Documentation only — plain JS has no interfaces, so the
 * application layer depends on these shapes and infrastructure adapters implement them.
 *
 * @typedef {import("../domain/token.js").Token} Token
 *
 * @typedef {Object} AuthPort
 * @property {(creds: { email: string, password: string, tenant?: string }) => Promise<Token>} login
 * @property {(refreshToken: string) => Promise<Token>} refresh
 *
 * @typedef {Object} ChannelDirectoryPort
 * @property {(args: { token: string, tenant: string, selector?: { name?: string, externalId?: string } }) => Promise<{ appSecret: string, accountId: string, externalId?: string }>} resolveHttpSecret
 *
 * @typedef {Object} IngestPort
 * @property {(args: { tenant: string, appSecret: string, body: Record<string, unknown>, instance?: string|null }) => Promise<{ status: string, accountId?: string, messageId?: string }>} ingest
 *
 * @typedef {Object} Clock
 * @property {() => number} now epoch ms
 */

export {};
