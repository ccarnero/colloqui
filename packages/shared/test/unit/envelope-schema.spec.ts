import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { WEBHOOK_FORWARDED_HEADERS } from "../../src/channel.constants";
import type { ChannelEnvelope } from "../../src/channel.interfaces";
import type { EventEnvelope } from "../../src/interfaces";
import type { WebhookIngressEnvelope } from "../../src/webhook.interfaces";

/**
 * Pins `skills/envelope-messages/assets/envelope-schema.json` against the
 * TypeScript interfaces it claims to mirror (envelope-drift T04, finding 4).
 *
 * The schema is documentation, not a validation authority — but it drifted
 * badly enough to be actively misleading: the `channel` enum omitted the
 * implemented `http` channel, `correlation_id` documented a self-correlation
 * default that `buildEventEnvelope` does not do, the stage-1
 * `WebhookIngressEnvelope` was not modelled at all, and `accountid` was
 * required unconditionally — which rejects EVERY real stage-1 envelope.
 *
 * Proof strategy (no JSON-schema validator exists in this repo's toolchain —
 * checked: no ajv anywhere in the workspace, so one is hand-rolled below):
 *
 *   1. The samples are typed as `EventEnvelope` / `ChannelEnvelope` /
 *      `WebhookIngressEnvelope`, so a typecheck proves the FIXTURES match the
 *      interfaces (verified: flipping `channel` to a non-Channel value fails
 *      with TS2322). NOTE: this package's tsconfig only includes `src/**`, and
 *      `bun test` strips types without checking them, so that half of the
 *      proof needs an explicit run:
 *        bunx tsc --noEmit --strict --target es2022 --module preserve \
 *          --moduleResolution bundler --types bun --skipLibCheck \
 *          test/unit/envelope-schema.spec.ts
 *   2. `validate()` implements the JSON-schema subset the asset actually uses
 *      (type/enum/const/required/properties/additionalProperties/$ref/allOf/
 *      oneOf/not) and proves the SCHEMA accepts those same samples.
 *
 * Together: schema ≡ interfaces, checked on both sides. Negative cases below
 * prove the schema still rejects what the types forbid, so this is a pin and
 * not a rubber stamp.
 */

const SCHEMA_PATH = `${import.meta.dir}/../../../../skills/envelope-messages/assets/envelope-schema.json`;

interface ISchema {
  readonly [key: string]: unknown;
}

const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf-8")) as ISchema;

// ---------------------------------------------------------------------------
// Minimal draft-07 subset validator. Returns the list of violations; an empty
// list means "valid". Deliberately small: it only supports the keywords this
// asset uses, and throws on any keyword it does not understand so the schema
// can never silently outgrow the checker.
// ---------------------------------------------------------------------------
const SUPPORTED_KEYWORDS = new Set([
  "$schema",
  "$comment",
  "$ref",
  "title",
  "description",
  "examples",
  "format",
  "definitions",
  "type",
  "enum",
  "const",
  "required",
  "properties",
  "additionalProperties",
  "allOf",
  "oneOf",
  "not",
]);

function resolveRef(ref: string): ISchema {
  if (!ref.startsWith("#/definitions/")) {
    throw new Error(`Unsupported $ref '${ref}' (only #/definitions/* handled)`);
  }
  const name = ref.slice("#/definitions/".length);
  const definitions = schema["definitions"] as Record<string, ISchema>;
  const target = definitions[name];
  if (!target) {
    throw new Error(`Dangling $ref '${ref}'`);
  }
  return target;
}

