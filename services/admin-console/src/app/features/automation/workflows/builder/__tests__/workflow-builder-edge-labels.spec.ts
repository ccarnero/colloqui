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
 * T04 — edge labels rendered strictly from real IWorkflowConnection.label
 * metadata (T01 finding 2). No label field is ever fabricated.
 */
describe("WorkflowBuilderComponent — edge labels (T04)", () => {
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
        "conn-labeled": {
          key: "conn-labeled",
          source: "node-a",
          target: "node-b",
          type: EWorkflowConnectionType.DEFAULT,
          label: 'text contains "precio"',
        },
        "conn-unlabeled": {
          key: "conn-unlabeled",
          source: "node-a",
          target: "node-c",
          type: EWorkflowConnectionType.DEFAULT,
        },
      },
    });
    fixture.detectChanges();
  });

  it("renders a label for a connection that carries real label metadata", () => {
    const el = fixture.nativeElement as HTMLElement;
    const labels = Array.from(el.querySelectorAll(".wf-edge-label")).map((n) =>
      n.textContent?.trim()
    );
    expect(labels).toContain('text contains "precio"');
  });

  it("renders no label element for a connection without label metadata", () => {
    const el = fixture.nativeElement as HTMLElement;
    const labels = el.querySelectorAll(".wf-edge-label");
    // Only the single labeled connection produces a label element - the
    // second connection (no `label` field) must not invent one.
    expect(labels.length).toBe(1);
  });
});
