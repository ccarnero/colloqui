import { describe, expect, it } from "bun:test";
import type { IntegrationManifest } from "@yoizen/shared";
import { buildKbPlan } from "../../../src/modules/kb/lib/build-kb-plan";
import { computeSha256 } from "../../../src/modules/kb/lib/compute-sha256";

function manifestWithKb(
  knowledgeBases: IntegrationManifest["spec"]["knowledgeBases"]
): IntegrationManifest {
  return {
    apiVersion: "yoizen.io/v1",
    kind: "IntegrationManifest",
    metadata: { name: "test-manifest" },
    spec: {
      channels: [{ name: "http-in", type: "http", direction: "inbound" }],
      connectors: [],
      agents: [{ name: "agent-1", profile: {} }],
      knowledgeBases,
      services: [],
      workflows: [],
      secrets: [],
    },
  };
}

describe("buildKbPlan", () => {
  it("reports 'create' for a never-applied inline document, with a chunk estimate", () => {
    const manifest = manifestWithKb([
      {
        name: "kb-1",
        documents: [
          { name: "doc-1", source: { type: "inline", content: "hello world" } },
        ],
      },
    ]);

    const plan = buildKbPlan(manifest, () => undefined);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.reembedCount).toBe(1);
    expect(plan[0]?.documents[0]).toMatchObject({
      documentName: "doc-1",
      action: "create",
    });
    expect(plan[0]?.summary).toContain("will re-embed 1 document");
  });

  it("reports 'skip' when the stored checksum matches (idempotent no-op)", () => {
    const content = "unchanged content";
    const manifest = manifestWithKb([
      {
        name: "kb-1",
        documents: [{ name: "doc-1", source: { type: "inline", content } }],
      },
    ]);

    const plan = buildKbPlan(manifest, () => computeSha256(content));
    expect(plan[0]?.reembedCount).toBe(0);
    expect(plan[0]?.documents[0]?.action).toBe("skip");
    expect(plan[0]?.summary).toBe(
      "knowledge base 'kb-1': no documents to re-embed"
    );
  });

  it("reports 'reembed' when the stored checksum differs from the current content", () => {
    const manifest = manifestWithKb([
      {
        name: "kb-1",
        documents: [
          { name: "doc-1", source: { type: "inline", content: "new content" } },
        ],
      },
    ]);

    const plan = buildKbPlan(manifest, () => "stale-checksum-value");
    expect(plan[0]?.documents[0]?.action).toBe("reembed");
    expect(plan[0]?.reembedCount).toBe(1);
  });

  it("uses the manifest-declared sha256 for file sources without requiring the bundle", () => {
    const manifest = manifestWithKb([
      {
        name: "kb-1",
        documents: [
          {
            name: "doc-1",
            source: {
              type: "file",
              path: "docs/a.pdf",
              sha256: "a".repeat(64),
            },
          },
        ],
      },
    ]);

    const plan = buildKbPlan(manifest, () => "a".repeat(64));
    expect(plan[0]?.documents[0]?.action).toBe("skip");
  });

  it("always reports 'pending_fetch' for url sources — checksum unknown without a network fetch", () => {
    const manifest = manifestWithKb([
      {
        name: "kb-1",
        documents: [
          {
            name: "doc-1",
            source: { type: "url", url: "https://example.com/a.md" },
          },
        ],
      },
    ]);

    const plan = buildKbPlan(manifest, () => "irrelevant");
    expect(plan[0]?.documents[0]?.action).toBe("pending_fetch");
    expect(plan[0]?.reembedCount).toBe(1);
  });

  it("reports no reconciliation for an external knowledge base", () => {
    const manifest = manifestWithKb([
      { name: "kb-1", external: true, documents: [] },
    ]);

    const plan = buildKbPlan(manifest, () => undefined);
    expect(plan[0]).toMatchObject({ external: true, reembedCount: 0 });
  });

  it("sums chunk estimates across multiple documents needing re-embedding", () => {
    const manifest = manifestWithKb([
      {
        name: "kb-1",
        documents: [
          {
            name: "doc-1",
            source: { type: "inline", content: "x".repeat(1000) },
          },
          {
            name: "doc-2",
            source: { type: "inline", content: "y".repeat(2500) },
          },
        ],
      },
    ]);

    const plan = buildKbPlan(manifest, () => undefined);
    expect(plan[0]?.reembedCount).toBe(2);
    expect(plan[0]?.chunkEstimateTotal).toBe(1 + 3);
    expect(plan[0]?.summary).toContain("~4 chunks");
  });
});
