import type { IClientRow } from "./clients.repository.interface";

/** API response for POST /auth/clients (includes one-time secret). */
export type ICreatedClient = IClientRow & { client_secret: string };
