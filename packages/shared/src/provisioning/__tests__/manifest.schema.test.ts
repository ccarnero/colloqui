import { describe, expect, test } from "bun:test";
import {
  connectorAuthSchema,
  integrationManifestSchema,
  kbSourceSchema,
  nameSchema,
} from "../manifest.schema";
import { buildValidManifest } from "./fixtures";

describe("nameSchema", () => {
  test("accepts a lowercase slug", () => {
    expect(nameSchema.safeParse("support-telegram").success).toBe(true);
  });

  test("rejects an empty string", () => {
    expect(nameSchema.safeParse("").success).toBe(false);
  });

  test("rejects uppercase characters", () => {
    expect(nameSchema.safeParse("Support-Telegram").success).toBe(false);
  });

  test("rejects a leading hyphen", () => {
    expect(nameSchema.safeParse("-support").success).toBe(false);
  });

  test("rejects underscores", () => {
    expect(nameSchema.safeParse("support_telegram").success).toBe(false);
  });
});

describe("integrationManifestSchema — valid manifest", () => {
  test("parses the approved shape end to end", () => {
    const result = integrationManifestSchema.safeParse(buildValidManifest());
    expect(result.success).toBe(true);
  });
});

describe("integrationManifestSchema — unknown-key rejection (.strict())", () => {
  test("rejects an unknown key at the root", () => {
    const manifest = { ...buildValidManifest(), unexpectedRoot: "nope" };
    const result = integrationManifestSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  test("rejects an unknown key inside spec", () => {
    const manifest = buildValidManifest();
    const withUnknownSpecKey = {
      ...manifest,
      spec: { ...manifest.spec, unexpectedSpecKey: true },
    };
    const result = integrationManifestSchema.safeParse(withUnknownSpecKey);
    expect(result.success).toBe(false);
  });

  test("rejects an unknown key on a channel entry", () => {
    const manifest = buildValidManifest();
    const withUnknownChannelKey = {
      ...manifest,
      spec: {
        ...manifest.spec,
        channels: [{ ...manifest.spec.channels[0], unexpectedField: 1 }],
      },
    };
    const result = integrationManifestSchema.safeParse(withUnknownChannelKey);
    expect(result.success).toBe(false);
  });

  test("rejects an unknown key on a secret scope", () => {
    const manifest = buildValidManifest();
    const withUnknownScopeKey = {
      ...manifest,
      spec: {
        ...manifest.spec,
        secrets: [
          {
            ...manifest.spec.secrets[0],
            scope: { ...manifest.spec.secrets[0].scope, extra: "x" },
          },
        ],
      },
    };
    const result = integrationManifestSchema.safeParse(withUnknownScopeKey);
    expect(result.success).toBe(false);
  });
});

describe("hosted service — exactly one of image|buildRef", () => {
  test("rejects a service declaring neither image nor buildRef", () => {
    const manifest = buildValidManifest();
    const { image, ...serviceWithoutImage } = manifest.spec.services[0];
    const invalid = {
      ...manifest,
      spec: { ...manifest.spec, services: [serviceWithoutImage] },
    };
    const result = integrationManifestSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test("rejects a service declaring both image and buildRef", () => {
    const manifest = buildValidManifest();
    const invalid = {
      ...manifest,
      spec: {
        ...manifest.spec,
        services: [
          {
            ...manifest.spec.services[0],
            buildRef: "builds/priority-scorer@sha256:abc",
          },
        ],
      },
    };
    const result = integrationManifestSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test("accepts a service declaring only buildRef", () => {
    const manifest = buildValidManifest();
    const { image, ...serviceWithoutImage } = manifest.spec.services[0];
    const valid = {
      ...manifest,
      spec: {
        ...manifest.spec,
        services: [
          {
            ...serviceWithoutImage,
            buildRef: "builds/priority-scorer@sha256:abc",
          },
        ],
      },
    };
    const result = integrationManifestSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });
});

describe("kbSourceSchema — inline | file | url discriminated union", () => {
  test("accepts an inline source", () => {
    expect(
      kbSourceSchema.safeParse({ type: "inline", content: "hello" }).success
    ).toBe(true);
  });

  test("rejects inline content over the size cap", () => {
    const oversized = "a".repeat(64 * 1024 + 1);
    expect(
      kbSourceSchema.safeParse({ type: "inline", content: oversized }).success
    ).toBe(false);
  });

  test("accepts a file source with a valid sha256 digest", () => {
    expect(
      kbSourceSchema.safeParse({
        type: "file",
        path: "docs/handbook.md",
        sha256: "a".repeat(64),
      }).success
    ).toBe(true);
  });

  test("rejects a file source with a malformed sha256 digest", () => {
    expect(
      kbSourceSchema.safeParse({
        type: "file",
        path: "docs/handbook.md",
        sha256: "not-a-digest",
      }).success
    ).toBe(false);
  });

  test("accepts a url source with a valid absolute URL", () => {
    expect(
      kbSourceSchema.safeParse({ type: "url", url: "https://example.com/x" })
        .success
    ).toBe(true);
  });

  test("rejects a url source with a malformed URL", () => {
    expect(
      kbSourceSchema.safeParse({ type: "url", url: "not-a-url" }).success
    ).toBe(false);
  });

  test("rejects an unknown discriminant", () => {
    expect(
      kbSourceSchema.safeParse({ type: "ftp", url: "ftp://example.com" })
        .success
    ).toBe(false);
  });
});

// T01 (manual-loops/provisioning-manifest-gaps.md, gap 1, decision 3 ruling
// 2026-07-16): secretRef-ONLY connector auth with NESTED-FIELD TARGETING —
// there is no literal inline `authConfig` field, so a plaintext credential
// value is impossible by schema.
describe("connectorAuthSchema — secretRef-only, nested-field targeting", () => {
  test("accepts a bearer auth block", () => {
    expect(
      connectorAuthSchema.safeParse({
        authType: "bearer",
        bearerToken: { secretRef: "hubspot-key" },
      }).success
    ).toBe(true);
  });

  test("accepts an api-key auth block with an optional apiKeyHeader", () => {
    expect(
      connectorAuthSchema.safeParse({
        authType: "api-key",
        apiKey: { secretRef: "acme-key" },
        apiKeyHeader: "X-Acme-Key",
      }).success
    ).toBe(true);
  });

  test("accepts a basic auth block with both username and password secretRefs", () => {
    expect(
      connectorAuthSchema.safeParse({
        authType: "basic",
        basicUsername: { secretRef: "crm-user" },
        basicPassword: { secretRef: "crm-pass" },
      }).success
    ).toBe(true);
  });

  test("rejects a literal inline credential value — a plaintext string is impossible by schema", () => {
    expect(
      connectorAuthSchema.safeParse({
        authType: "bearer",
        bearerToken: "plaintext-token-not-a-secretref-object",
      }).success
    ).toBe(false);
  });

  test("rejects authConfig-shaped input (the superseded inline mechanism)", () => {
    expect(
      connectorAuthSchema.safeParse({
        authType: "bearer",
        authConfig: { bearerToken: "plaintext-token" },
      }).success
    ).toBe(false);
  });

  test("rejects a bearer auth block missing bearerToken", () => {
    expect(connectorAuthSchema.safeParse({ authType: "bearer" }).success).toBe(
      false
    );
  });

  test("rejects a basic auth block missing basicPassword", () => {
    expect(
      connectorAuthSchema.safeParse({
        authType: "basic",
        basicUsername: { secretRef: "crm-user" },
      }).success
    ).toBe(false);
  });

  test("rejects an unknown authType", () => {
    expect(
      connectorAuthSchema.safeParse({
        authType: "oauth2",
        bearerToken: { secretRef: "x" },
      }).success
    ).toBe(false);
  });

  test("rejects an unknown key inside bearerToken (.strict())", () => {
    expect(
      connectorAuthSchema.safeParse({
        authType: "bearer",
        bearerToken: { secretRef: "hubspot-key", value: "plaintext" },
      }).success
    ).toBe(false);
  });

  test("integrationManifestSchema rejects a connector with an unknown top-level secretRef (superseded flat mechanism)", () => {
    const manifest = buildValidManifest();
    const invalid = {
      ...manifest,
      spec: {
        ...manifest.spec,
        connectors: [
          {
            name: "hubspot",
            type: "http",
            config: { baseUrl: "https://hubspot.example.com" },
            secretRef: "hubspot-api-key",
          },
        ],
      },
    };
    expect(integrationManifestSchema.safeParse(invalid).success).toBe(false);
  });
});
