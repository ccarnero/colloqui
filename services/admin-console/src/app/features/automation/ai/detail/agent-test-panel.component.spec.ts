import { ComponentFixture, TestBed } from "@angular/core/testing";
import { of } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRuntimeService } from "../../../../core/services/agent-runtime.service";
import { AgentTestPanelComponent } from "./agent-test-panel.component";

describe("AgentTestPanelComponent", () => {
  let fixture: ComponentFixture<AgentTestPanelComponent>;
  let component: AgentTestPanelComponent;

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
        startedAt: new Date(Date.now() - 500).toISOString(),
        completedAt: new Date().toISOString(),
        agentId: "agent-1",
        result: { response: "Hello there", usage: { totalTokens: 214 } },
      })
    ),
  };

  beforeEach(async () => {
    runtimeServiceMock.createExecution.mockClear();
    runtimeServiceMock.getExecution.mockClear();

    await TestBed.configureTestingModule({
      imports: [AgentTestPanelComponent],
      providers: [
        { provide: AgentRuntimeService, useValue: runtimeServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentTestPanelComponent);
    fixture.componentRef.setInput("agentId", "agent-1");
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates", () => {
    expect(component).toBeTruthy();
  });

  it("calls createExecution with the agent id and message", async () => {
    component.draftMessage.set("hi agent");

    await component["sendMessage"]();

    expect(runtimeServiceMock.createExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-1",
        message: "hi agent",
      })
    );
  });

  it("renders the user turn and the agent turn with metrics from a terminal execution", async () => {
    component.draftMessage.set("hi agent");

    await component["sendMessage"]();

    const turns = component.turns();
    expect(turns[0]).toMatchObject({ role: "user", content: "hi agent" });
    expect(turns[1]).toMatchObject({ role: "agent", content: "Hello there" });
    expect(turns[1].metrics?.usage?.totalTokens).toBe(214);
    expect(turns[1].metrics?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("does not render tokens/latency fields that are absent as 0 or fake", async () => {
    runtimeServiceMock.getExecution.mockReturnValueOnce(
      of({
        executionId: "exec-2",
        tenantId: "tenant-1",
        type: "chat",
        state: "completed",
        requestedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        agentId: "agent-1",
        result: { response: "No usage data here" },
      })
    );

    component.draftMessage.set("hi again");
    await component["sendMessage"]();

    const agentTurn = component.turns()[1];
    expect(agentTurn.metrics?.usage).toBeUndefined();
    expect(agentTurn.metrics?.latencyMs).toBeUndefined();
  });

  it("renders a visible error and logs to console.error when the execution fails", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    runtimeServiceMock.getExecution.mockReturnValueOnce(
      of({
        executionId: "exec-3",
        tenantId: "tenant-1",
        type: "chat",
        state: "failed",
        requestedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        agentId: "agent-1",
        result: { errorMessage: "Agent runtime unavailable" },
      })
    );

    component.draftMessage.set("hi agent");
    await component["sendMessage"]();

    const last = component.turns()[component.turns().length - 1];
    expect(last.role).toBe("error");
    expect(last.content).toContain("Agent runtime unavailable");
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("renders a visible error and logs to console.error when createExecution throws", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    runtimeServiceMock.createExecution.mockReturnValueOnce({
      // Observable-like object whose subscribe throws to simulate a
      // network failure surfaced through firstValueFrom.
      subscribe: () => {
        throw new Error("Network unreachable");
      },
    } as any);

    component.draftMessage.set("hi agent");
    await component["sendMessage"]();

    const last = component.turns()[component.turns().length - 1];
    expect(last.role).toBe("error");
    expect(last.content).toContain("Network unreachable");
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("shows the running-state indicator while polling and clears it when terminal", async () => {
    vi.useFakeTimers();
    runtimeServiceMock.getExecution
      .mockReturnValueOnce(
        of({
          executionId: "exec-4",
          tenantId: "tenant-1",
          type: "chat",
          state: "running",
          requestedAt: new Date().toISOString(),
          agentId: "agent-1",
        })
      )
      .mockReturnValueOnce(
        of({
          executionId: "exec-4",
          tenantId: "tenant-1",
          type: "chat",
          state: "completed",
          requestedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          agentId: "agent-1",
          result: { response: "Done" },
        })
      );

    component.draftMessage.set("hi agent");
    const sendPromise = component["sendMessage"]();

    // Yield a microtask so createExecution + first getExecution resolve.
    await Promise.resolve();
    await Promise.resolve();
    expect(component.running()).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    await sendPromise;

    expect(component.running()).toBe(false);
    expect(component.turns()[1]).toMatchObject({
      role: "agent",
      content: "Done",
    });
  });

  it("does not send when the agent id is not present", async () => {
    fixture.componentRef.setInput("agentId", null);
    component.draftMessage.set("hi agent");

    await component["sendMessage"]();

    expect(runtimeServiceMock.createExecution).not.toHaveBeenCalled();
    expect(component.turns()).toHaveLength(0);
  });
});
