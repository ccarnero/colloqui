import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "fs/promises";
import { TemplatesService } from "../../src/modules/templates/templates.service";

describe("TemplatesService", () => {
  let readSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    readSpy = spyOn(fs, "readFile");
  });

  afterEach(() => {
    readSpy.mockRestore();
  });

  it("parses templates from YAML content", async () => {
    readSpy.mockResolvedValue(`
templates:
  - id: t1
    label: T1
    name: Template One
    description: Desc
    system_prompt: You are helpful
    rules: ""
    soul: ""
    subagents: []
`);
    const svc = new TemplatesService();
    const list = await svc.loadTemplates();
    expect(list.length).toBe(1);
    expect(list[0]?.id).toBe("t1");
    expect(list[0]?.name).toBe("Template One");
  });

  it("returns empty array when file has no templates array", async () => {
    readSpy.mockResolvedValue("{}");
    const svc = new TemplatesService();
    const list = await svc.loadTemplates();
    expect(list).toEqual([]);
  });
});
