import { describe, expect, test } from "bun:test";
import {
  connectorAuthSchema,
  connectorRefSchema,
  integrationManifestSchema,
  kbSourceSchema,
  nameSchema,
  SYMBOLIC_REF_KEYS,
  serviceRouteMethodSchema,
} from "../manifest.schema";
import { buildValidManifest } from "./fixtures";

describe("connectorRefSchema — SYMBOLIC_REF_KEYS (T03, gap 3)", () => {
  test("SYMBOLIC_REF_KEYS includes connectorRef alongside the original four", () => {
    const sorted: string[] = [...SYMBOLIC_REF_KEYS].sort();
    expect(sorted).toEqual(
      [
        "agentRef",
        "channelRef",
        "connectorRef",
        "secretRef",
        "serviceRef",
      ].sort()
    );
  });

  test("connectorRefSchema accepts a slug-like name", () => {
    expect(connectorRefSchema.safeParse("http-adapter").success).toBe(true);
  });

  test("connectorRefSchema rejects an empty string", () => {
    expect(connectorRefSchema.safeParse("").success).toBe(false);
  });
});

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

describe("hosted service — scaling fields (T05, gap 5)", () => {
  test("accepts a service with no scaling fields declared (server defaults win)", () => {
    const manifest = buildValidManifest();
    const result = integrationManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });

  test("accepts a service declaring all scaling fields", () => {
    const manifest = buildValidManifest();
    const valid = {
      ...manifest,
      spec: {
        ...manifest.spec,
        services: [
          {
            ...manifest.spec.services[0],
            port: 8080,
            minScale: 1,
            maxScale: 5,
            concurrencyTarget: 50,
          },
        ],
      },
    };
    const result = integrationManifestSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test("rejects a non-integer port", () => {
    const manifest = buildValidManifest();
    const invalid = {
      ...manifest,
      spec: {
        ...manifest.spec,
        services: [{ ...manifest.spec.services[0], port: 8080.5 }],
      },
    };
    expect(integrationManifestSchema.safeParse(invalid).success).toBe(false);
  });

  test("rejects a negative maxScale", () => {
    const manifest = buildValidManifest();
    const invalid = {
      ...manifest,
      spec: {
        ...manifest.spec,
        services: [{ ...manifest.spec.services[0], maxScale: -1 }],
      },
    };
    expect(integrationManifestSchema.safeParse(invalid).success).toBe(false);
  });

  test("accepts minScale: 0 (scale-to-zero is a valid Knative setting)", () => {
    const manifest = buildValidManifest();
    const valid = {
      ...manifest,
      spec: {
        ...manifest.spec,
        services: [{ ...manifest.spec.services[0], minScale: 0 }],
      },
    };
    expect(integrationManifestSchema.safeParse(valid).success).toBe(true);
  });
});

describe("hosted service — routes (T05, gap 5)", () => {
  test("accepts a service with no routes declared", () => {
    const manifest = buildValidManifest();
    const result = integrationManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });

  test("accepts a service declaring a route with only pathPrefix", () => {
    const manifest = buildValidManifest();
    const valid = {
      ...manifest,
      spec: {
        ...manifest.spec,
        services: [
          {
            ...manifest.spec.services[0],
            routes: [{ pathPrefix: "/priority-scorer" }],
          },
        ],
      },
    };
    expect(integrationManifestSchema.safeParse(valid).success).toBe(true);
  });

  test("accepts a route declaring every optional field", () => {
    const manifest = buildValidManifest();
    const valid = {
      ...manifest,
      spec: {
        ...manifest.spec,
        services: [
          {
            ...manifest.spec.services[0],
            routes: [
              {
                pathPrefix: "/priority-scorer",
                methods: ["GET", "POST"],
                isPublic: true,
                stripPrefix: false,
              },
            ],
          },
        ],
      },
    };
    expect(integrationManifestSchema.safeParse(valid).success).toBe(true);
  });

  test("rejects a pathPrefix not starting with '/'", () => {
    const manifest = buildValidManifest();
    const invalid = {
      ...manifest,
      spec: {
        ...manifest.spec,
        services: [
          {
            ...manifest.spec.services[0],
            routes: [{ pathPrefix: "priority-scorer" }],
          },
        ],
      },
    };
    expect(integrationManifestSchema.safeParse(invalid).success).toBe(false);
  });

  test("rejects an empty pathPrefix", () => {
    const manifest = buildValidManifest();
    const invalid = {
      ...manifest,
      spec: {
        ...manifest.spec,
        services: [
          { ...manifest.spec.services[0], routes: [{ pathPrefix: "" }] },
        ],
      },
    };
    expect(integrationManifestSchema.safeParse(invalid).success).toBe(false);
  });

  test("rejects an unrecognized HTTP method", () => {
    const manifest = buildValidManifest();
    const invalid = {
      ...manifest,
      spec: {
        ...manifest.spec,
        services: [
          {
            ...manifest.spec.services[0],
            routes: [{ pathPrefix: "/x", methods: ["TRACE"] }],
          },
        ],
      },
    };
    expect(integrationManifestSchema.safeParse(invalid).success).toBe(false);
  });

  test("rejects an unknown key on a route entry (.strict())", () => {
    const manifest = buildValidManifest();
    const invalid = {
      ...manifest,
      spec: {
        ...manifest.spec,
        services: [
          {
            ...manifest.spec.services[0],
            routes: [{ pathPrefix: "/x", unexpectedField: true }],
          },
        ],
      },
    };
    expect(integrationManifestSchema.safeParse(invalid).success).toBe(false);
  });

  test("serviceRouteMethodSchema accepts every RouteMethod value", () => {
    for (const method of [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
      "OPTIONS",
    ]) {
      expect(serviceRouteMethodSchema.safeParse(method).success).toBe(true);
    }
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

// T02 (manual-loops/provisioning-manifest-gaps.md, gap 2): connector
// `endpoints` — mirrors the SDK's `CreateConnectorEndpointInput`
// (`label`/`method`/`path`/optional `cache`). Additive-only: optional field,
// `.strict()` per every other manifest section.
describe("connectorSchema — endpoints (T02)", () => {
  function manifestWithConnector(connector: Record<string, unknown>) {
    const manifest = buildValidManifest();
    return {
      ...manifest,
      spec: {
        ...manifest.spec,
        connectors: [connector],
      },
    };
  }

  test("accepts a connector with no endpoints declared (additive — omission stays valid)", () => {
    const manifest = manifestWithConnector({
      name: "hubspot",
      type: "http",
      config: { baseUrl: "https://hubspot.example.com" },
    });
    expect(integrationManifestSchema.safeParse(manifest).success).toBe(true);
  });

  test("accepts a connector with a valid endpoints array", () => {
    const manifest = manifestWithConnector({
      name: "hubspot",
      type: "http",
      config: { baseUrl: "https://hubspot.example.com" },
      endpoints: [
        { label: "list-contacts", method: "GET", path: "/contacts" },
        {
          label: "create-contact",
          method: "POST",
          path: "/contacts",
          cache: { enabled: true, ttlSeconds: 60 },
        },
      ],
    });
    const result = integrationManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });

  test("accepts an endpoint cache block with methods/keyHeaders/keyQueryParams/keyBody", () => {
    const manifest = manifestWithConnector({
      name: "hubspot",
      type: "http",
      config: { baseUrl: "https://hubspot.example.com" },
      endpoints: [
        {
          label: "list-contacts",
          method: "GET",
          path: "/contacts",
          cache: {
            enabled: true,
            ttlSeconds: 60,
            methods: ["GET"],
            keyHeaders: ["Authorization"],
            keyQueryParams: "all",
            keyBody: false,
          },
        },
      ],
    });
    expect(integrationManifestSchema.safeParse(manifest).success).toBe(true);
  });

  test("rejects an endpoint missing a required field (path)", () => {
    const manifest = manifestWithConnector({
      name: "hubspot",
      type: "http",
      config: { baseUrl: "https://hubspot.example.com" },
      endpoints: [{ label: "list-contacts", method: "GET" }],
    });
    expect(integrationManifestSchema.safeParse(manifest).success).toBe(false);
  });

  test("rejects an endpoint with an invalid HTTP method", () => {
    const manifest = manifestWithConnector({
      name: "hubspot",
      type: "http",
      config: { baseUrl: "https://hubspot.example.com" },
      endpoints: [
        { label: "list-contacts", method: "FETCH", path: "/contacts" },
      ],
    });
    expect(integrationManifestSchema.safeParse(manifest).success).toBe(false);
  });

  test("rejects an endpoint with an unknown key (.strict())", () => {
    const manifest = manifestWithConnector({
      name: "hubspot",
      type: "http",
      config: { baseUrl: "https://hubspot.example.com" },
      endpoints: [
        {
          label: "list-contacts",
          method: "GET",
          path: "/contacts",
          unknownField: "nope",
        },
      ],
    });
    expect(integrationManifestSchema.safeParse(manifest).success).toBe(false);
  });

  test("rejects an endpoint cache block with an unknown key (.strict())", () => {
    const manifest = manifestWithConnector({
      name: "hubspot",
      type: "http",
      config: { baseUrl: "https://hubspot.example.com" },
      endpoints: [
        {
          label: "list-contacts",
          method: "GET",
          path: "/contacts",
          cache: { enabled: true, ttlSeconds: 60, unknownCacheField: true },
        },
      ],
    });
    expect(integrationManifestSchema.safeParse(manifest).success).toBe(false);
  });
});

// T04 (manual-loops/provisioning-manifest-gaps.md, gap 4): `systemVariables`
// — mirrors `sdk/src/resources/system-variables/types.ts`
// `CreateSystemVariableInput` (`name`/`type`/`value`/`label?`/`description?`)
// plus the existing section shape's `external` flag. Additive-only:
// optional array defaulting to `[]`, `.strict()` per every other section.
describe("manifestSpecSchema — systemVariables (T04, gap 4)", () => {
  function manifestWithSystemVariable(systemVariable: Record<string, unknown>) {
    const manifest = buildValidManifest();
    return {
      ...manifest,
      spec: {
        ...manifest.spec,
        systemVariables: [systemVariable],
      },
    };
  }

  test("omission stays valid — additive, defaults to []", () => {
    const manifest = buildValidManifest();
    const { systemVariables: _omit, ...specWithoutSystemVariables } =
      manifest.spec;
    const withoutSystemVariables = {
      ...manifest,
      spec: specWithoutSystemVariables,
    };
    const result = integrationManifestSchema.safeParse(withoutSystemVariables);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.spec.systemVariables).toEqual([]);
    }
  });

  test("accepts a minimal systemVariable (name/type/value only)", () => {
    const manifest = manifestWithSystemVariable({
      name: "escalation-threshold",
      type: "number",
      value: 5,
    });
    expect(integrationManifestSchema.safeParse(manifest).success).toBe(true);
  });

  test("accepts a systemVariable with label/description/external", () => {
    const manifest = manifestWithSystemVariable({
      name: "feature-flag",
      type: "boolean",
      value: true,
      label: "Feature flag",
      description: "Enables the new escalation path",
      external: true,
    });
    expect(integrationManifestSchema.safeParse(manifest).success).toBe(true);
  });

  test("accepts every manifest-allowed VariableType literal (secret excluded)", () => {
    const types = ["string", "number", "boolean", "json", "array"];
    for (const type of types) {
      const manifest = manifestWithSystemVariable({
        name: "var-of-type",
        type,
        value: type === "json" || type === "array" ? [] : "x",
      });
      expect(integrationManifestSchema.safeParse(manifest).success).toBe(true);
    }
  });

  // Attempt-2 reviewer ruling: `type: "secret"` is a VALID platform
  // `VariableType`, but it is REJECTED at the manifest surface because a
  // secret-typed variable's plaintext `value` would leak into the checked-in
  // manifest AND into plan output (`FieldDiff.current/.desired`), violating
  // the SPEC's "secret VALUES never appear in ... plan output ... or the
  // manifest file itself" hard rule. Rejecting it makes the leak
  // unrepresentable. Lift once the human ruling on secret-sourced sysvars
  // lands (see manual-loops/provisioning-manifest-gaps.md T04 progress).
  test('rejects type: "secret" — a valid platform VariableType, but not manifest-expressible (no plaintext secret values in the repo/plan)', () => {
    const manifest = manifestWithSystemVariable({
      name: "api-key-var",
      type: "secret",
      value: "super-secret-plaintext",
    });
    const result = integrationManifestSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  test("rejects a systemVariable missing name", () => {
    const manifest = manifestWithSystemVariable({
      type: "string",
      value: "x",
    });
    expect(integrationManifestSchema.safeParse(manifest).success).toBe(false);
  });

  test("rejects a systemVariable missing type", () => {
    const manifest = manifestWithSystemVariable({
      name: "no-type",
      value: "x",
    });
    expect(integrationManifestSchema.safeParse(manifest).success).toBe(false);
  });

  test("rejects a systemVariable missing value", () => {
    const manifest = manifestWithSystemVariable({
      name: "no-value",
      type: "string",
    });
    expect(integrationManifestSchema.safeParse(manifest).success).toBe(false);
  });

  test("rejects a systemVariable with an unknown type enum literal", () => {
    const manifest = manifestWithSystemVariable({
      name: "bad-type",
      type: "float",
      value: 1.5,
    });
    expect(integrationManifestSchema.safeParse(manifest).success).toBe(false);
  });

  test("rejects a systemVariable with an unknown key (.strict())", () => {
    const manifest = manifestWithSystemVariable({
      name: "extra-key",
      type: "string",
      value: "x",
      unknownField: "nope",
    });
    expect(integrationManifestSchema.safeParse(manifest).success).toBe(false);
  });
});
