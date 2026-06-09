import { ComponentFixture, TestBed } from "@angular/core/testing";
import { type IAgent } from "../../../core/models/agent.model";
import { vi } from "vitest";
import { AiExistingAgentsPanelComponent } from "./existing-agents-panel.component";

describe("AiExistingAgentsPanelComponent", () => {
  let fixture: ComponentFixture<AiExistingAgentsPanelComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AiExistingAgentsPanelComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(AiExistingAgentsPanelComponent);
    fixture.componentRef.setInput("agents", []);
    fixture.componentRef.setInput("loading", false);
    fixture.componentRef.setInput("editingAgentId", null);
    fixture.componentRef.setInput("publishingId", null);
    fixture.componentRef.setInput("deletingId", null);
    fixture.componentRef.setInput("runtimeHealth", {});
    fixture.detectChanges();
  });

  it("creates", () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it("emits delete when clicking Delete", () => {
    const agent: IAgent = {
      id: "agent-1",
      name: "Sales Agent",
      description: "Desc",
      system_prompt: "Prompt",
      model_config: { rules: "Rules", soul: "Soul", subagents: [] },
      tools: [],
      enabled_tools: null,
      enabled_mcp_servers: null,
      tool_description_overrides: null,
      channels: [],
      status: "draft",
      is_active: true,
      published_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      published_config: null,
    };

    const onDelete = vi.fn();
    fixture.componentInstance.delete.subscribe(onDelete);
    fixture.componentRef.setInput("agents", [agent]);
    fixture.detectChanges();

    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll("button"),
    ) as Element[];
    const button = buttons.find((node) =>
      node.textContent?.includes("Delete"),
    ) as
      | HTMLButtonElement
      | undefined;

    expect(button).toBeDefined();
    button?.click();

    expect(onDelete).toHaveBeenCalledWith("agent-1");
  });

  it("emits runtime check when clicking Check Runtime", () => {
    const agent: IAgent = {
      id: "agent-1",
      name: "Sales Agent",
      description: "Desc",
      system_prompt: "Prompt",
      model_config: { rules: "Rules", soul: "Soul", subagents: [] },
      tools: [],
      enabled_tools: null,
      enabled_mcp_servers: null,
      tool_description_overrides: null,
      channels: [],
      status: "published",
      is_active: true,
      published_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      published_config: null,
    };

    const onCheck = vi.fn();
    fixture.componentInstance.checkRuntime.subscribe(onCheck);
    fixture.componentRef.setInput("agents", [agent]);
    fixture.detectChanges();

    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll("button"),
    ) as Element[];
    const button = buttons.find((node) =>
      node.textContent?.includes("Check Runtime"),
    ) as HTMLButtonElement | undefined;

    expect(button).toBeDefined();
    button?.click();

    expect(onCheck).toHaveBeenCalledWith("agent-1");
  });
});
