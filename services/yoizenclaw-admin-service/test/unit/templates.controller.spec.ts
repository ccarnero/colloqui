import "../setup-env";
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { TemplatesController } from "../../src/modules/templates/templates.controller";
import { TemplatesService } from "../../src/modules/templates/templates.service";

describe("TemplatesController", () => {
  let controller: TemplatesController;
  const loadTemplates = mock(() =>
    Promise.resolve([
      {
        id: "t1",
        name: "T",
        label: "L",
        description: "",
        system_prompt: "",
        rules: "",
        soul: "",
        subagents: [],
      },
    ]),
  );

  beforeEach(async () => {
    loadTemplates.mockClear();
    const moduleRef = await Test.createTestingModule({
      controllers: [TemplatesController],
      providers: [
        { provide: TemplatesService, useValue: { loadTemplates } },
      ],
    }).compile();
    controller = moduleRef.get(TemplatesController);
  });

  it("listTemplates returns templates from service", async () => {
    const out = await controller.listTemplates();
    expect(loadTemplates).toHaveBeenCalled();
    expect(out.templates).toHaveLength(1);
    expect(out.templates[0]?.id).toBe("t1");
  });
});
