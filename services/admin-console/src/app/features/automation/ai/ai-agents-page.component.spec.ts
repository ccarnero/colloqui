import { Component } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter, Router, type Routes } from "@angular/router";
import { of, throwError } from "rxjs";
import { vi } from "vitest";
import type { IAgent } from "../../../core/models/agent.model";
import { AgentAdminService } from "../../../core/services/agent-admin.service";
import { AgentRuntimeService } from "../../../core/services/agent-runtime.service";
import { AiAgentsPageComponent } from "./ai-agents-page.component";

const PUBLISHED_SYNCED_ID = "0f7f8a2a-1111-4a1a-8a1a-111111111111";
const DRAFT_ID = "0f7f8a2a-2222-4a1a-8a1a-222222222222";
const MISCONFIGURED_ID = "0f7f8a2a-3333-4a1a-8a1a-333333333333";

function buildAgent(overrides: Partial<IAgent> = {}): IAgent {
  return {
    id: PUBLISHED_SYNCED_ID,
    name: "Sales Agent",
    description: "Desc",
    system_prompt: "Prompt",
    model_config: {
      rules: "Rules",
      soul: "Soul",
      subagents: [{ name: "s1", system_prompt: "p" }],
      llm: { provider: "openai", model: "gpt-4o", connectorId: null },
    },
    tools: [],
    enabled_tools: null,
    enabled_mcp_servers: null,
    enabled_mcp_tools: null,
    tool_description_overrides: null,
    channels: [],
    status: "published",
    is_active: true,
    published_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    published_config: null,
    ...overrides,
  };
}

@Component({ standalone: true, template: "", selector: "app-stub" })
class StubComponent {}

const testRoutes: Routes = [
  { path: "ai/agents/new", component: StubComponent },
  { path: "ai/agents/:id", component: StubComponent },
];

function buildAgentAdminServiceMock(agents: IAgent[]) {
  return {
    listAgents: vi.fn().mockReturnValue(of({ agents, total: agents.length })),
  };
}

function buildAgentRuntimeServiceMock(
  health: { status: string; nats: string; redis: string } = {
    status: "ok",
    nats: "ok",
    redis: "ok",
  }
) {
  return {
    checkRuntimeHealth: vi.fn().mockReturnValue(of(health)),
  };
}

