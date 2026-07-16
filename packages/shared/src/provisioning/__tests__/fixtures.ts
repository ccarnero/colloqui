// Shared manifest fixture for provisioning tests. Mirrors the human-approved
// YAML shape from manual-loops/declarative-provisioning.md (T01) verbatim,
// translated to a plain object.

import type { IntegrationManifest } from "../manifest.schema";

export function buildValidManifest(): IntegrationManifest {
  return {
    apiVersion: "yoizen.io/v1",
    kind: "IntegrationManifest",
    metadata: { name: "crm-support" },
    spec: {
      channels: [
        {
          name: "support-telegram",
          type: "telegram",
          direction: "inbound",
          secretRef: "tg-bot-token",
        },
      ],
      connectors: [
        {
          name: "hubspot",
          type: "http",
          config: { baseUrl: "https://hubspot.example.com" },
          auth: {
            authType: "bearer",
            bearerToken: { secretRef: "hubspot-api-key" },
          },
        },
      ],
      agents: [
        {
          name: "support-agent",
          profile: { model: "gpt-4", systemPrompt: "You are helpful." },
          knowledgeBaseRefs: ["support-kb"],
        },
      ],
      knowledgeBases: [
        {
          name: "support-kb",
          documents: [
            {
              name: "faq",
              source: { type: "inline", content: "Q: hi\nA: hello" },
            },
            {
              name: "handbook",
              source: {
                type: "file",
                path: "docs/handbook.md",
                sha256: "a".repeat(64),
              },
            },
            {
              name: "policies",
              source: { type: "url", url: "https://example.com/policies" },
            },
          ],
        },
      ],
      services: [
        {
          name: "priority-scorer",
          image: "registry.example.com/priority-scorer:1.0",
          env: [{ name: "API_KEY", secretRef: "scorer-api-key" }],
        },
      ],
      workflows: [
        {
          name: "ticket-router",
          definition: {
            steps: [
              { type: "channelSend", channelRef: "support-telegram" },
              { type: "agentCall", agentRef: "support-agent" },
              { type: "serviceCall", serviceRef: "priority-scorer" },
            ],
          },
        },
      ],
      secrets: [
        {
          name: "tg-bot-token",
          scope: { kind: "channel", owner: "support-telegram" },
        },
        {
          name: "hubspot-api-key",
          scope: { kind: "connector", owner: "hubspot" },
        },
        {
          name: "scorer-api-key",
          scope: { kind: "service", owner: "priority-scorer" },
          external: true,
        },
      ],
    },
  };
}
