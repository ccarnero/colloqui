import { Component } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { FFlowModule } from "@foblex/flow";
import { describe, expect, it } from "vitest";
import type { IWorkflowNode } from "../../../../domain/workflow-node.types";
import { EWorkflowNodeType } from "../../../../domain/workflow-node.types";
import { WorkflowNodeCardComponent } from "../workflow-node-card.component";
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
 * card is rendered inside a minimal host tree rather than in isolation.
 */
@Component({
  selector: "app-workflow-node-card-test-host",
  imports: [FFlowModule, WorkflowNodeCardComponent],
  template: `
    <f-flow>
      <f-canvas>
        @if (stats) {
          <app-workflow-node-card
            fNode
            [fNodePosition]="node.position"
            [node]="node"
            [hasError]="hasError"
            [isSelected]="isSelected"
            [stats]="stats"
          />
        } @else {
          <app-workflow-node-card
            fNode
            [fNodePosition]="node.position"
            [node]="node"
            [hasError]="hasError"
            [isSelected]="isSelected"
          />
        }
      </f-canvas>
    </f-flow>
  `,
})
class WorkflowNodeCardTestHostComponent {
  node: IWorkflowNode = makeNode();
  hasError = false;
  isSelected = false;
  // Undefined by default so the card falls through to its own
  // PLACEHOLDER_NODE_CARD_STATS default (SPEC T03) - only set this to
  // exercise the T07 real-data override path.
  stats: IWorkflowNodeStats | undefined = undefined;
}

/**
 * SPEC T03 (console-redesign-builder-v2.md) — fresh node card component
 * ported from design/builder-v2-reference/node-card.html + node-card.css.
 */