async function renderPage(
  agents: IAgent[],
  options: {
    navigate?: ReturnType<typeof vi.fn>;
    runtimeHealth?: { status: string; nats: string; redis: string };
    runtimeHealthError?: boolean;
  } = {}
): Promise<{
  fixture: ComponentFixture<AiAgentsPageComponent>;
  navigate: ReturnType<typeof vi.fn>;
}> {
  const navigate = options.navigate ?? vi.fn().mockResolvedValue(true);
  const runtimeServiceMock = options.runtimeHealthError
    ? {
        checkRuntimeHealth: vi
          .fn()
          .mockReturnValue(throwError(() => new Error("down"))),
      }
    : buildAgentRuntimeServiceMock(options.runtimeHealth);

  await TestBed.configureTestingModule({
    imports: [AiAgentsPageComponent],
    providers: [
      provideRouter(testRoutes),
      {
        provide: AgentAdminService,
        useValue: buildAgentAdminServiceMock(agents),
      },
      { provide: AgentRuntimeService, useValue: runtimeServiceMock },
      { provide: Router, useValue: { navigate } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(AiAgentsPageComponent);
  fixture.detectChanges();
  return { fixture, navigate };
}

describe("AiAgentsPageComponent", () => {
  it("renders the page header", async () => {
    const { fixture } = await renderPage([buildAgent()]);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("AI agents");
  });

  describe("runtime-state to health mapping", () => {
    it("maps a published, correctly configured agent to the ok health dot (synced)", async () => {
      const { fixture } = await renderPage([
        buildAgent({ id: PUBLISHED_SYNCED_ID }),
      ]);
      await fixture.whenStable();
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const dot = el.querySelector(".health-dot") as HTMLElement;
      expect(dot.className).toContain("health-dot--ok");
    });

    it("maps a draft agent to the idle health dot", async () => {
      const { fixture } = await renderPage([
        buildAgent({ id: DRAFT_ID, status: "draft" }),
      ]);
      await fixture.whenStable();
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const dot = el.querySelector(".health-dot") as HTMLElement;
      expect(dot.className).toContain("health-dot--idle");
    });

    it("maps every agent to the warn health dot when the runtime gateway is unhealthy (unsynced)", async () => {
      const { fixture } = await renderPage(
        [buildAgent({ id: PUBLISHED_SYNCED_ID })],
        {
          runtimeHealth: { status: "degraded", nats: "down", redis: "ok" },
        }
      );
      await fixture.whenStable();
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const dot = el.querySelector(".health-dot") as HTMLElement;
      expect(dot.className).toContain("health-dot--warn");
    });

    it("maps a published agent missing provider/model to the error health dot (misconfigured)", async () => {
      const { fixture } = await renderPage([
        buildAgent({
          id: MISCONFIGURED_ID,
          status: "published",
          model_config: {
            rules: "Rules",
            soul: "Soul",
            subagents: [],
            llm: { provider: "", model: "", connectorId: null },
          },
        }),
      ]);
      await fixture.whenStable();
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const dot = el.querySelector(".health-dot") as HTMLElement;
      expect(dot.className).toContain("health-dot--error");
    });
  });

  describe("empty state", () => {
    it("renders the inventory table empty message when there are no agents", async () => {
      const { fixture } = await renderPage([]);
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelectorAll(".table-row").length).toBe(0);
      expect(el.textContent).toContain(
        "No agents found. Create your first AI agent to get started."
      );
    });
  });

  describe("row click navigation", () => {
    it("navigates to the editor route when an agent row is clicked", async () => {
      const { fixture, navigate } = await renderPage([
        buildAgent({ id: PUBLISHED_SYNCED_ID }),
      ]);
      const el = fixture.nativeElement as HTMLElement;
      const row = el.querySelector(".table-row") as HTMLElement;
      expect(row).toBeTruthy();
      row.click();
      expect(navigate).toHaveBeenCalledWith([
        "/ai/agents",
        PUBLISHED_SYNCED_ID,
      ]);
    });
  });

  describe("needs-attention panel filtering", () => {
    it("lists only agents in warn/error runtime state (unsynced/misconfigured)", async () => {
      const synced = buildAgent({
        id: PUBLISHED_SYNCED_ID,
        name: "Synced Agent",
      });
      const misconfigured = buildAgent({
        id: MISCONFIGURED_ID,
        name: "Broken Agent",
        status: "published",
        model_config: {
          rules: "Rules",
          soul: "Soul",
          subagents: [],
          llm: { provider: "", model: "", connectorId: null },
        },
      });
      const { fixture } = await renderPage([synced, misconfigured]);
      await fixture.whenStable();
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const issueRows = el.querySelectorAll(".issue-row");
      expect(issueRows.length).toBe(1);
      expect(el.textContent).toContain(
        "Broken Agent is published but missing provider/model configuration."
      );
      expect(el.textContent).not.toContain("Synced Agent is published");
    });

    it("renders the empty state when no agents need attention", async () => {
      const { fixture } = await renderPage([
        buildAgent({ id: PUBLISHED_SYNCED_ID }),
      ]);
      await fixture.whenStable();
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelectorAll(".issue-row").length).toBe(0);
      expect(el.textContent).toContain("No agents need attention");
    });

    it("navigates to the editor route when an attention action link is clicked", async () => {
      const misconfigured = buildAgent({
        id: MISCONFIGURED_ID,
        status: "published",
        model_config: {
          rules: "Rules",
          soul: "Soul",
          subagents: [],
          llm: { provider: "", model: "", connectorId: null },
        },
      });
      const { fixture, navigate } = await renderPage([misconfigured]);
      await fixture.whenStable();
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const action = el.querySelector(".issue-action") as HTMLAnchorElement;
      expect(action).toBeTruthy();
      action.click();
      expect(navigate).toHaveBeenCalledWith(["/ai/agents", MISCONFIGURED_ID]);
    });
  });

  describe("new agent affordance", () => {
    it("navigates to the new-agent route when the New agent button is clicked", async () => {
      const { fixture, navigate } = await renderPage([]);
      const el = fixture.nativeElement as HTMLElement;
      const buttons = Array.from(el.querySelectorAll("button"));
      const newAgentButton = buttons.find((btn) =>
        btn.textContent?.includes("New agent")
      ) as HTMLButtonElement;
      expect(newAgentButton).toBeTruthy();
      newAgentButton.click();
      expect(navigate).toHaveBeenCalledWith(["/ai/agents/new"]);
    });
  });

  describe("metrics row", () => {
    it("renders real, client-derived counts only", async () => {
      const { fixture } = await renderPage([
        buildAgent({ id: PUBLISHED_SYNCED_ID, status: "published" }),
        buildAgent({ id: DRAFT_ID, status: "draft" }),
      ]);
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain("Agents");
      expect(el.textContent).toContain("Published");
      expect(el.textContent).toContain("Draft");
      expect(el.textContent).toContain("Skills configured");
      expect(el.textContent).not.toContain("Invocations");
      expect(el.textContent).not.toContain("Avg p95");
      expect(el.textContent).not.toContain("Handoff rate");
    });
  });

  describe("gateway health check failure", () => {
    it("treats a failed gateway health check as unhealthy (unsynced/warn), not silently", async () => {
      const { fixture } = await renderPage(
        [buildAgent({ id: PUBLISHED_SYNCED_ID })],
        { runtimeHealthError: true }
      );
      await fixture.whenStable();
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const dot = el.querySelector(".health-dot") as HTMLElement;
      expect(dot.className).toContain("health-dot--warn");
    });
  });
});
