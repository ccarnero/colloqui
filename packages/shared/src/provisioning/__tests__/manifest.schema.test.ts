import { describe, expect, test } from "bun:test";
import {
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
