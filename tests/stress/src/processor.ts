import { getAuthContext } from "./auth.js";
import { buildGatewayHeaders, resolveRequestUrl } from "./env.js";
import { getNextPayload, getPayloadKinds } from "./payloads.js";

interface ArtilleryContext {
  vars: Record<string, unknown>;
}

interface ArtilleryResponse {
  body?: string | Buffer;
  statusCode?: number;
}

interface RequestParams {
  body?: unknown;
  headers?: Record<string, string>;
  json?: unknown;
  url?: string;
}

type Callback = (error?: Error) => void;

const uidCounters = new Map<string, number>();

function nextCounter(key: string): number {
  const current = uidCounters.get(key) ?? 0;
  const next = current + 1;
  uidCounters.set(key, next);
  return next;
}

function generateStableId(prefix: string): string {
  const now = Date.now();
  const counter = nextCounter(prefix);
  return `${prefix}-${now}-${counter}`;
}

function ensureHeaders(requestParams: RequestParams): Record<string, string> {
  if (!requestParams.headers) {
    requestParams.headers = {};
  }
  return requestParams.headers;
}

function applyResolvedUrl(requestParams: RequestParams): void {
  const url = requestParams.url;
  if (!url) {
    return;
  }

  requestParams.url = resolveRequestUrl(url);
}

function parseResponseBody<T>(response: ArtilleryResponse): T | null {
  if (!response.body) {
    return null;
  }

  const text =
    typeof response.body === "string"
      ? response.body
      : response.body.toString("utf-8");

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function resolveCallback(maybeCallback: unknown): Callback | null {
  if (typeof maybeCallback === "function") {
    return maybeCallback as Callback;
  }
  return null;
}

function complete(maybeCallback?: unknown, error?: Error): void {
  const callback = resolveCallback(maybeCallback);
  if (callback) {
    callback(error);
    return;
  }

  if (error) {
    throw error;
  }
}

export function setEventRequest(
  context: ArtilleryContext,
  _events: unknown,
  done?: unknown
): void {
  const payload = getNextPayload(getPayloadKinds().EVENTS);
  context.vars.eventPayload = payload;
  context.vars.eventPayloadJson = JSON.stringify(payload);
  complete(done);
}

export function setWebhookRequest(
  context: ArtilleryContext,
  _events: unknown,
  done?: unknown
): void {
  const payload = getNextPayload(getPayloadKinds().WEBHOOK);
  const tenantId = generateStableId("stress-webhook-tenant");
  context.vars.webhookPayload = payload;
  context.vars.webhookPayloadJson = JSON.stringify(payload);
  context.vars.webhookPath = `/api/webhooks/whatsapp/${tenantId}`;
  complete(done);
}

export async function ensureAuthContext(
  context: ArtilleryContext,
  _events: unknown,
  done?: unknown
): Promise<void> {
  try {
    const auth = await getAuthContext();
    context.vars.authToken = auth.token;
    context.vars.tenant = auth.tenant;
    complete(done);
  } catch (error: unknown) {
    complete(
      done,
      error instanceof Error ? error : new Error("Failed to build auth context.")
    );
  }
}

export function setGatewayHeaders(
  requestParams: RequestParams,
  _context: ArtilleryContext,
  _events: unknown,
  done?: unknown
): void {
  applyResolvedUrl(requestParams);
  const headers = ensureHeaders(requestParams);
  const gatewayHeaders = buildGatewayHeaders();
  for (const [key, value] of Object.entries(gatewayHeaders)) {
    headers[key] = value;
  }
  complete(done);
}

export async function setGatewayAuthHeaders(
  requestParams: RequestParams,
  context: ArtilleryContext,
  _events: unknown,
  done?: unknown
): Promise<void> {
  try {
    applyResolvedUrl(requestParams);
    const auth = await getAuthContext();
    context.vars.authToken = auth.token;
    context.vars.tenant = auth.tenant;

    const headers = ensureHeaders(requestParams);
    const gatewayHeaders = buildGatewayHeaders({
      Authorization: `Bearer ${auth.token}`,
      "x-yoizen-tenant": auth.tenant,
    });

    for (const [key, value] of Object.entries(gatewayHeaders)) {
      headers[key] = value;
    }

    complete(done);
  } catch (error: unknown) {
    complete(
      done,
      error instanceof Error ? error : new Error("Failed to set auth headers.")
    );
  }
}

export function captureEventId(
  _requestParams: RequestParams,
  response: ArtilleryResponse,
  context: ArtilleryContext,
  _events: unknown,
  done?: unknown
): void {
  const body = parseResponseBody<{ id?: string }>(response);
  if (body?.id) {
    context.vars.eventId = body.id;
  }
  complete(done);
}

export function setResultPathFromEvent(
  context: ArtilleryContext,
  _events: unknown,
  done?: unknown
): void {
  const eventId = context.vars.eventId;
  if (typeof eventId !== "string" || eventId.length === 0) {
    complete(done, new Error("Missing eventId for roundtrip scenario."));
    return;
  }

  context.vars.resultPath = `/api/results/${eventId}`;
  complete(done);
}

export function captureResultStatus(
  _requestParams: RequestParams,
  response: ArtilleryResponse,
  context: ArtilleryContext,
  _events: unknown,
  done?: unknown
): void {
  const statusCode = response.statusCode ?? 0;
  context.vars.resultReady = statusCode === 200;
  complete(done);
}