describe("WorkflowNodeCardComponent", () => {
  let fixture: ComponentFixture<WorkflowNodeCardTestHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkflowNodeCardTestHostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(WorkflowNodeCardTestHostComponent);
  });

  describe("variant rendering table (type -> icon / badge / accent)", () => {
    // Badge is deliberately NOT rendered for every type - SPEC T03 anatomy
    // is "TRIGGER / IF / AGENT / none" (mirrors node-card.html: Send Reply
    // / Fallback Message render no tag chip at all). A plain outbound
    // CHANNEL node (not the trigger) and every neutral-fallback type
    // (JS_FUNCTION, etc.) therefore expect `undefined` here.
    const cases: Array<{
      type: EWorkflowNodeType;
      expectedAccent: string;
      expectedTint: string;
      expectedBadge: string | undefined;
    }> = [
      {
        type: EWorkflowNodeType.CHANNEL,
        expectedAccent: "var(--rd-green)",
        expectedTint: "var(--rd-green-dim)",
        expectedBadge: undefined,
      },
      {
        type: EWorkflowNodeType.CONDITIONAL,
        expectedAccent: "var(--rd-yellow)",
        expectedTint: "var(--rd-yellow-dim)",
        expectedBadge: "IF",
      },
      {
        type: EWorkflowNodeType.AGENT_CALL,
        expectedAccent: "var(--rd-purple)",
        expectedTint: "var(--rd-purple-dim)",
        expectedBadge: "AGENT",
      },
      {
        type: EWorkflowNodeType.JS_FUNCTION,
        expectedAccent: "var(--rd-text-3)",
        expectedTint: "var(--rd-hover)",
        expectedBadge: undefined,
      },
    ];

    for (const testCase of cases) {
      it(`renders ${testCase.type} with its accent/tint/badge`, () => {
        fixture.componentInstance.node = makeNode({ type: testCase.type });
        fixture.detectChanges();

        const el = fixture.nativeElement as HTMLElement;
        const iconChip = el.querySelector<HTMLElement>(
          ".wf-node-card__icon-chip"
        );
        const icon = el.querySelector<HTMLElement>(".wf-node-card__icon");
        const port = el.querySelector<HTMLElement>(".wf-node-card__port--top");
        const badge = el.querySelector<HTMLElement>(
          '[data-testid="wf-node-card-badge"]'
        );

        expect(iconChip?.style.background).toBe(testCase.expectedTint);
        expect(icon?.style.color).toBe(testCase.expectedAccent);
        expect(port?.style.borderColor).toBe(testCase.expectedAccent);
        if (testCase.expectedBadge === undefined) {
          expect(badge).toBeNull();
        } else {
          expect(badge?.style.color).toBe(testCase.expectedAccent);
          expect(badge?.textContent?.trim()).toBe(testCase.expectedBadge);
        }
      });
    }
  });

  it("renders the leading icon glyph from node().icon", () => {
    fixture.componentInstance.node = makeNode({ icon: "http" });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector(".wf-node-card__icon")?.textContent?.trim()).toBe(
      "http"
    );
  });

  it("shows TRIGGER for the inbound-channel trigger node", () => {
    fixture.componentInstance.node = makeNode({
      type: EWorkflowNodeType.CHANNEL,
      configuration: { direction: "inbound" },
    });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const badge = el.querySelector('[data-testid="wf-node-card-badge"]');
    expect(badge?.textContent?.trim()).toBe("TRIGGER");
  });

  it("shows no badge at all for an outbound (non-trigger) channel node", () => {
    fixture.componentInstance.node = makeNode({
      type: EWorkflowNodeType.CHANNEL,
      configuration: { direction: "outbound", channel: "telegram" },
    });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="wf-node-card-badge"]')).toBeNull();
  });

  it("truncates a long node name via CSS ellipsis (title node has no-wrap/overflow-hidden markup)", () => {
    const longName =
      "An extremely long workflow node name that should truncate visually";
    fixture.componentInstance.node = makeNode({ name: longName });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const title = el.querySelector<HTMLElement>(".wf-node-card__title");
    expect(title?.textContent?.trim()).toBe(longName);
    const style = getComputedStyle(title as HTMLElement);
    expect(style.whiteSpace).toBe("nowrap");
    expect(style.textOverflow).toBe("ellipsis");
    expect(style.overflow).toBe("hidden");
  });

  describe("config summary (summarizeNodeConfig per type)", () => {
    it("renders the one-line mono config summary when the node has meaningful config", () => {
      fixture.componentInstance.node = makeNode({
        type: EWorkflowNodeType.ENDPOINT_CALL,
        configuration: { method: "GET", url: "https://api.example.com/user" },
      });
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const summary = el.querySelector('[data-testid="wf-node-card-summary"]');
      expect(summary?.textContent?.trim()).toBe("GET · api.example.com");
    });

    it("hides the config summary line entirely for the empty case", () => {
      fixture.componentInstance.node = makeNode({
        type: EWorkflowNodeType.ENDPOINT_CALL,
        configuration: { method: "", url: "" },
      });
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(
        el.querySelector('[data-testid="wf-node-card-summary"]')
      ).toBeNull();
    });
  });

  describe("footer stats (SPEC T03 static placeholder)", () => {
    it("renders the placeholder stats row by default (no stats input passed)", () => {
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const stats = el.querySelector('[data-testid="wf-node-card-stats"]');
      expect(stats?.textContent).toContain("— runs");
      expect(stats?.textContent).toContain("—");
      expect(
        el.querySelector('[data-testid="wf-node-card-status"]')
      ).toBeTruthy();
    });

    it("renders a real stats value when one is provided (T07 wiring path)", () => {
      fixture.componentInstance.stats = {
        state: "ready",
        primaryLabel: "1,842 runs",
        secondaryLabel: "p95: 620ms",
        status: "ok",
      };
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const stats = el.querySelector('[data-testid="wf-node-card-stats"]');
      expect(stats?.textContent).toContain("1,842 runs");
      expect(stats?.textContent).toContain("p95: 620ms");
      expect(el.querySelector(".wf-node-card__status.is-ok")).toBeTruthy();
    });

    it("renders the skeleton/neutral row for the loading state (never zeros presented as facts)", () => {
      fixture.componentInstance.stats = { state: "loading", primaryLabel: "" };
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(
        el.querySelector('[data-testid="wf-node-card-stats-skeleton"]')
      ).toBeTruthy();
      expect(
        el.querySelector('[data-testid="wf-node-card-status"]')
      ).toBeNull();
    });

    it("hides the footer row entirely for the hidden state (error / zero-runs / no-match)", () => {
      fixture.componentInstance.stats = { state: "hidden", primaryLabel: "" };
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('[data-testid="wf-node-card-stats"]')).toBeNull();
    });
  });

  describe("selection / error state", () => {
    it("adds the is-selected class and accent border when isSelected is true", () => {
      fixture.componentInstance.isSelected = true;
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const card = el.querySelector<HTMLElement>(".wf-node-card");
      expect(card?.classList.contains("is-selected")).toBe(true);
      expect(card?.style.borderColor).toBe("var(--rd-accent)");
    });

    it("adds the has-error class and error border, taking priority over selection", () => {
      fixture.componentInstance.isSelected = true;
      fixture.componentInstance.hasError = true;
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const card = el.querySelector<HTMLElement>(".wf-node-card");
      expect(card?.classList.contains("has-error")).toBe(true);
      expect(card?.style.borderColor).toBe("var(--rd-red)");
    });

    it("uses the neutral border by default (not the type accent)", () => {
      fixture.componentInstance.node = makeNode({
        type: EWorkflowNodeType.CHANNEL,
      });
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const card = el.querySelector<HTMLElement>(".wf-node-card");
      expect(card?.style.borderColor).toBe("var(--rd-line-3)");
    });
  });

  describe("ports (Foblex connector ids unchanged)", () => {
    it("emits the same fInputId/fOutputId connector ids as the node key", () => {
      fixture.componentInstance.node = makeNode({ key: "wf_node_abc" });
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const input = el.querySelector("[data-f-input-id]");
      const output = el.querySelector("[data-f-output-id]");
      expect(input?.getAttribute("data-f-input-id")).toBe("wf_node_abc-in");
      expect(output?.getAttribute("data-f-output-id")).toBe("wf_node_abc-out");
    });

    it("renders ports on the top/bottom edges (PRESERVE item 1: vertical flow)", () => {
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector(".wf-node-card__port--top")).toBeTruthy();
      expect(el.querySelector(".wf-node-card__port--bottom")).toBeTruthy();
    });

    // Asserted via the component's own isMultiOutput() computed rather than
    // @foblex/flow's "f-node-output-multiple" DOM class: that host class
    // binding calls the raw "multiple" signal reference (always truthy,
    // since it never invokes the signal function), so it renders "true" on
    // every output regardless of the bound value - not a meaningful DOM
    // assertion. isMultiOutput() is the same expression fOutputMultiple is
    // bound to, so this still proves the fan-out logic per node type.
    it("marks the output as multiple for a BRANCH node (fan-out)", () => {
      fixture.componentInstance.node = makeNode({
        type: EWorkflowNodeType.BRANCH,
      });
      fixture.detectChanges();

      const card = fixture.debugElement.query(
        By.directive(WorkflowNodeCardComponent)
      ).componentInstance as WorkflowNodeCardComponent;
      expect(card.isMultiOutput()).toBe(true);
    });

    it("marks the output as multiple for a CONDITIONAL node (fan-out)", () => {
      fixture.componentInstance.node = makeNode({
        type: EWorkflowNodeType.CONDITIONAL,
      });
      fixture.detectChanges();

      const card = fixture.debugElement.query(
        By.directive(WorkflowNodeCardComponent)
      ).componentInstance as WorkflowNodeCardComponent;
      expect(card.isMultiOutput()).toBe(true);
    });

    it("does not mark the output as multiple for a plain CHANNEL node", () => {
      fixture.componentInstance.node = makeNode({
        type: EWorkflowNodeType.CHANNEL,
      });
      fixture.detectChanges();

      const card = fixture.debugElement.query(
        By.directive(WorkflowNodeCardComponent)
      ).componentInstance as WorkflowNodeCardComponent;
      expect(card.isMultiOutput()).toBe(false);
    });
  });
});