function typeOf(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function validate(node: ISchema, value: unknown, path = "$"): string[] {
  const errors: string[] = [];

  for (const keyword of Object.keys(node)) {
    if (!SUPPORTED_KEYWORDS.has(keyword)) {
      throw new Error(
        `Schema at ${path} uses unsupported keyword '${keyword}' — extend the test validator`
      );
    }
  }

  if (typeof node["$ref"] === "string") {
    errors.push(...validate(resolveRef(node["$ref"] as string), value, path));
  }

  const type = node["type"];
  if (type !== undefined) {
    const allowed = Array.isArray(type) ? (type as string[]) : [type as string];
    const actual = typeOf(value);
    // JSON-schema "number" also accepts integers; typeof covers both here.
    if (!allowed.includes(actual)) {
      errors.push(`${path}: expected type ${allowed.join("|")}, got ${actual}`);
      return errors;
    }
  }

  if (
    Array.isArray(node["enum"]) &&
    !(node["enum"] as unknown[]).includes(value)
  ) {
    errors.push(`${path}: value ${JSON.stringify(value)} not in enum`);
  }

  if (node["const"] !== undefined && value !== node["const"]) {
    errors.push(
      `${path}: expected const ${JSON.stringify(node["const"])}, got ${JSON.stringify(value)}`
    );
  }

  if (Array.isArray(node["required"]) && typeOf(value) === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of node["required"] as string[]) {
      if (!(key in obj)) {
        errors.push(`${path}: missing required property '${key}'`);
      }
    }
  }

  const properties = node["properties"] as Record<string, ISchema> | undefined;
  if (properties && typeOf(value) === "object") {
    const obj = value as Record<string, unknown>;
    for (const [key, sub] of Object.entries(properties)) {
      if (key in obj) {
        errors.push(...validate(sub, obj[key], `${path}.${key}`));
      }
    }
  }

  const additional = node["additionalProperties"];
  if (additional !== undefined && typeOf(additional) !== "object") {
    // The boolean form (`additionalProperties: false`) would silently no-op
    // here, making this validator quietly weaker than the schema it checks.
    // Fail loudly instead — same contract as the keyword guard above.
    throw new Error(
      `Schema at ${path} uses a non-object additionalProperties (${JSON.stringify(additional)}) — extend the test validator`
    );
  }
  if (additional && typeOf(value) === "object") {
    const obj = value as Record<string, unknown>;
    const declared = new Set(Object.keys(properties ?? {}));
    for (const [key, entry] of Object.entries(obj)) {
      if (!declared.has(key)) {
        errors.push(
          ...validate(additional as ISchema, entry, `${path}.${key}`)
        );
      }
    }
  }

  for (const sub of (node["allOf"] as ISchema[] | undefined) ?? []) {
    errors.push(...validate(sub, value, path));
  }

  const oneOf = node["oneOf"] as ISchema[] | undefined;
  if (oneOf) {
    const matches = oneOf.filter(
      (sub) => validate(sub, value, path).length === 0
    );
    if (matches.length !== 1) {
      errors.push(
        `${path}: expected exactly 1 oneOf branch to match, got ${matches.length}`
      );
    }
  }

  const not = node["not"] as ISchema | undefined;
  if (not && validate(not, value, path).length === 0) {
    errors.push(`${path}: value must NOT match the 'not' subschema`);
  }

  return errors;
}

function definition(name: string): ISchema {
  return resolveRef(`#/definitions/${name}`);
}

// ---------------------------------------------------------------------------
// Union mirror. The schema enums are documentation of three TypeScript string
// unions; `bun test` erases types, so the unions are read back out of the
// declaring source and compared literal-for-literal. Multi-line declarations
// (MessageKind) are handled by reading up to the terminating semicolon.
// ---------------------------------------------------------------------------
const CHANNEL_INTERFACES_PATH = `${import.meta.dir}/../../src/channel.interfaces.ts`;
const channelInterfacesLines = readFileSync(
  CHANNEL_INTERFACES_PATH,
  "utf-8"
).split("\n");

/** 1-based line of `export type <name> =` in channel.interfaces.ts. */
function unionDeclarationLine(name: string): number {
  const index = channelInterfacesLines.findIndex((line) =>
    line.startsWith(`export type ${name} =`)
  );
  expect(index).toBeGreaterThanOrEqual(0);
  return index + 1;
}

/** String-literal members of that union, in declaration order. */
function unionMembers(name: string): string[] {
  const start = unionDeclarationLine(name) - 1;
  const rest = channelInterfacesLines.slice(start);
  const end = rest.findIndex((line) => line.includes(";"));
  expect(end).toBeGreaterThanOrEqual(0);
  const declaration = rest.slice(0, end + 1).join("\n");
  const members = declaration.match(/"([^"]+)"/g) ?? [];
  expect(members.length).toBeGreaterThan(0);
  return members.map((member) => member.slice(1, -1));
}

