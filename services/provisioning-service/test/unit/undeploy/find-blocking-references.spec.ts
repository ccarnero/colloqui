import "../../setup-env";
import { describe, expect, it } from "bun:test";
import type { IntegrationManifest } from "@yoizen/shared";
import { findBlockingReferences } from "../../../src/modules/undeploy/lib/find-blocking-references";

function manifest(
  name: string,
  spec: Partial<IntegrationManifest["spec"]> = {}
): IntegrationManifest {
  return {
    apiVersion: "yoizen.io/v1",
    kind: "IntegrationManifest",
    metadata: { name },
    spec: {
      channels: [],
      connectors: [],
      agents: [],
      knowledgeBases: [],
      services: [],
      systemVariables: [],
      mcpServers: [],
      skills: [],
      workflows: [],
      secrets: [],
      ...spec,
    },
  };
}

const owner = (): IntegrationManifest =>
  manifest("crm-library", {
    connectors: [{ name: "hubspot", type: "http" }],
    mcpServers: [
      {
        name: "search-mcp",
        url: "http://mcp.dev.local",
        transport_type: "sse",
      },
    ],
    knowledgeBases: [
      {
        name: "support-kb",
        documents: [{ name: "faq", source: { type: "inline", content: "x" } }],
      },
    ],
  });

describe("findBlockingReferences", () => {
  it("returns no blockers when no other manifest references the owned resources", () => {
    const others = [
      manifest("unrelated", {
        connectors: [{ name: "zendesk", type: "http" }],
      }),
    ];
    expect(findBlockingReferences(owner(), others)).toEqual([]);
  });

  it("blocks when ANOTHER manifest declares an owned resource as external: true", () => {
    const others = [
      manifest("crm-support", {
        connectors: [{ name: "hubspot", type: "http", external: true }],
      }),
    ];

    expect(findBlockingReferences(owner(), others)).toEqual([
      {
        manifestName: "crm-support",
        resourceKind: "connector",
        resourceName: "hubspot",
      },
    ]);
  });

  it("blocks on an externally-referenced knowledge base too", () => {
    const others = [
      manifest("crm-support", {
        knowledgeBases: [
          {
            name: "support-kb",
            documents: [
              { name: "faq", source: { type: "inline", content: "x" } },
            ],
            external: true,
          },
        ],
      }),
    ];

    expect(findBlockingReferences(owner(), others)).toEqual([
      {
        manifestName: "crm-support",
        resourceKind: "knowledgeBase",
        resourceName: "support-kb",
      },
    ]);
  });

  it("does NOT block on another manifest's OWN (non-external) same-named resource", () => {
    const others = [
      manifest("crm-support", {
        connectors: [{ name: "hubspot", type: "http" }],
      }),
    ];
    expect(findBlockingReferences(owner(), others)).toEqual([]);
  });

  it("does NOT block on a resource this manifest itself marks external (never owned)", () => {
    const target = manifest("crm-library", {
      connectors: [{ name: "hubspot", type: "http", external: true }],
    });
    const others = [
      manifest("crm-support", {
        connectors: [{ name: "hubspot", type: "http", external: true }],
      }),
    ];
    expect(findBlockingReferences(target, others)).toEqual([]);
  });

  it("ignores a stored copy of the manifest being undeployed", () => {
    const others = [
      manifest("crm-library", {
        connectors: [{ name: "hubspot", type: "http", external: true }],
      }),
    ];
    expect(findBlockingReferences(owner(), others)).toEqual([]);
  });

  it("lists EVERY blocking manifest+resource pair, not just the first", () => {
    const others = [
      manifest("crm-support", {
        connectors: [{ name: "hubspot", type: "http", external: true }],
        mcpServers: [
          {
            name: "search-mcp",
            url: "http://mcp.dev.local",
            transport_type: "sse",
            external: true,
          },
        ],
      }),
      manifest("crm-sales", {
        connectors: [{ name: "hubspot", type: "http", external: true }],
      }),
    ];

    expect(findBlockingReferences(owner(), others)).toEqual([
      {
        manifestName: "crm-support",
        resourceKind: "connector",
        resourceName: "hubspot",
      },
      {
        manifestName: "crm-support",
        resourceKind: "mcpServer",
        resourceName: "search-mcp",
      },
      {
        manifestName: "crm-sales",
        resourceKind: "connector",
        resourceName: "hubspot",
      },
    ]);
  });
});
