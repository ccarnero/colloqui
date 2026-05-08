import { ComponentFixture, TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { of } from "rxjs";
import { ActivatedRoute, convertToParamMap } from "@angular/router";
import { PlaygroundComponent } from "./playground.component";
import { YoizenclawAdminService } from "../../../core/services/yoizenclaw-admin.service";
import { YoizenclawRuntimeService } from "../../../core/services/yoizenclaw-runtime.service";
import { type IYoizenclawAgent } from "../../../core/models/yoizenclaw.model";

describe("PlaygroundComponent", () => {
  let fixture: ComponentFixture<PlaygroundComponent>;
  const adminServiceMock = {
    listAgents: vi.fn().mockReturnValue(of({ agents: [] })),
  };
  const runtimeServiceMock = {
    createExecution: vi
      .fn()
      .mockReturnValue(of({ executionId: "exec-1", status: "accepted" })),
    getExecution: vi.fn().mockReturnValue(
      of({
        executionId: "exec-1",
        tenantId: "tenant-1",
        type: "chat",
        state: "completed",
        requestedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        agentId: "agent-1",
        result: { reply: "ok", tool_calls: [] },
      }),
    ),
  };

  const publishedAgent: IYoizenclawAgent = {
    id: "agent-2",
    name: "Published Agent",
    description: "Desc",
    system_prompt: "Prompt",
    model_config: {
      llm: { provider: "openai", model: "gpt-5.4-nano", connectorId: null },
      rules: "Rules",
      soul: "Soul",
      subagents: [],
    },
    tools: [],
    channels: [],
    status: "published",
    is_active: true,
    published_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlaygroundComponent],
      providers: [
        {
          provide: YoizenclawAdminService,
          useValue: adminServiceMock,
        },
        {
          provide: YoizenclawRuntimeService,
          useValue: runtimeServiceMock,
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap({}),
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PlaygroundComponent);
    fixture.detectChanges();
  });

  it("creates", () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it("updates selected agent by id", () => {
    const component = fixture.componentInstance;
    component.agents.set([publishedAgent]);

    component.onSelectedAgentIdChange("agent-2");

    expect(component.selectedAgentId()).toBe("agent-2");
    expect(component.selectedAgent()?.id).toBe("agent-2");
  });

  it("renders runtime failure message when execution fails", async () => {
    runtimeServiceMock.getExecution.mockReturnValueOnce(
      of({
        executionId: "exec-1",
        tenantId: "tenant-1",
        type: "chat",
        state: "failed",
        requestedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        agentId: "agent-2",
        result: {
          errorCode: "EXECUTION_FAILED",
          errorMessage: "Failed to resolve agent 'agent-2'",
        },
      }),
    );

    const component = fixture.componentInstance;
    component.selectedAgent.set(publishedAgent);
    component.newMessage.set("hello");

    await component.sendMessage();

    const last = component.messages()[component.messages().length - 1];
    expect(last?.role).toBe("system");
    expect(last?.content).toContain("Failed to resolve agent 'agent-2'");
  });
});
