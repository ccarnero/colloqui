import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { AutoReplyController } from "../../src/modules/auto-reply/auto-reply.controller";
import { AutoReplyService } from "../../src/modules/auto-reply/auto-reply.service";

describe("AutoReplyController", () => {
  let controller: AutoReplyController;
  const createRule = mock(() =>
    Promise.resolve({ id: "r1" } as Record<string, unknown>),
  );
  const listRules = mock(() => Promise.resolve([]));
  const deleteRule = mock(() => Promise.resolve(true));

  beforeEach(async () => {
    createRule.mockClear();
    listRules.mockClear();
    deleteRule.mockClear();

    const moduleRef = await Test.createTestingModule({
      controllers: [AutoReplyController],
      providers: [
        {
          provide: AutoReplyService,
          useValue: { createRule, listRules, deleteRule },
        },
      ],
    }).compile();

    controller = moduleRef.get(AutoReplyController);
  });

  it("createRule delegates to service", async () => {
    await controller.createRule("tenant-abc", {
      accountId: "a1",
      channel: "whatsapp",
      triggerPattern: "hi",
      replyText: "hello",
    } as never);
    expect(createRule).toHaveBeenCalledWith({
      tenantId: "tenant-abc",
      accountId: "a1",
      channel: "whatsapp",
      triggerPattern: "hi",
      replyText: "hello",
    });
  });

  it("listRules delegates with accountId", async () => {
    await controller.listRules("tenant-abc", {
      accountId: "a1",
    } as never);
    expect(listRules).toHaveBeenCalledWith("tenant-abc", "a1");
  });

  it("deleteRule throws NotFound when rule missing", async () => {
    deleteRule.mockResolvedValueOnce(false);
    await expect(
      controller.deleteRule("tenant-abc", "missing"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
