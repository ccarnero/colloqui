import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { JetStreamClient, JetStreamManager } from "nats";
import { AutoReplyService } from "../../src/modules/auto-reply/auto-reply.service";
import type { EgressService } from "../../src/modules/egress/egress.service";
import type { AutoReplyRepository } from "../../src/modules/auto-reply/auto-reply.repository";

const jsm = {} as unknown as JetStreamManager;
const js = {} as unknown as JetStreamClient;

describe("AutoReplyService.handleMessage", () => {
  let service: AutoReplyService;
  const send = mock(() => Promise.resolve());
  const egress = { send } as unknown as EgressService;

  const ruleRows = [
    {
      id: "r1",
      tenant_id: "t1",
      account_id: "a1",
      channel: "telegram",
      trigger_pattern: "hello",
      reply_text: "Hi there",
      is_active: true,
    },
  ];

  const repo = {
    loadActiveRules: mock(() => Promise.resolve(ruleRows)),
    insertRule: mock(() => Promise.resolve()),
    listRulesForTenant: mock(() => Promise.resolve([])),
    deleteRule: mock(() => Promise.resolve({ count: 0 })),
  } as unknown as AutoReplyRepository;

  beforeEach(() => {
    send.mockClear();
    service = new AutoReplyService(jsm, js, repo, egress);
  });

  it("sends reply when text matches trigger pattern", async () => {
    await (
      service as unknown as {
        refreshRulesCache: () => Promise<void>;
      }
    ).refreshRulesCache();

    const envelope = {
      tenant: "t1",
      data: {
        text: "hello world",
        from: "user-1",
        accountId: "a1",
      },
    };
    const msg = {
      data: new TextEncoder().encode(JSON.stringify(envelope)),
    };

    await (
      service as unknown as {
        handleMessage: (m: { data: Uint8Array }) => Promise<void>;
      }
    ).handleMessage(msg);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      "t1",
      "a1",
      {
        to: "user-1",
        type: "text",
        text: "Hi there",
      },
      expect.objectContaining({
        incomingDepth: 0,
      }),
    );
  });

  it("does not send when no rule matches", async () => {
    await (
      service as unknown as {
        refreshRulesCache: () => Promise<void>;
      }
    ).refreshRulesCache();

    const envelope = {
      tenantId: "t1",
      data: {
        text: "no match here",
        from: "user-1",
        accountId: "a1",
      },
    };
    const msg = {
      data: new TextEncoder().encode(JSON.stringify(envelope)),
    };

    await (
      service as unknown as {
        handleMessage: (m: { data: Uint8Array }) => Promise<void>;
      }
    ).handleMessage(msg);

    expect(send).not.toHaveBeenCalled();
  });
});