// ---------------------------------------------------------------------------
// Fixtures. Shapes copied from the real producers:
//   stage 1 — services/api-gateway/src/modules/channels/webhook-ingress-publisher.service.ts:113-146
//   stage 2 — services/channel-service/src/domain/envelope.factory.ts:80-120
// ---------------------------------------------------------------------------
const STAGE_1_SAMPLE: WebhookIngressEnvelope = {
  specversion: "1.0",
  id: "a3c8f1d2-4b5e-7f9a-b2c3-d4e5f6a7b8c9",
  source: "api-gateway/webhooks",
  // envelope-drift T05: per-channel stage-1 type (webhook-ingress-type.ts).
  type: "io.yoizen.messaging.telegram.webhook.webhook_received.v1",
  resource: "tenant/acme/channel/telegram/provider/webhook",
  time: "2026-07-31T15:40:11.382Z",
  traceid: "4bf92f3577b34da6a3ce929d0e0e4736",
  causation_id: null,
  correlation_id: "a3c8f1d2-4b5e-7f9a-b2c3-d4e5f6a7b8c9",
  tenant: "acme",
  producer: "api-gateway",
  domain: "messaging",
  channel: "telegram",
  provider: "webhook",
  kind: "webhook_received",
  idempotencykey: "sha256:a1b2c3d4",
  transport: { method: "webhook", protocol: "https", depth: 0 },
  data: {
    received_at: "2026-07-31T15:40:11.382Z",
    payload_inline: true,
    payload_ref: null,
    payload_bytes: 480,
    payload_checksum: "sha256:a1b2c3d4",
    payload: { update_id: 421, message: { text: "hola" } },
    raw_body_b64: "eyJ1cGRhdGVfaWQiOjQyMX0=",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": "tok_abc123",
    },
  },
};

/** Same stage-1 shape on the `http` channel, which the old enum omitted. */
const STAGE_1_HTTP_SAMPLE: WebhookIngressEnvelope = {
  ...STAGE_1_SAMPLE,
  id: "b4d9e2c3-5c6f-8a0b-c3d4-e5f6a7b8c9d0",
  channel: "http",
  type: "io.yoizen.messaging.http.webhook.webhook_received.v1",
  resource: "tenant/acme/channel/http/provider/webhook",
  data: {
    ...STAGE_1_SAMPLE.data,
    headers: {
      "content-type": "application/json",
      "x-http-channel-token": "tok_abc123",
    },
  },
};

const STAGE_2_SAMPLE: ChannelEnvelope = {
  specversion: "1.0",
  id: "c5e0f3d4-6d7a-9b1c-d4e5-f6a7b8c9d0e1",
  source: "channel-service/accounts/69bea8cd868e860918359cc7",
  type: "io.yoizen.messaging.telegram.telegram.received.v1",
  resource:
    "tenant/acme/account/69bea8cd868e860918359cc7/channel/telegram/provider/telegram",
  time: "2026-07-31T15:40:12.001Z",
  traceid: "4bf92f3577b34da6a3ce929d0e0e4736",
  causation_id: "a3c8f1d2-4b5e-7f9a-b2c3-d4e5f6a7b8c9",
  correlation_id: "a3c8f1d2-4b5e-7f9a-b2c3-d4e5f6a7b8c9",
  tenant: "acme",
  producer: "channel-service",
  domain: "messaging",
  channel: "telegram",
  provider: "telegram",
  accountid: "69bea8cd868e860918359cc7",
  idempotencykey: "sha256:e5f6a7b8",
  transport: { method: "webhook", protocol: "https", depth: 1 },
  data: {
    received_at: "2026-07-31T15:40:12.001Z",
    payload_inline: true,
    payload_ref: null,
    payload_bytes: 512,
    payload_checksum: "sha256:e5f6a7b8",
    payload: { messageId: "tg:421", from: "5491100000000" },
  },
  kind: "received",
};

/** Claim-check variant: payload lifted out, ref + inline flag flipped. */
const STAGE_2_CLAIM_CHECK_SAMPLE: EventEnvelope = {
  ...STAGE_2_SAMPLE,
  data: {
    ...STAGE_2_SAMPLE.data,
    payload_inline: false,
    payload: null,
    payload_ref:
      "nats://objstore/PAYLOAD-acme/c5e0f3d4-6d7a-9b1c-d4e5-f6a7b8c9d0e1-payload",
  },
};

