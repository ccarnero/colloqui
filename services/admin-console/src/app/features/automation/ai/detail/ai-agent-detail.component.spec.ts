import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ActivatedRoute, Router } from "@angular/router";
import { of } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import type { IAgent } from "../../../../core/models/agent.model";
import { AgentAdminService } from "../../../../core/services/agent-admin.service";
import { AiAgentDetailComponent } from "./ai-agent-detail.component";

/**
 * Task B - floating chrome parity with WorkflowBuilderComponent (see
 * workflow-builder/__tests__/workflow-builder-chrome.spec.ts for the sibling
 * suite this mirrors). Verifies the chrome only replaces the conventional
 * header on /configure, that the save-state label reflects the real bridge
 * signals (no invented dirty-tracking), and that publish/unpublish/test/
 * playground all remain reachable and unduplicated.
 */
describe("AiAgentDetailComponent - floating chrome (Task B)", () => {
  let fixture: ComponentFixture<AiAgentDetailComponent>;
  let router: Router;
  let mockAdminService: {
    getAgent: ReturnType<typeof vi.fn>;
    publishAgent: ReturnType<typeof vi.fn>;
    unpublishAgent: ReturnType<typeof vi.fn>;
  };

  const draftAgent: IAgent = {
    id: "agent-1",
    name: "Sales Agent",
    description: "Desc",
    system_prompt: "Prompt",
    model_config: {
      llm: { provider: "openai", model: "gpt-5.4-nano", connectorId: null },
      rules: "Rules",
      soul: "Soul",
      subagents: [],
    },
    tools: [],
    enabled_tools: null,
    enabled_mcp_servers: null,
    enabled_mcp_tools: null,
    tool_description_overrides: null,
    channels: [],
    status: "draft",
    is_active: true,
    published_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    published_config: null,
  };

  async function setup(url: string): Promise<void> {
    mockAdminService = {
      getAgent: vi.fn().mockReturnValue(of(draftAgent)),
      publishAgent: vi
        .fn()
        .mockReturnValue(of({ ...draftAgent, status: "published" as const })),
      unpublishAgent: vi
        .fn()
        .mockReturnValue(of({ ...draftAgent, status: "draft" as const })),
    };

    await TestBed.configureTestingModule({
      imports: [AiAgentDetailComponent],
      providers: [
        {
          provide: AgentAdminService,
          useValue: mockAdminService,
        },
        {
          provide: ActivatedRoute,
          useValue: {
            params: of({ id: draftAgent.id }),
            snapshot: { params: { id: draftAgent.id } },
          },
        },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, "navigate").mockResolvedValue(true);
    Object.defineProperty(router, "url", { value: url, configurable: true });

    fixture = TestBed.createComponent(AiAgentDetailComponent);
    fixture.detectChanges();
  }

  it("renders the conventional header (not the floating chrome) on /overview", async () => {
    await setup("/ai/agents/agent-1/overview");

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="agent-chrome"]')).toBeNull();
    expect(el.querySelector(".detail-h")).toBeTruthy();
  });

  it("renders the floating chrome instead of the conventional header on /configure", async () => {
    await setup("/ai/agents/agent-1/configure");

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="agent-chrome"]')).toBeTruthy();
    expect(el.querySelector(".detail-h")).toBeNull();
  });

  it("renders the Overview/Configure/Settings segmented control on /configure", async () => {
    await setup("/ai/agents/agent-1/configure");

    const el = fixture.nativeElement as HTMLElement;
    const segmented = el.querySelector(
      '[data-testid="agent-chrome-segmented-control"]'
    );
    expect(segmented?.textContent).toContain("Overview");
    expect(segmented?.textContent).toContain("Configure");
    expect(segmented?.textContent).toContain("Settings");
  });

  it("shows 'Saved' in the save-state pill when the bridge reports no dirty state", async () => {
    await setup("/ai/agents/agent-1/configure");

    const el = fixture.nativeElement as HTMLElement;
    const saveState = el.querySelector(
      '[data-testid="agent-chrome-save-state"]'
    );
    expect(saveState?.textContent).toContain("Saved");
    expect(saveState?.textContent).not.toContain("Unsaved");
  });

  it("shows 'Unsaved' once the bridge reports a dirty inner editor", async () => {
    await setup("/ai/agents/agent-1/configure");
    fixture.componentInstance.bridge.isDirty.set(true);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const saveState = el.querySelector(
      '[data-testid="agent-chrome-save-state"]'
    );
    expect(saveState?.textContent).toContain("Unsaved");
  });

  it("shows 'Saving…' while the bridge reports a save in flight", async () => {
    await setup("/ai/agents/agent-1/configure");
    fixture.componentInstance.bridge.saving.set(true);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const saveState = el.querySelector(
      '[data-testid="agent-chrome-save-state"]'
    );
    expect(saveState?.textContent).toContain("Saving");
  });

  it("shows a Publish button for a draft agent and calls AgentAdminService.publishAgent", async () => {
    await setup("/ai/agents/agent-1/configure");

    const el = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(el.querySelectorAll("button"));
    const publishBtn = buttons.find((b) => b.textContent?.includes("Publish"));
    expect(publishBtn).toBeTruthy();

    publishBtn!.click();
    expect(mockAdminService.publishAgent).toHaveBeenCalledWith(draftAgent.id);
  });

  it("swaps to an Unpublish button once the agent is published", async () => {
    await setup("/ai/agents/agent-1/configure");
    fixture.componentInstance.publishAgent();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(el.querySelectorAll("button"));
    expect(buttons.some((b) => b.textContent?.includes("Unpublish"))).toBe(
      true
    );
    expect(buttons.some((b) => b.textContent?.trim() === "Publish")).toBe(
      false
    );
  });

  it("toggles the test panel from the chrome's Test agent button", async () => {
    await setup("/ai/agents/agent-1/configure");

    expect(fixture.componentInstance.testPanelOpen()).toBe(true);
    fixture.componentInstance.toggleTestPanel();
    expect(fixture.componentInstance.testPanelOpen()).toBe(false);
  });

  it("navigates to the playground with the agent preset from the chrome", async () => {
    await setup("/ai/agents/agent-1/configure");

    fixture.componentInstance.openPlayground();
    expect(router.navigate).toHaveBeenCalledWith(["/ai/playground"], {
      queryParams: { agentId: draftAgent.id },
    });
  });

  it("navigates back to /ai/agents from the chrome's back button", async () => {
    await setup("/ai/agents/agent-1/configure");

    const el = fixture.nativeElement as HTMLElement;
    const backButton = el.querySelector<HTMLButtonElement>(
      '[aria-label="Back to agents"]'
    );
    expect(backButton).toBeTruthy();

    backButton!.click();
    expect(router.navigate).toHaveBeenCalledWith(["/ai/agents"]);
  });
});
