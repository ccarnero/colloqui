import { Component } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { FFlowModule } from "@foblex/flow";
import { describe, expect, it } from "vitest";
import type { IWorkflowNode } from "../../../../domain/workflow-node.types";
import { EWorkflowNodeType } from "../../../../domain/workflow-node.types";
import { WorkflowNodeComponent } from "../workflow-node.component";
import type { IWorkflowNodeStats } from "../workflow-node-stats.types";

/**
 * jsdom (the test environment) has no ResizeObserver; @foblex/flow's
 * FNodeDirective observes node size on mount. This test-only stub is
 * scoped to this spec file (not a global config change) so a real
 * <f-flow>/<f-canvas>/fNode tree can mount without crashing.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??=
  ResizeObserverStub;

function makeNode(overrides: Partial<IWorkflowNode> = {}): IWorkflowNode {
  return {
    key: "node-1",
    type: EWorkflowNodeType.CHANNEL,
    name: "Send message",
    icon: "chat",
    position: { x: 0, y: 0 },
    configuration: {},
    ...overrides,
  };
}

/**
 * fNodeInput/fNodeOutput require an ancestor <f-flow>/<f-canvas> providing
 * FMediator via provideFFlow()'s component-tree providers, so the node
 * component is rendered inside a minimal host tree rather than in
 * isolation.
 */
@Component({
  selector: "app-workflow-node-test-host",
  imports: [FFlowModule, WorkflowNodeComponent],
  template: `
    <f-flow>
      <f-canvas>
        <app-workflow-node
          fNode
          [fNodePosition]="node.position"
          [node]="node"
          [hasError]="hasError"
          [isSelected]="isSelected"
          [stats]="stats"
        />
      </f-canvas>
    </f-flow>
  `,
})
class WorkflowNodeTestHostComponent {
  node: IWorkflowNode = makeNode();
  hasError = false;
  isSelected = false;
  stats: IWorkflowNodeStats | undefined = undefined;
}

/**
 * T04 — colored ports/accents (decision 4, AMENDED) and per-node mini-stats
 * badge (decision 5, hidden-when-no-data rendering path).
 */
describe("WorkflowNodeComponent", () => {
  let fixture: ComponentFixture<WorkflowNodeTestHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkflowNodeTestHostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(WorkflowNodeTestHostComponent);
  });

  it("colors the border and ports with the channel accent for a CHANNEL node", () => {
    fixture.componentInstance.node = makeNode({
      type: EWorkflowNodeType.CHANNEL,
    });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const card = el.querySelector<HTMLElement>(".wf-builder-node");
    const input = el.querySelector<HTMLElement>(".wf-node-input");
    expect(card?.style.borderColor).toBe("var(--rd-green)");
    expect(input?.style.background).toBe("var(--rd-green)");
  });

  it("falls back to the neutral accent token for a node type without a dedicated color", () => {
    fixture.componentInstance.node = makeNode({
      type: EWorkflowNodeType.JS_FUNCTION,
    });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const card = el.querySelector<HTMLElement>(".wf-builder-node");
    expect(card?.style.borderColor).toBe("var(--rd-text-3)");
  });

  it("prioritizes the error border color over the type accent", () => {
    fixture.componentInstance.node = makeNode({
      type: EWorkflowNodeType.CHANNEL,
    });
    fixture.componentInstance.hasError = true;
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const card = el.querySelector<HTMLElement>(".wf-builder-node");
    expect(card?.style.borderColor).toBe("var(--rd-red)");
  });

  it("hides the mini-stats badge when no stats input is provided", () => {
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="wf-node-stats"]')).toBeNull();
  });

  it("renders the mini-stats badge when stats are provided", () => {
    fixture.componentInstance.stats = {
      primaryLabel: "1,842 runs",
      secondaryLabel: "24h: 312",
      status: "ok",
    };
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const badge = el.querySelector('[data-testid="wf-node-stats"]');
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toContain("1,842 runs");
    expect(badge?.textContent).toContain("24h: 312");
    expect(el.querySelector(".wf-node-stats-dot.is-ok")).toBeTruthy();
  });

  /**
   * T03 — mock-parity node card: leading icon chip (reuse node().icon,
   * unchanged), type badge (short type label, or TRIGGER for the trigger
   * node), one-line mono config summary from summarizeNodeConfig.
   */
  it("renders the leading icon chip from node().icon", () => {
    fixture.componentInstance.node = makeNode({ icon: "http" });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(
      el.querySelector(".wf-node-icon-wrap mat-icon")?.textContent?.trim()
    ).toBe("http");
  });

  it("shows the short type label as the type badge for a non-trigger node", () => {
    fixture.componentInstance.node = makeNode({
      type: EWorkflowNodeType.JS_FUNCTION,
    });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const badge = el.querySelector('[data-testid="wf-node-type-badge"]');
    expect(badge?.textContent?.trim()).toBe("JS");
  });

  it("shows TRIGGER for the inbound-channel trigger node instead of the short label", () => {
    fixture.componentInstance.node = makeNode({
      type: EWorkflowNodeType.CHANNEL,
      configuration: { direction: "inbound" },
    });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const badge = el.querySelector('[data-testid="wf-node-type-badge"]');
    expect(badge?.textContent?.trim()).toBe("TRIGGER");
  });

  it("shows CHAN (not TRIGGER) for an outbound channel node", () => {
    fixture.componentInstance.node = makeNode({
      type: EWorkflowNodeType.CHANNEL,
      configuration: { direction: "outbound", channel: "whatsapp" },
    });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const badge = el.querySelector('[data-testid="wf-node-type-badge"]');
    expect(badge?.textContent?.trim()).toBe("CHAN");
  });

  it("colors the type badge with the same accent token as the border/ports", () => {
    fixture.componentInstance.node = makeNode({
      type: EWorkflowNodeType.AGENT_CALL,
    });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const badge = el.querySelector<HTMLElement>(
      '[data-testid="wf-node-type-badge"]'
    );
    expect(badge?.style.color).toBe("var(--rd-purple)");
  });

  it("renders the one-line mono config summary when the node has meaningful config", () => {
    fixture.componentInstance.node = makeNode({
      type: EWorkflowNodeType.ENDPOINT_CALL,
      configuration: { method: "GET", url: "https://api.example.com/user" },
    });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const summary = el.querySelector('[data-testid="wf-node-summary"]');
    expect(summary?.textContent?.trim()).toBe("GET · api.example.com");
  });

  it("hides the config summary line entirely when there is nothing meaningful to show", () => {
    fixture.componentInstance.node = makeNode({
      type: EWorkflowNodeType.ENDPOINT_CALL,
      configuration: { method: "", url: "" },
    });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="wf-node-summary"]')).toBeNull();
  });
});