describe("envelope-schema.json (skills/envelope-messages asset)", () => {
  it("is valid JSON and keeps the 'not a validation authority' disclaimer", () => {
    expect(typeof schema["$comment"]).toBe("string");
    expect(schema["$comment"] as string).toContain(
      "Do not use as validation authority"
    );
    expect(schema["$schema"]).toBe("http://json-schema.org/draft-07/schema#");
  });

  // ── (a) channel enum ────────────────────────────────────────────────────
  it("mirrors the Channel / ChannelProvider / MessageKind unions exactly", () => {
    // Two-sided pin (register 05 T03, Meta decommission doc sweep). The list
    // is asserted BOTH against the literal expectation — so shrinking a union
    // stays a deliberate edit of this file — AND against the union parsed out
    // of channel.interfaces.ts, so the asset can never silently fall behind
    // the type again (which is exactly what T02 left behind as KNOWN DRIFT).
    expect(definition("Channel")["enum"]).toEqual([
      "telegram",
      "http",
      "e2e-tests",
    ]);
    expect(definition("ChannelProvider")["enum"]).toEqual([
      "telegram",
      "http",
      "e2e-tests",
    ]);
    expect(definition("MessageKind")["enum"]).toEqual([
      "received",
      "sent",
      "delivered",
      "read",
      "failed",
      "send",
    ]);

    for (const name of ["Channel", "ChannelProvider", "MessageKind"] as const) {
      expect(definition(name)["enum"]).toEqual(unionMembers(name));
      // …and the `$comment` cites the line the union really lives on.
      expect(definition(name)["$comment"] as string).toContain(
        `channel.interfaces.ts:${unionDeclarationLine(name)}`
      );
    }

    // The decommissioned tokens are gone from every enum, not merely reordered.
    const everyEnumMember = (["Channel", "ChannelProvider"] as const).flatMap(
      (name) => definition(name)["enum"] as string[]
    );
    for (const dead of ["whatsapp", "instagram", "meta"]) {
      expect(everyEnumMember).not.toContain(dead);
    }
  });

  // ── (b) correlation_id description ──────────────────────────────────────
  it("documents the real buildEventEnvelope correlation_id fallback (randomUUID)", () => {
    const common = definition("EnvelopeCommon")["properties"] as Record<
      string,
      ISchema
    >;
    const description = common["correlation_id"]["description"] as string;

    expect(description).toContain("randomUUID()");
    expect(description).toContain("envelope.utils.ts:332");
    // The removed claim: buildEventEnvelope does NOT default to the envelope id.
    expect(description).not.toMatch(
      /buildEventEnvelope[^.]*defaults to the envelope/i
    );
  });

  // ── (c) stage-1 shape modelled ──────────────────────────────────────────
  it("models WebhookIngressEnvelope with its pinned tokens and data.headers", () => {
    const stage1 = definition("WebhookIngressEnvelope");
    const props = stage1["properties"] as Record<string, ISchema>;

    expect(props["producer"]["const"]).toBe("api-gateway");
    expect(props["domain"]["const"]).toBe("messaging");
    expect(props["provider"]["const"]).toBe("webhook");
    expect(props["kind"]["const"]).toBe("webhook_received");
    expect(props["data"]["$ref"]).toBe("#/definitions/IWebhookIngressData");

    // The `type` format documents stage-1 as it is since 2026-07-31
    // (envelope-drift T05): the per-channel format is obeyed, and the
    // channel-less value is HISTORICAL — pre-migration rows still carry it,
    // so readers accept both. Same framing as envelope-schema.json:53.
    const common = definition("EnvelopeCommon")["properties"] as Record<
      string,
      ISchema
    >;
    expect(common["type"]["description"] as string).toContain(
      "io.yoizen.messaging.<channel>.webhook.webhook_received.v1"
    );
    expect(common["type"]["description"] as string).toContain(
      "webhook-ingress-type.ts"
    );
    // The pre-2026-07-31 value stays documented: those envelopes are still in
    // the tracking store and readers must accept both.
    expect(common["type"]["description"] as string).toContain(
      "io.yoizen.messaging.webhook.received.v1"
    );

    const dataRequired = definition("IWebhookIngressData")[
      "required"
    ] as string[];
    expect(dataRequired).toContain("raw_body_b64");
    expect(dataRequired).toContain("headers");
    // `instance` is optional on IWebhookIngressData (webhook.interfaces.ts:27).
    expect(dataRequired).not.toContain("instance");
  });

  // ── (d) accountid required-ness ─────────────────────────────────────────
  it("requires accountid on EventEnvelope only, never on the stage-1 shape", () => {
    expect(definition("EventEnvelope")["required"] as string[]).toContain(
      "accountid"
    );
    expect(
      definition("WebhookIngressEnvelope")["required"] as string[]
    ).not.toContain("accountid");
  });

  // ── validation proof ────────────────────────────────────────────────────
  it("accepts a real stage-1 WebhookIngressEnvelope sample", () => {
    expect(validate(schema, STAGE_1_SAMPLE)).toEqual([]);
    expect(
      validate(definition("WebhookIngressEnvelope"), STAGE_1_SAMPLE)
    ).toEqual([]);
  });

  it("accepts a stage-1 sample on the http channel", () => {
    expect(validate(schema, STAGE_1_HTTP_SAMPLE)).toEqual([]);
  });

  it("accepts a real stage-2 EventEnvelope/ChannelEnvelope sample", () => {
    expect(validate(schema, STAGE_2_SAMPLE)).toEqual([]);
    expect(validate(definition("EventEnvelope"), STAGE_2_SAMPLE)).toEqual([]);
    expect(validate(definition("ChannelEnvelope"), STAGE_2_SAMPLE)).toEqual([]);
  });

  it("accepts a claim-check stage-2 sample (payload null, ref set)", () => {
    expect(validate(schema, STAGE_2_CLAIM_CHECK_SAMPLE)).toEqual([]);
  });

  it("accepts the stage-2 webhook allowlist at its declared home, data.headers", () => {
    // envelope-drift T06: createChannelEnvelope writes the allowlist to
    // `data.headers` (typed IChannelEventData), the same home stage 1 uses.
    // Since 2026-08-01 the secret subset is stripped before this hop, so the
    // sample carries only non-secret entries (the schema itself cannot
    // express the strip — it allows any string map).
    const withDataHeaders: ChannelEnvelope = {
      ...STAGE_2_SAMPLE,
      data: {
        ...STAGE_2_SAMPLE.data,
        headers: { "content-type": "application/json", "x-request-id": "r1" },
      },
    };
    expect(validate(schema, withDataHeaders)).toEqual([]);
    expect(validate(definition("ChannelEnvelope"), withDataHeaders)).toEqual(
      []
    );
    expect(
      validate(definition("IChannelEventData"), withDataHeaders.data)
    ).toEqual([]);
  });

  it("rejects non-string values inside data.headers", () => {
    const bogus = {
      ...STAGE_2_SAMPLE,
      data: { ...STAGE_2_SAMPLE.data, headers: { "content-type": 42 } },
    };
    expect(
      validate(definition("IChannelEventData"), bogus.data).length
    ).toBeGreaterThan(0);
  });

  it("models transport with exactly its four declared fields", () => {
    // The old schema $comment documented a de-facto `transport.headers` that
    // envelope.factory.ts spread in untyped. T06 removed it, so `headers` must
    // NOT be a declared transport property here either.
    const transportProps = Object.keys(
      definition("EventTransport")["properties"] as Record<string, ISchema>
    );
    expect(transportProps.sort()).toEqual(
      ["agent_id", "depth", "method", "protocol"].sort()
    );
    expect(transportProps).not.toContain("headers");

    const comment = definition("EventTransport")["$comment"] as string;
    expect(comment).toContain("exactly four declared fields");
    expect(comment).toContain("IChannelEventData.headers");
  });

  // ── negative cases: the pin has teeth ───────────────────────────────────
  it("rejects a stage-2 envelope that is missing accountid", () => {
    const { accountid: _dropped, ...withoutAccountId } = STAGE_2_SAMPLE;
    expect(validate(definition("EventEnvelope"), withoutAccountId)).toContain(
      "$: missing required property 'accountid'"
    );
  });

  it("rejects a stage-1 envelope that smuggles in an accountid", () => {
    const smuggled = {
      ...STAGE_1_SAMPLE,
      accountid: "69bea8cd868e860918359cc7",
    };
    expect(
      validate(definition("WebhookIngressEnvelope"), smuggled).length
    ).toBeGreaterThan(0);
  });

  it("rejects a stage-1 envelope missing data.raw_body_b64", () => {
    const { raw_body_b64: _dropped, ...data } = STAGE_1_SAMPLE.data;
    expect(
      validate(definition("WebhookIngressEnvelope"), {
        ...STAGE_1_SAMPLE,
        data,
      })
    ).toContain("$.data: missing required property 'raw_body_b64'");
  });

  it("rejects an unknown channel on the narrowed ChannelEnvelope", () => {
    const bogus = { ...STAGE_2_SAMPLE, channel: "carrier-pigeon" };
    expect(
      validate(definition("ChannelEnvelope"), bogus).length
    ).toBeGreaterThan(0);
    // ...while the same value is fine on the base EventEnvelope, whose
    // `channel` is a free string (interfaces.ts:42).
    expect(validate(definition("EventEnvelope"), bogus)).toEqual([]);
  });

  it("rejects an out-of-union transport.method", () => {
    const bogus = {
      ...STAGE_2_SAMPLE,
      transport: { ...STAGE_2_SAMPLE.transport, method: "carrier-pigeon" },
    };
    expect(validate(definition("EventEnvelope"), bogus).length).toBeGreaterThan(
      0
    );
  });
});
/**
 * SKILL.md doc-lock. The skill and the schema shared the same two wrong claims
 * (envelope-drift T04): the `http` channel was missing from every
 * channel/provider list, and the header allowlist was documented as 6 entries
 * while `WEBHOOK_FORWARDED_HEADERS` has 7 — the extra one being
 * `x-http-channel-token`, the http channel's auth header.
 *
 * These pins are deliberately LANGUAGE-NEUTRAL. SKILL.md is currently a mix of
 * Spanish prose and English (the lines this task touched were written in
 * English per the SPEC; a full translation is a separate follow-up). Asserting
 * Spanish sentences would make the pins break on translation instead of on
 * drift, so everything below keys off code literals, citations and counts.
 */
