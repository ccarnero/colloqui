import { describe, expect, test } from "bun:test";
import type { ScorerConfig } from "../src/config.js";
import {
  buildTicketIdempotencyKey,
  createTicket,
  type InvokeAsyncCapableClient,
} from "../src/create-ticket.js";

const baseConfig: ScorerConfig = {
  yoizenTenant: "acme",
  yoizenEmail: "yclawd@demo.io",
  yoizenPassword: "admin123",
  yoizenBaseUrl: "http://api-gateway.platform-services-dev.svc.cluster.local",
  hubspotConnectorId: "connector-1",
  hubspotDealsEndpointId: "endpoint-deals",
  hubspotTicketsEndpointId: "endpoint-tickets",
  hubspotCreateTicketEndpointId: "endpoint-create-ticket",
  selfInternalBaseUrl:
    "http://priority-scorer-acme.acme-dev-ns.svc.cluster.local",
  port: 8080,
};

describe("buildTicketIdempotencyKey", () => {
  test("matches the SPEC T05 format exactly", () => {
    expect(
      buildTicketIdempotencyKey({
        tenant: "acme",
        conversationId: "chat-42",
        turn: 3,
      })
    ).toBe("ticket-acme-chat-42-3");
  });
});

describe("createTicket", () => {
  test("invokes create-ticket async with idempotencyKey + webhook pointing at /webhooks/invoke", async () => {
    const calls: unknown[] = [];
    const client: InvokeAsyncCapableClient = {
      connectors: {
        invoke: async (connectorId, endpointId, args, opts) => {
          calls.push({ connectorId, endpointId, args, opts });
          return { invocationId: "inv-async-1" };
        },
      },
    };

    const result = await createTicket(client, baseConfig, {
      tenant: "acme",
      conversationId: "chat-42",
      turn: 3,
      ticket: { properties: { subject: "Order delay" } },
    });

    expect(result.invocationId).toBe("inv-async-1");
    expect(result.idempotencyKey).toBe("ticket-acme-chat-42-3");
    expect(calls).toHaveLength(1);
    const call = calls[0] as {
      connectorId: string;
      endpointId: string;
      opts: { mode: string; idempotencyKey: string; webhook: { url: string } };
    };
    expect(call.connectorId).toBe("connector-1");
    expect(call.endpointId).toBe("endpoint-create-ticket");
    expect(call.opts.mode).toBe("async");
    expect(call.opts.idempotencyKey).toBe("ticket-acme-chat-42-3");
    expect(call.opts.webhook.url).toBe(
      "http://priority-scorer-acme.acme-dev-ns.svc.cluster.local/webhooks/invoke"
    );
  });
});
