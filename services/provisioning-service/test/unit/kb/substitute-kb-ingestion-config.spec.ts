import { describe, expect, it } from "bun:test";
import { substituteKbIngestionConfig } from "../../../src/modules/kb/lib/substitute-kb-ingestion-config";

// manual-loops/provisioning-manifest-gaps-2.md T03, gap 2.
describe("substituteKbIngestionConfig", () => {
  it("substitutes provider_connector_id (connectorRef) to the resolved real id", () => {
    const result = substituteKbIngestionConfig({
      kbName: "kb-support",
      ingestionConfig: {
        provider_connector_id: { connectorRef: "openai-main" },
        embedding_model: "text-embedding-3-small",
      },
      resolveRef: (refType, name) =>
        refType === "connectorRef" && name === "openai-main"
          ? "connector-real-id-99"
          : undefined,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.provider_connector_id).toBe("connector-real-id-99");
      expect(result.value.embedding_model).toBe("text-embedding-3-small");
    }
  });

  it("never mutates the input ingestionConfig object (working-copy only)", () => {
    const ingestionConfig = {
      provider_connector_id: { connectorRef: "openai-main" },
    };
    const snapshot = JSON.parse(JSON.stringify(ingestionConfig));

    substituteKbIngestionConfig({
      kbName: "kb-support",
      ingestionConfig,
      resolveRef: () => "connector-real-id-99",
    });

    expect(ingestionConfig).toEqual(snapshot);
  });

  it("fails loud (unresolved_symbolic_ref) when the connector has no real id yet", () => {
    const result = substituteKbIngestionConfig({
      kbName: "kb-support",
      ingestionConfig: {
        provider_connector_id: { connectorRef: "openai-main" },
      },
      resolveRef: () => undefined,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unresolved_symbolic_ref");
      expect(result.error.kbName).toBe("kb-support");
      expect(result.error.message).toContain("connectorRef");
      expect(result.error.message).toContain("openai-main");
    }
  });

  it("fails loud (mismatched_symbolic_ref) when provider_connector_id holds the wrong ref kind", () => {
    const result = substituteKbIngestionConfig({
      kbName: "kb-support",
      ingestionConfig: {
        provider_connector_id: { agentRef: "some-agent" },
      },
      resolveRef: () => "should-never-be-used",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("mismatched_symbolic_ref");
      expect(result.error.message).toContain("agentRef");
      expect(result.error.message).toContain("provider_connector_id");
    }
  });

  it("fails loud (unallowlisted_symbolic_ref) for a stray ref-object at a non-allowlisted key inside ingestion_config", () => {
    const result = substituteKbIngestionConfig({
      kbName: "kb-support",
      ingestionConfig: {
        some_unrelated_field: { connectorRef: "openai-main" },
      },
      resolveRef: () => "connector-real-id-99",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unallowlisted_symbolic_ref");
      expect(result.error.message).toContain("some_unrelated_field");
    }
  });

  it("passes plain (non-ref-shaped) ingestion_config values through untouched", () => {
    const result = substituteKbIngestionConfig({
      kbName: "kb-support",
      ingestionConfig: {
        chunk_size: 1000,
        chunking_strategy: "recursive",
      },
      resolveRef: () => "should-never-be-used",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        chunk_size: 1000,
        chunking_strategy: "recursive",
      });
    }
  });
});
