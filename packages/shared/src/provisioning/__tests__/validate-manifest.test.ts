import { describe, expect, test } from "bun:test";
import { validateManifest } from "../validate-manifest";
import { buildValidManifest } from "./fixtures";

describe("validateManifest — success path", () => {
  test("returns ok with the parsed manifest for the approved-shape fixture", () => {
    const result = validateManifest(buildValidManifest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.metadata.name).toBe("crm-support");
      expect(result.value.spec.channels).toHaveLength(1);
    }
  });
});

describe("validateManifest — schema failures surface as a verbose error list", () => {
  test("reports unknown keys with path + message", () => {
    const manifest = { ...buildValidManifest(), notInSchema: true };
    const result = validateManifest(manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
      for (const issue of result.error) {
        expect(typeof issue.path).toBe("string");
        expect(typeof issue.message).toBe("string");
        expect(issue.message.length).toBeGreaterThan(0);
      }
    }
  });

  test("rejects a manifest with the wrong apiVersion", () => {
    const manifest = { ...buildValidManifest(), apiVersion: "yoizen.io/v2" };
    const result = validateManifest(manifest);
    expect(result.ok).toBe(false);
  });
});

describe("validateManifest — structural failures surface as a verbose error list", () => {
  test("reports the >=1-inbound-channel violation", () => {
    const manifest = buildValidManifest();
    manifest.spec.channels[0].direction = "outbound";
    const result = validateManifest(manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.some((e) => e.path === "spec.channels")).toBe(true);
    }
  });

  test("reports an unresolved ref with a path into the workflow definition", () => {
    const manifest = buildValidManifest();
    manifest.spec.workflows[0].definition = {
      steps: [{ channelRef: "ghost-channel" }],
    };
    const result = validateManifest(manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.error.some((e) =>
          e.path.startsWith("spec.workflows[0].definition")
        )
      ).toBe(true);
    }
  });
});
