import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { EgressController } from "../../src/modules/egress/egress.controller";
import { EgressService } from "../../src/modules/egress/egress.service";

describe("EgressController", () => {
  let controller: EgressController;
  const send = mock(() =>
    Promise.resolve({ messageId: "m1", status: "sent" } as Record<
      string,
      unknown
    >),
  );

  beforeEach(async () => {
    send.mockClear();
    const moduleRef = await Test.createTestingModule({
      controllers: [EgressController],
      providers: [{ provide: EgressService, useValue: { send } }],
    }).compile();
    controller = moduleRef.get(EgressController);
  });

  it("sendMessage delegates to EgressService.send", async () => {
    const dto = {
      to: "+1",
      type: "text",
      text: "hi",
    };
    const result = await controller.sendMessage("acc-1", "tenant-xyz", dto);
    expect(send).toHaveBeenCalledWith("tenant-xyz", "acc-1", {
      to: "+1",
      type: "text",
      text: "hi",
      templateName: undefined,
      templateLanguage: undefined,
      templateComponents: undefined,
      mediaUrl: undefined,
      caption: undefined,
    });
    expect(result.messageId).toBe("m1");
  });
});
