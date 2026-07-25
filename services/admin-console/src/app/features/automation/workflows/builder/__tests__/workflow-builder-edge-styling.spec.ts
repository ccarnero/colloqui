import { provideHttpClient } from "@angular/common/http";
import { provideHttpClientTesting } from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ActivatedRoute, provideRouter } from "@angular/router";
import { describe, expect, it } from "vitest";
import {
  EWorkflowConnectionType,
  EWorkflowNodeType,
} from "../../domain/workflow-node.types";
import { WorkflowBuilderComponent } from "../workflow-builder.component";

/**
 * jsdom has no ResizeObserver; @foblex/flow's FNodeDirective observes node
 * size on mount. This test-only stub is scoped to this spec file so real
 * nodes can render inside the canvas without crashing.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??=
  ResizeObserverStub;

/**
 * T04 — edge styling classes bind purely off the connection's existing
 * label metadata (via resolveEdgeVisualState()) and never change the
 * connection ids Foblex uses for its own mechanics (fConnectionId /
 * fOutputId / fInputId).
 */
describe("WorkflowBuilderComponent — edge styling (T04)", () => {
  let fixture: ComponentFixture<WorkflowBuilderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkflowBuilderComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map() }, parent: null },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WorkflowBuilderComponent);
    fixture.componentInstance.flow.set({
      key: "wf-1",
      name: "Test workflow",
      application: "default",
      nodes: {
        "node-a": {
          key: "node-a",
          type: EWorkflowNodeType.CONDITIONAL,
          name: "Check price",
          icon: "call_split",
          position: { x: 0, y: 0 },
          configuration: {},
        },
        "node-b": {
          key: "node-b",
          type: EWorkflowNodeType.CHANNEL,
          name: "Send message",
          icon: "chat",
          position: { x: 300, y: 0 },
          configuration: {},
        },
        "node-c": {
          key: "node-c",
          type: EWorkflowNodeType.CHANNEL,
          name: "Send fallback",
          icon: "chat",
          position: { x: 300, y: 200 },
          configuration: {},
        },
      },
      connections: {
        "conn-matched": {
          key: "conn-matched",
          source: "node-a",
          target: "node-b",
          type: EWorkflowConnectionType.DEFAULT,
          label: 'text contains "precio"',
        },
        "conn-default": {
          key: "conn-default",
          source: "node-a",
          target: "node-c",
          type: EWorkflowConnectionType.DEFAULT,
          label: "default",
        },
      },
    });
    fixture.detectChanges();
  });

  it("marks only the connection carrying the literal default label with wf-edge--default", () => {
    const el = fixture.nativeElement as HTMLElement;
    const defaultEdge = el.querySelector("f-connection.wf-edge--default");
    expect(defaultEdge).not.toBeNull();
    expect(defaultEdge?.id).toBe("conn-default");

    const matchedEdge = el.querySelector(
      'f-connection[id="conn-matched"]'
    ) as HTMLElement | null;
    expect(matchedEdge).not.toBeNull();
    expect(matchedEdge?.classList.contains("wf-edge--default")).toBe(false);
  });

  it("does not change the connection ids Foblex uses for its own mechanics", () => {
    const el = fixture.nativeElement as HTMLElement;
    const ids = Array.from(el.querySelectorAll("f-connection")).map(
      (n) => n.id
    );
    expect(ids.sort()).toEqual(["conn-default", "conn-matched"]);
  });
});
