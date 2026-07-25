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

  // T06 (SPEC decision 5c): the editor mode renders every configuration
  // section at once (no @switch-gated single section), in the mock's order
  // (07/08). This replaces the old fixed 3-pane workstation assertions.
  //
  // The nav-vs-content ARRANGEMENT part of decision 5c (stacked single
  // column) was later explicitly superseded at the user's request — see
  // ai.component.scss's `.single-column-layout` comment — so nav+content are
  // now asserted as a side-by-side grid, not a stacked block. jsdom does no
  // real layout, so this checks the compiled stylesheet text Angular injects
  // into document.head, the same regression-tripwire style used by
  // workflow-builder-chrome.spec.ts for its own CSS assertions.
  describe("config nav + editor column layout (T06, superseded arrangement)", () => {
    beforeEach(() => {
      const component = fixture.componentInstance;
      component.editingAgentId.set(null);
      component.viewMode.set("editor");
      fixture.detectChanges();
    });

    function singleColumnLayoutStyleText(): string {
      return Array.from(document.head.querySelectorAll("style"))
        .map((s) => s.textContent ?? "")
        .filter((t) => t.includes(".single-column-layout"))
        .join("\n");
    }

    it("renders the config nav and editor column", () => {
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector(".single-column-layout")).toBeTruthy();
      expect(el.querySelector(".config-nav")).toBeTruthy();
      expect(el.querySelector(".editor-column")).toBeTruthy();
      // The old 3-pane workstation classes must be gone.
      expect(el.querySelector(".ide-layout")).toBeNull();
      expect(el.querySelector(".ide-nav")).toBeNull();
      expect(el.querySelector(".ide-center")).toBeNull();
    });

    it("lays out the config nav and editor column side-by-side as a grid, not stacked", () => {
      const css = singleColumnLayoutStyleText();
      // The base rule (before any @media override) - bounded to the text
      // before the first @media block so it can't accidentally match the
      // narrow-viewport override further down.
      const baseRule = css.split("@media")[0];
      expect(baseRule).toContain(".single-column-layout");
      expect(baseRule).toContain("display: grid");
      expect(baseRule).toContain("grid-template-columns: auto minmax(0, 1fr)");
    });

    it("falls back to a stacked single column below the 1080px breakpoint", () => {
      const css = singleColumnLayoutStyleText();
      const mediaBlock = css
        .split("@media (max-width: 1080px)")[1]
        ?.split("@media")[0];
      expect(mediaBlock).toBeTruthy();
      expect(mediaBlock).toContain(".single-column-layout");
      expect(mediaBlock).toContain("grid-template-columns: 1fr");
    });

    it("renders every configuration section in mock order, all at once (nothing @switch-dropped)", () => {
      const el = fixture.nativeElement as HTMLElement;
      const expectedOrder = [
        "section-general",
        "section-instruction-prompt",
        "section-instruction-rules",
        "section-instruction-soul",
        "section-instruction-mentions",
        "section-skills",
        "section-tools",
        "section-builtin-tools",
        "section-mcp-servers",
        "section-knowledge-bases",
        "section-variables",
        "section-versions",
      ];

      const foundIds = expectedOrder.map((id) => {
        const node = el.querySelector(`#${id}`);
        expect(node, `expected #${id} to exist in the DOM`).toBeTruthy();
        return node;
      });

      // All twelve sections must render simultaneously, in mock order.
      for (let i = 1; i < foundIds.length; i++) {
        const prevIndex = Array.from(
          el.querySelectorAll(".section-card")
        ).indexOf(foundIds[i - 1] as Element);
        const currentIndex = Array.from(
          el.querySelectorAll(".section-card")
        ).indexOf(foundIds[i] as Element);
        expect(currentIndex).toBeGreaterThan(prevIndex);
      }
    });

    it("stacks every skill and tool form inline instead of showing only the focused one", () => {
      const component = fixture.componentInstance;
      component.subagents = [
        { name: "Scoring", description: "", systemPrompt: "s1", enabled: true },
        { name: "Handoff", description: "", systemPrompt: "s2", enabled: true },
      ];
      component.tools = [
        {
          name: "crm-create",
          description: "",
          sourceType: "http",
          endpointUrl: "",
          endpointMethod: "GET",
          adapterRef: null,
          parameters: [],
        },
      ];
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector("#section-skill-0")).toBeTruthy();
      expect(el.querySelector("#section-skill-1")).toBeTruthy();
      expect(el.querySelector("#section-tool-0")).toBeTruthy();
    });

    it("scrolls the matching section anchor into view when the config nav emits a selection", () => {
      const component = fixture.componentInstance;
      // jsdom doesn't implement layout, so `scrollIntoView` isn't defined on
      // Element.prototype by default — stub it there so the DOM node found
      // via `document.getElementById` inherits a real spy-able function.
      const scrollSpy = vi.fn();
      Element.prototype.scrollIntoView = scrollSpy;

      const anchor = document.createElement("div");
      anchor.id = "section-instruction-rules";
      document.body.appendChild(anchor);

      component.onNavSelect({ kind: "instruction-rules" });

      expect(component.selection().kind).toBe("instruction-rules");
      expect(scrollSpy).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "start",
      });

      document.body.removeChild(anchor);
    });

    it("scrolls the knowledge-bases section anchor into view (camelCase selection kind maps to kebab-case anchor id)", () => {
      const component = fixture.componentInstance;
      const scrollSpy = vi.fn();
      Element.prototype.scrollIntoView = scrollSpy;

      const anchor = document.createElement("div");
      anchor.id = "section-knowledge-bases";
      document.body.appendChild(anchor);

      component.onNavSelect({ kind: "knowledgeBases" });

      expect(component.selection().kind).toBe("knowledgeBases");
      expect(scrollSpy).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "start",
      });

      document.body.removeChild(anchor);
    });

    it("does not throw when the selected anchor is missing from the DOM", () => {
      const component = fixture.componentInstance;
      expect(() =>
        component.onNavSelect({ kind: "skill", index: 99 })
      ).not.toThrow();
      expect(component.selection()).toEqual({ kind: "skill", index: 99 });
    });
  });
});
