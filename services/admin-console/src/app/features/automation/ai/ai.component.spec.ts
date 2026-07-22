import { ComponentFixture, TestBed } from "@angular/core/testing";
import { Router } from "@angular/router";
import { provideMonacoEditor } from "ngx-monaco-editor-v2";
import { of } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type IAgent } from "../../../core/models/agent.model";
import { AdaptersService } from "../../../core/services/adapters.service";
import { AgentAdminService } from "../../../core/services/agent-admin.service";
import { AgentRuntimeService } from "../../../core/services/agent-runtime.service";
import { AiComponent } from "./ai.component";

describe("AiComponent", () => {
  let fixture: ComponentFixture<AiComponent>;
  const mockAdminService = {
    listTemplates: vi.fn().mockReturnValue(of({ templates: [] })),
    listAgents: vi.fn().mockReturnValue(of({ agents: [] })),
    deleteAgent: vi.fn().mockReturnValue(of(void 0)),
    createAgent: vi.fn().mockReturnValue(
      of({
        id: "agent-new",
        name: "New Agent",
        description: "",
        system_prompt: "",
        model_config: {
          llm: { provider: "openai", model: "gpt-5.4-nano", connectorId: null },
          rules: "",
          soul: "",
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
      })
    ),
    updateAgent: vi.fn(),
  };

  const mockRuntimeService = {
    createExecution: vi
      .fn()
      .mockReturnValue(of({ executionId: "exec-health", status: "accepted" })),
    getExecution: vi.fn().mockReturnValue(
      of({
        executionId: "exec-health",
        tenantId: "tenant-1",
        type: "chat",
        state: "completed",
        requestedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        agentId: "agent-1",
        result: { reply: "ok", tool_calls: [] },
      })
    ),
    checkRuntimeHealth: vi
      .fn()
      .mockReturnValue(
        of({ status: "ok", nats: "connected", redis: "connected" })
      ),
  };

  const sampleAgent: IAgent = {
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

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AiComponent],
      providers: [
        provideMonacoEditor({ defaultOptions: {} }),
        {
          provide: AgentAdminService,
          useValue: mockAdminService,
        },
        {
          provide: AdaptersService,
          useValue: {
            listByTag: vi.fn().mockReturnValue(of([])),
          },
        },
        {
          provide: Router,
          useValue: {
            navigate: vi.fn(),
          },
        },
        {
          provide: AgentRuntimeService,
          useValue: mockRuntimeService,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AiComponent);
    fixture.detectChanges();

    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("renders agents list header", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Agents");
    expect(el.textContent).toContain("New Agent");
  });

  it("deletes an agent when confirmed", () => {
    const component = fixture.componentInstance;
    component.agents.set([sampleAgent]);

    component.deleteAgent(sampleAgent.id);

    expect(mockAdminService.deleteAgent).toHaveBeenCalledWith(sampleAgent.id);
    expect(component.agents()).toHaveLength(0);
  });

  it("marks runtime health synced when check passes", async () => {
    const component = fixture.componentInstance;
    const publishedAgent: IAgent = { ...sampleAgent, status: "published" };
    component.agents.set([publishedAgent]);

    await component.checkRuntimeSync(publishedAgent.id);

    expect(mockRuntimeService.checkRuntimeHealth).toHaveBeenCalled();
    expect(component.runtimeHealth()[publishedAgent.id]?.state).toBe("synced");
  });

  it("marks runtime health draft when agent is not published", async () => {
    const component = fixture.componentInstance;
    component.agents.set([sampleAgent]);

    await component.checkRuntimeSync(sampleAgent.id);

    expect(component.runtimeHealth()[sampleAgent.id]?.state).toBe("draft");
    expect(component.runtimeHealth()[sampleAgent.id]?.detail).toBe(
      "Agent not published"
    );
  });

  // Mention decorations are DISPLAY-LAYER ONLY (SPEC decision 2): the saved
  // prompt string must be byte-identical to what the editor holds, even
  // though it contains mention syntax the decorations mechanism also parses.
  it("saves the system prompt byte-identical to the editor value, mentions included", () => {
    const component = fixture.componentInstance;
    const promptWithMentions =
      "Score using @skill:lead-scoring, then escalate via @tool:crm-create-opportunity.";

    component.agentName = "Sales Agent";
    component.systemPrompt = promptWithMentions;
    component.rules = "Be helpful.";
    component.soul = "Friendly.";
    component.editingAgentId.set(null);

    component.saveAgent();

    expect(mockAdminService.createAgent).toHaveBeenCalledTimes(1);
    const [draft] = mockAdminService.createAgent.mock.calls[0];
    expect(draft.systemPrompt).toBe(promptWithMentions);
    expect(draft.systemPrompt).toEqual(promptWithMentions);
  });
});
