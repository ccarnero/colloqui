/**
 * Phase 1 — webhook-ingress: provider-side webhook entry path.
 *
 *   POST /api/webhooks/telegram/<tenantId>
 *
 * Sends a Telegram-shaped Update payload that mirrors what the real
 * provider would push. Authentication is via the
 * `X-Telegram-Bot-Api-Secret-Token` header — the gateway just hands off
 * the body to JetStream after a constant-time guard.
 */

import { check } from "k6";
import exec from "k6/execution";
import http from "k6/http";
import { Counter, Trend } from "k6/metrics";

import {
  buildGatewayHeaders,
  getRuntimeConfig,
  resolveRequestUrl,
} from "../lib/env.ts";
import { buildPhase1Stages } from "../lib/stages.ts";

const phase1 = buildPhase1Stages();

function buildScenarios(): Record<string, unknown> {
  const scenarios: Record<string, unknown> = {};
  for (const [name, def] of phase1.stages) {
    const startTime =
      phase1.startTimes[name as keyof typeof phase1.startTimes] ?? "0s";
    scenarios[name] = {
      executor: "ramping-arrival-rate",
      exec: "default",
      startRate: 1,
      timeUnit: "1s",
      preAllocatedVUs: def.preAllocatedVUs,
      maxVUs: def.preAllocatedVUs * 2,
      startTime,
      stages: def.stages,
      tags: { stage: name },
    };
  }
  return scenarios;
}

export const options = {
  discardResponseBodies: true,
  scenarios: buildScenarios(),
  thresholds: {
    "http_req_failed{phase:webhook-ingress}": ["rate<0.01"],
    "http_req_duration{phase:webhook-ingress}": ["p(95)<150"],
  },
  summaryTrendStats: ["min", "med", "avg", "p(95)", "p(99)", "max"],
};

const sentCounter = new Counter("phase1_webhook_sent");
const ackTrend = new Trend("phase1_webhook_ack_ms", true);

const SCENARIO_LABEL = "webhook-ingress";

interface IEnvBag {
  readonly [key: string]: string | undefined;
}

interface IWebCryptoLike {
  readonly randomUUID?: () => string;
}

function readEnvBag(): IEnvBag {
  return (
    (globalThis as { __ENV?: Record<string, string | undefined> }).__ENV ?? {}
  );
}

const HEX = "0123456789abcdef";

/**
 * RFC 4122 v4 UUID generated from `Math.random` — used only when the
 * runtime does not expose `crypto.randomUUID()`. O(1) per call, no
 * allocations beyond the resulting 36-char string.
 */
function fallbackUuid(): string {
  let out = "";
  for (let i = 0; i < 36; i += 1) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      out += "-";
    } else if (i === 14) {
      out += "4";
    } else if (i === 19) {
      out += HEX.charAt((Math.random() * 4) | 0 | 8);
    } else {
      out += HEX.charAt((Math.random() * 16) | 0);
    }
  }
  return out;
}

function resolveUuidGenerator(): () => string {
  const candidate = (globalThis as { crypto?: IWebCryptoLike }).crypto;
  if (candidate && typeof candidate.randomUUID === "function") {
    return candidate.randomUUID.bind(candidate);
  }
  return fallbackUuid;
}

const generateUuid = resolveUuidGenerator();

/**
 * Telegram bot secret token. Default mirrors the dev fixture so smoke
 * runs work out of the box; production runs MUST override via
 * `TELEGRAM_WEBHOOK_SECRET` so credentials never live in source.
 */
function readSecretToken(): string {
  return readEnvBag().TELEGRAM_WEBHOOK_SECRET ?? "";
}

const TELEGRAM_SECRET = readSecretToken();

const FROM_USER = Object.freeze({
  id: 987654321,
  is_bot: false,
  first_name: "Tester",
});

const CHAT = Object.freeze({ id: 987654321, type: "private" });

const RANDOM_ID_RANGE = 0xffffffff;

function randomId(): number {
  return Math.floor(Math.random() * RANDOM_ID_RANGE);
}

interface ITelegramUpdate {
  readonly update_id: number;
  readonly message: {
    readonly message_id: number;
    readonly date: number;
    readonly from: typeof FROM_USER;
    readonly chat: typeof CHAT;
    readonly text: string;
  };
}

function buildTelegramUpdate(): ITelegramUpdate {
  const now = new Date();
  return {
    update_id: randomId(),
    message: {
      message_id: randomId(),
      date: Math.floor(now.getTime() / 1000),
      from: FROM_USER,
      chat: CHAT,
      text: `hola desde curl  -- ${now.toISOString()}`,
    },
  };
}

export default function webhookIngress(): void {
  const runtime = getRuntimeConfig();
  const stage = exec.scenario.name ?? "unknown";
  const body = buildTelegramUpdate();
  const path = `/api/webhooks/telegram/${encodeURIComponent(runtime.tenant)}`;
  const url = resolveRequestUrl(path);

  const headers = buildGatewayHeaders({
    "X-Correlation-Id": generateUuid(),
    "X-Telegram-Bot-Api-Secret-Token": TELEGRAM_SECRET,
  });

  const response = http.post(url, JSON.stringify(body), {
    headers,
    tags: { phase: "webhook-ingress", scenario: SCENARIO_LABEL, stage },
    timeout: "30s",
  });

  sentCounter.add(1, { stage });
  ackTrend.add(response.timings.duration, { stage });

  check(response, {
    "ack 2xx": (r) => r.status >= 200 && r.status < 300,
  });
}