describe("skills/envelope-messages/SKILL.md claims", () => {
  const skill = readFileSync(
    `${import.meta.dir}/../../../../skills/envelope-messages/SKILL.md`,
    "utf-8"
  );

  /** The fenced block that enumerates the header allowlist (§8). */
  function headerAllowlistBlock(): string[] {
    const blocks = skill.match(/```[a-z]*\n([\s\S]*?)```/g) ?? [];
    const block = blocks.find((b) => b.includes(WEBHOOK_FORWARDED_HEADERS[0]!));
    expect(block).toBeDefined();
    return (block as string)
      .replace(/```[a-z]*\n?/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  it("lists exactly the WEBHOOK_FORWARDED_HEADERS entries, in order", () => {
    expect(headerAllowlistBlock()).toEqual([...WEBHOOK_FORWARDED_HEADERS]);
  });

  it("states a header count that matches the constant", () => {
    // Every line naming the constant and quoting a bare number must quote the
    // real length. Stripped first so they are not mistaken for counts:
    // `file.ts:55-63` citations and `O(1)` complexity notation. The
    // `_SET` companion constant is excluded — it is a different symbol.
    // Word-agnostic: "7 entries", "7 entradas", "7 Einträge" all pass; "6" does not.
    const lines = skill
      .split("\n")
      .filter(
        (line) =>
          line.includes("WEBHOOK_FORWARDED_HEADERS") &&
          !line.includes("WEBHOOK_FORWARDED_HEADERS_SET")
      )
      .map((line) => line.replace(/\.ts:[\d-]+/g, "").replace(/O\(\d+\)/g, ""));

    const quotedCounts = lines.flatMap((line) => line.match(/\b\d+\b/g) ?? []);
    expect(quotedCounts.length).toBeGreaterThan(0);
    for (const count of quotedCounts) {
      expect(Number(count)).toBe(WEBHOOK_FORWARDED_HEADERS.length);
    }
  });

  it("documents the http channel against the declaring type", () => {
    expect(headerAllowlistBlock()).toContain("x-http-channel-token");
    expect(skill).toContain("`http`");
    // Cited at the line `Channel` really lives on, not a frozen number.
    expect(skill).toContain(
      `channel.interfaces.ts:${unionDeclarationLine("Channel")}`
    );
  });

  it("lists exactly the surviving Channel members, and none of the dead ones", () => {
    // The skill's field tables enumerate the union in prose. Whatever the
    // wording, every surviving member has to appear and no decommissioned
    // token may — same removal as the schema enums above.
    for (const member of unionMembers("Channel")) {
      expect(skill).toContain(member);
    }
    // Word-bounded: `metadata:` in the front-matter is not the `meta` provider.
    for (const dead of [/\bwhatsapp\b/i, /\binstagram\b/i, /\bmeta\b/i]) {
      expect(skill).not.toMatch(dead);
    }
  });

  it("cites the real buildEventEnvelope correlation_id fallback", () => {
    expect(skill).toContain("envelope.utils.ts:332");
    // Some line must tie correlation_id to randomUUID() — whatever the prose
    // language, the code facts have to appear together.
    const tied = skill
      .split("\n")
      .some(
        (line) =>
          line.includes("correlation") &&
          line.includes("randomUUID()") &&
          line.includes("envelope.utils.ts:332")
      );
    expect(tied).toBe(true);
  });
});
