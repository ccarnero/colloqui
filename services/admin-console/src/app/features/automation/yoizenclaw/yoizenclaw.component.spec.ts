import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideMonacoEditor } from "ngx-monaco-editor-v2";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { of } from "rxjs";
import { Router } from "@angular/router";
import { YoizenclawComponent } from "./yoizenclaw.component";
import { YoizenclawAdminService } from "../../../core/services/yoizenclaw-admin.service";
import { AdaptersService } from "../../../core/services/adapters.service";
import { YoizenclawRuntimeService } from "../../../core/services/yoizenclaw-runtime.service";
import { type IYoizenclawAgent } from "../../../core/models/yoizenclaw.model";

describe("YoizenclawComponent", () => {
  let fixture: ComponentFixture<YoizenclawComponent>;
  const mockAdminService = {
    listTemplates: vi.fn().mockReturnValue(of({ templates: [] })),
    listAgents: vi.fn().mockReturnValue(of({ agents: [] })),
    deleteAgent: vi.fn().mockReturnValue(of(void 0)),
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
      }),
    ),
  };

  const sampleAgent: IYoizenclawAgent = {
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
    channels: [],
    status: "draft",
    is_active: true,
    published_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [YoizenclawComponent],
      providers: [
        provideMonacoEditor({ defaultOptions: {} }),
        {
          provide: YoizenclawAdminService,
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
          provide: YoizenclawRuntimeService,
          useValue: mockRuntimeService,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(YoizenclawComponent);
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
    component.agents.set([sampleAgent]);

    await component.checkRuntimeSync(sampleAgent.id);

    expect(mockRuntimeService.createExecution).toHaveBeenCalled();
    expect(component.runtimeHealth()[sampleAgent.id]?.state).toBe("synced");
  });
});
