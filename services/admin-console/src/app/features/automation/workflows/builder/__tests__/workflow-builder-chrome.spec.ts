import { provideHttpClient } from "@angular/common/http";
import { provideHttpClientTesting } from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ActivatedRoute, provideRouter, Router } from "@angular/router";
import { vi } from "vitest";
import { EWorkflowNodeType } from "../../domain/workflow-node.types";
import { WorkflowBuilderComponent } from "../workflow-builder.component";

/**
 * jsdom has no ResizeObserver; @foblex/flow's FNodeDirective observes node
 * size on mount, needed once this suite renders an actual node card.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??=
  ResizeObserverStub;

/**
 * T03 — floating chrome (back / workflow name / save state) rendered over
 * the full-bleed canvas. Save state reuses only the `saving` signal + the
 * already-tracked `flow().key` (empty until the first successful save) —
 * see the `saveStateLabel` computed on WorkflowBuilderComponent; no new
 * dirty-tracking state was introduced.
 */
describe("WorkflowBuilderComponent — floating chrome (T03)", () => {
  let fixture: ComponentFixture<WorkflowBuilderComponent>;
  let router: Router;

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

    router = TestBed.inject(Router);
    vi.spyOn(router, "navigate").mockResolvedValue(true);

    fixture = TestBed.createComponent(WorkflowBuilderComponent);
    fixture.detectChanges();
  });

  it("renders the workflow name in the floating chrome", () => {
    const el = fixture.nativeElement as HTMLElement;
    const nameInput = el.querySelector<HTMLInputElement>(
      ".builder-title-input"
    );
    expect(nameInput).toBeTruthy();
    expect(nameInput!.value).toBe("New Workflow");
  });

  it("renders 'Unsaved' when the workflow has no persisted key yet", () => {
    const el = fixture.nativeElement as HTMLElement;
    const saveState = el.querySelector('[data-testid="builder-save-state"]');
    expect(saveState?.textContent).toContain("Unsaved");
  });

  it("renders 'Saved' once the workflow has a persisted key", () => {
    fixture.componentInstance.flow.update((f) => ({ ...f, key: "wf-1" }));
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const saveState = el.querySelector('[data-testid="builder-save-state"]');
    expect(saveState?.textContent).toContain("Saved");
    expect(saveState?.textContent).not.toContain("Unsaved");
  });

  it("renders 'Saving…' while a save is in flight", () => {
    fixture.componentInstance.saving.set(true);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const saveState = el.querySelector('[data-testid="builder-save-state"]');
    expect(saveState?.textContent).toContain("Saving");
  });

  it("navigates back to /workflows when the back button is clicked", () => {
    const el = fixture.nativeElement as HTMLElement;
    const backButton = el.querySelector<HTMLButtonElement>(
      '[aria-label="Back to workflows"]'
    );
    expect(backButton).toBeTruthy();

    backButton!.click();

    expect(router.navigate).toHaveBeenCalledWith(["/workflows"]);
  });

  it("renders zoom controls wired to the canvas zoom API", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[aria-label="Zoom in"]')).toBeTruthy();
    expect(el.querySelector('[aria-label="Zoom out"]')).toBeTruthy();
    expect(el.querySelector(".zoom-readout")?.textContent).toContain("%");
  });

  /**
   * T03 — "N nodes" pill (T01 finding 10). No "valid" prefix: the builder
   * only computes validationErrors from saveWorkflow(), so claiming
   * "valid" before any save would invent an unverified state.
   */
  it("renders the node-count pill with 0 nodes on a fresh canvas", () => {
    const el = fixture.nativeElement as HTMLElement;
    const pill = el.querySelector('[data-testid="builder-node-count-pill"]');
    expect(pill).toBeTruthy();
    expect(pill!.textContent).toContain("0 nodes");
    expect(pill!.textContent).not.toContain("valid");
  });

  it("updates the node-count pill as nodes are added", () => {
    fixture.componentInstance.flow.update((f) => ({
      ...f,
      nodes: {
        "n-1": {
          key: "n-1",
          type: EWorkflowNodeType.CHANNEL,
          name: "n1",
          icon: "swap_horiz",
          position: { x: 0, y: 0 },
          configuration: {},
        },
      },
    }));
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const pill = el.querySelector('[data-testid="builder-node-count-pill"]');
    expect(pill!.textContent).toContain("1 nodes");
  });

  /**
   * Regression — after T08's two-row topbar, the builder still assumed a
   * 52px header (host height calc) and the floating top chrome overlapped
   * the collapsed Variables Reference panel, rendering its text clipped
   * behind the pills. jsdom does no layout, so these assert against the
   * component's compiled stylesheet (injected into document.head by
   * Angular) — a tripwire against reintroducing the stale hard-coded
   * offsets, not a pixel test.
   */
  describe("full-bleed offsets vs the two-row topbar (regression)", () => {
    function builderStyleText(): string {
      return Array.from(document.head.querySelectorAll("style"))
        .map((s) => s.textContent ?? "")
        .filter((t) => t.includes(".builder-shell"))
        .join("\n");
    }

    it("derives the host height from the shared --rd-topbar-h token, not a hard-coded 52px header", () => {
      const css = builderStyleText();
      expect(css).toContain("calc(100dvh - var(--rd-topbar-h");
      expect(css).not.toContain("100dvh - 52px");
    });

    it("clears the floating top chrome above the variables-reference panel", () => {
      const css = builderStyleText();
      const vrRule = css
        .split("}")
        .find((rule) => rule.includes("app-variables-reference"));
      expect(vrRule).toBeTruthy();
      expect(vrRule).toContain("margin-top");
      expect(vrRule).toContain("var(--rd-space-8)");
    });

    it("still renders the variables-reference panel inside the canvas wrap", () => {
      const el = fixture.nativeElement as HTMLElement;
      const vr = el.querySelector(
        ".builder-canvas-wrap app-variables-reference"
      );
      expect(vr).toBeTruthy();
    });
  });
});
