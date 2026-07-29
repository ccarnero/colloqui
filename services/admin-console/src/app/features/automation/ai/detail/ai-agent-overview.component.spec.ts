import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ActivatedRoute, Router } from "@angular/router";
import { of, throwError } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import type { IAgent } from "../../../../core/models/agent.model";
import { AgentAdminService } from "../../../../core/services/agent-admin.service";
import { AuthService } from "../../../../core/services/auth.service";
import {
  ConnectorCallService,
  type IAgentExecutionCall,
} from "../../../../core/services/connector-call.service";
import { AiAgentOverviewComponent } from "./ai-agent-overview.component";

/**
 * T10 of manual-loops/connectors/connection-call-inspector.md — "Recent
 * executions" feed + inspector on the agent Overview tab. Mirrors
 * mcp-detail.component.spec.ts's T09 "tracking feed migration" suite (feed
 * source, inspector open, no-op without eventId/correlationId, trace link,
 * empty state).
 */
describe("AiAgentOverviewComponent - T10 recent executions", () => {
  let fixture: ComponentFixture<AiAgentOverviewComponent>;
  let agentAdminService: { getAgent: ReturnType<typeof vi.fn> };
  let calls: { recentAgentExecutions: ReturnType<typeof vi.fn> };
  let router: Router;

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

  function makeExecution(
    overrides: Partial<IAgentExecutionCall> = {}
  ): IAgentExecutionCall {
    return {
      agentId: "agent-1",
      state: "completed",
      model: "gpt-5.4-nano",
      durationMs: 1200,
      costUsd: 0.0042,
      timestamp: "2026-06-01T12:00:00.000Z",
      correlationId: "corr-exec-1",
      eventId: "evt-exec-1",
      ...overrides,
    };
  }

  async function setup(
    executionsObs = of<IAgentExecutionCall[]>([]),
    agentObs = of(draftAgent)
  ): Promise<void> {
    agentAdminService = { getAgent: vi.fn().mockReturnValue(agentObs) };
    calls = {
      recentAgentExecutions: vi.fn().mockReturnValue(executionsObs),
    };

    await TestBed.configureTestingModule({
      imports: [AiAgentOverviewComponent],
      providers: [
        { provide: AgentAdminService, useValue: agentAdminService },
        { provide: ConnectorCallService, useValue: calls },
        { provide: AuthService, useValue: { hasPermission: () => true } },
        {
          provide: ActivatedRoute,
          useValue: {
            parent: { snapshot: { paramMap: { get: () => "agent-1" } } },
          },
        },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, "navigate").mockResolvedValue(true);

    fixture = TestBed.createComponent(AiAgentOverviewComponent);
    fixture.detectChanges();
  }

  it("loads recent executions from ConnectorCallService.recentAgentExecutions filtered by agent id", async () => {
    await setup(of([makeExecution({ model: "gpt-5.4-nano" })]));

    expect(calls.recentAgentExecutions).toHaveBeenCalledWith(
      "agent-1",
      undefined,
      20
    );
    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("gpt-5.4-nano");
    expect(text).toContain("completed");
  });

  it("renders the empty state naming the 7-day window when there are no executions", async () => {
    await setup(of([]));

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("No executions in the last 7 days.");
  });

  it("clicking a row opens the inspector with that row's event", async () => {
    await setup(of([makeExecution()]));

    const host = fixture.nativeElement as HTMLElement;
    const row = host.querySelector<HTMLElement>(".call-row");
    expect(row).toBeTruthy();
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    fixture.detectChanges();

    expect(fixture.componentInstance["inspectorRow"]()).toEqual({
      eventId: "evt-exec-1",
      correlationId: "corr-exec-1",
      kind: "execution_completed",
      scalars: {
        state: "completed",
        model: "gpt-5.4-nano",
        durationMs: 1200,
        costUsd: 0.0042,
      },
    });
    expect(host.querySelector("app-call-inspector")).toBeTruthy();
  });

  it("does not open the inspector for a row without eventId/correlationId", async () => {
    await setup(
      of([makeExecution({ eventId: undefined, correlationId: undefined })])
    );

    const host = fixture.nativeElement as HTMLElement;
    const row = host.querySelector<HTMLElement>(".call-row");
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    fixture.detectChanges();

    expect(fixture.componentInstance["inspectorRow"]()).toBeNull();
    expect(host.querySelector("app-call-inspector")).toBeFalsy();
  });

  it("the View trace link navigates to /processes/trace/<correlationId>", async () => {
    await setup(of([makeExecution()]));

    const host = fixture.nativeElement as HTMLElement;
    const trace = host.querySelector<HTMLAnchorElement>(
      "a.trace-link[href='/processes/trace/corr-exec-1']"
    );
    expect(trace).toBeTruthy();
  });

  it("logs and no-ops when recentAgentExecutions errors, without breaking the rest of the page", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await setup(throwError(() => new Error("boom")));

    expect(fixture.componentInstance["executionsLoading"]()).toBe(false);
    expect(fixture.componentInstance["recentExecutions"]()).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
