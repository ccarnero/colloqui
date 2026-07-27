import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ActivatedRoute, provideRouter, Router } from "@angular/router";
import { vi } from "vitest";
import { EWorkflowNodeType } from "../../domain/workflow-node.types";
import { createNodeFromDefault } from "../../domain/workflow-node-defaults";
import { WorkflowBuilderComponent } from "../workflow-builder.component";

/**
 * jsdom (this test env) does not implement ResizeObserver, but
 * @foblex/flow's FNodeDirective observes node size on `ngAfterViewInit` for
 * every rendered `fNode`. This is a test-only stub scoped to this spec file
 * (not a global test-config change) so nodes added after the initial render
 * can mount without the harness crashing — it does not touch any builder
 * rendering/model logic.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(
  globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }
).ResizeObserver = ResizeObserverStub;

/**
 * SPEC T05 — floating inspector. Replaces the old fixed 300px sidebar
 * container for `WorkflowNodeConfigComponent` with a floating panel over the
 * canvas; the EXISTING form logic (field bindings, `configChange`/
 * `nameChange` outputs) is reused unchanged — only the container/positioning
 * changed (T01 finding 2). This suite asserts:
 *  - open on node select / close on canvas click / Esc keyboard dismissal
 *  - a field edit driven through the embedded form reaches `flow().nodes`
 *    via the SAME `onNodeConfigChange` handler the old surface used —
 *    i.e. the model mutation is byte-identical to the pre-T05 surface.
 */
describe("WorkflowBuilderComponent — floating inspector (T05)", () => {
  let fixture: ComponentFixture<WorkflowBuilderComponent>;

  function addJsFunctionNode(): string {
    const node = createNodeFromDefault(EWorkflowNodeType.JS_FUNCTION, {
      x: 0,
      y: 0,
    });
    fixture.componentInstance.flow.update((f) => ({
      ...f,
      nodes: { ...f.nodes, [node.key]: node },
    }));
    fixture.detectChanges();
    return node.key;
  }

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

    const router = TestBed.inject(Router);
    vi.spyOn(router, "navigate").mockResolvedValue(true);

    fixture = TestBed.createComponent(WorkflowBuilderComponent);
    fixture.detectChanges();
  });

  it("does not render the floating inspector when no node is selected", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="floating-inspector"]')).toBeNull();
  });

  it("opens the floating inspector on node select", () => {
    const key = addJsFunctionNode();

    fixture.componentInstance.selectNode(key);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const panel = el.querySelector('[data-testid="floating-inspector"]');
    expect(panel).toBeTruthy();
    expect(panel!.querySelector("app-workflow-node-config")).toBeTruthy();
    expect(fixture.componentInstance.selectedNodeKey()).toBe(key);
  });

  it("closes the floating inspector when the canvas background is clicked", () => {
    const key = addJsFunctionNode();
    fixture.componentInstance.selectNode(key);
    fixture.detectChanges();

    fixture.componentInstance.onCanvasSurfaceClick();
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedNodeKey()).toBeNull();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="floating-inspector"]')).toBeNull();
  });

  it("does not deselect when a node surface click stops propagation before reaching the canvas handler", () => {
    const key = addJsFunctionNode();

    // Simulates <app-workflow-node>'s (click) binding: onNodeSurfaceClick
    // stops propagation, so it must not be immediately undone by a bubbled
    // canvas click in the same interaction.
    const stopPropagation = vi.fn();
    fixture.componentInstance.onNodeSurfaceClick(
      { stopPropagation } as unknown as MouseEvent,
      key
    );
    fixture.detectChanges();

    expect(stopPropagation).toHaveBeenCalled();
    expect(fixture.componentInstance.selectedNodeKey()).toBe(key);
  });

  it("dismisses the inspector on Esc keydown", () => {
    const key = addJsFunctionNode();
    fixture.componentInstance.selectNode(key);
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedNodeKey()).toBeNull();
  });

  it("Esc is a no-op when no node is selected", () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedNodeKey()).toBeNull();
  });

  it("Esc closes only the autocomplete dropdown first, then the inspector on a second Esc (regression: dropdown Esc must not bubble to the document listener)", () => {
    const node = createNodeFromDefault(EWorkflowNodeType.CHANNEL, {
      x: 0,
      y: 0,
    });
    // The Text (app-template-autocomplete) field only renders for outbound
    // channel nodes with messageType "text" (both defaults except direction).
    node.configuration["direction"] = "outbound";
    fixture.componentInstance.flow.update((f) => ({
      ...f,
      nodes: { ...f.nodes, [node.key]: node },
    }));
    fixture.detectChanges();

    fixture.componentInstance.selectNode(node.key);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const textarea = el.querySelector<HTMLTextAreaElement>(
      "app-template-autocomplete textarea"
    );
    expect(textarea).toBeTruthy();

    // Type "{{" to open the variable dropdown, mirroring real user input.
    textarea!.value = "{{";
    textarea!.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    expect(el.querySelector(".ta-dropdown")).toBeTruthy();

    // First real Escape keydown, dispatched on the textarea and left to
    // bubble (as it would in the browser), must only close the dropdown —
    // the inspector must stay open.
    textarea!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
    fixture.detectChanges();

    expect(el.querySelector(".ta-dropdown")).toBeNull();
    expect(fixture.componentInstance.selectedNodeKey()).toBe(node.key);
    const panelAfterFirstEsc = el.querySelector(
      '[data-testid="floating-inspector"]'
    );
    expect(panelAfterFirstEsc).toBeTruthy();

    // A second Escape (no dropdown open) reaches the document-level
    // listener and dismisses the inspector as normal.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedNodeKey()).toBeNull();
  });

  it("closes when the embedded form's close button is clicked", () => {
    const key = addJsFunctionNode();
    fixture.componentInstance.selectNode(key);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const closeBtn = el.querySelector<HTMLButtonElement>(
      ".config-header button"
    );
    expect(closeBtn).toBeTruthy();
    closeBtn!.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedNodeKey()).toBeNull();
  });

  it("routes a field edit through the embedded EXISTING form logic to the same node-model mutation as the old surface", () => {
    const key = addJsFunctionNode();
    fixture.componentInstance.selectNode(key);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const nameInput = el.querySelector<HTMLInputElement>(
      "app-workflow-node-config input[matinput], app-workflow-node-config input"
    );
    expect(nameInput).toBeTruthy();
    nameInput!.value = "Renamed via inspector";
    nameInput!.dispatchEvent(new Event("input"));
    fixture.detectChanges();

    // Same mutation path as the pre-T05 surface: (nameChange) ->
    // onNodeNameChange -> flow().nodes[key].name — untouched by T05.
    expect(fixture.componentInstance.flow().nodes[key]?.name).toBe(
      "Renamed via inspector"
    );
  });

  /**
   * SPEC T08 — the inspector's container gained a footer node id alongside
   * Remove. Shape-scoped inspector correction: the Config/Output/Runs tab
   * row this test used to assert was REMOVED (workflow-level run/output
   * UI no longer lives inside a shape panel); the config content now
   * renders directly, with no tab state at all.
   */
  it("renders the config content directly (no tab row) and the node id in the footer (T08, shape-scoped correction)", () => {
    const key = addJsFunctionNode();
    fixture.componentInstance.selectNode(key);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector(".config-tabs")).toBeNull();
    expect(el.querySelector(".config-tab")).toBeNull();
    expect(el.querySelector(".config-body input")).toBeTruthy();

    const nodeId = el.querySelector('[data-testid="inspector-node-id"]');
    expect(nodeId?.textContent?.trim()).toBe(key);

    const removeBtn = el.querySelector(".config-footer .config-remove-btn");
    expect(removeBtn).toBeTruthy();
    expect(removeBtn?.textContent).toContain("Remove");
  });

  it("drives a config field edit (JS Function code textarea) through the same onNodeConfigChange path", () => {
    const key = addJsFunctionNode();
    fixture.componentInstance.selectNode(key);
    fixture.detectChanges();

    // Exercise the same handler the old surface used directly, since the
    // embedded WorkflowNodeConfigComponent's (configChange) output and
    // WorkflowBuilderComponent.onNodeConfigChange model-mutation logic are
    // byte-identical pre/post T05 (only the container changed).
    fixture.componentInstance.onNodeConfigChange({
      key,
      field: "code",
      value: "return 42;",
    });
    fixture.detectChanges();

    expect(
      fixture.componentInstance.flow().nodes[key]?.configuration["code"]
    ).toBe("return 42;");
  });

  /**
   * Shape-scoped inspector correction — replaces the removed Output/Runs
   * tabs with a single, read-only activity strip sourced from the
   * ALREADY-FETCHED `nodeStatsByName` input (zero new requests) plus a
   * "View in Runs" deep-link. Workflow-level run/output UI (run selector,
   * output viewer, run lists) no longer renders inside a shape panel at
   * all — see `manual-loops/admin-console/design/proposals/if-editor-shape-scoped.html`.
   */
  describe("Activity strip", () => {
    function selectNodeWithWorkflowId(): string {
      const key = addJsFunctionNode();
      fixture.componentInstance.flow.update((f) => ({ ...f, key: "wf-1" }));
      fixture.componentInstance.selectNode(key);
      fixture.detectChanges();
      return key;
    }

    it("renders from the already-fetched nodeStatsByName signal, with zero extra requests", () => {
      selectNodeWithWorkflowId();
      fixture.componentInstance.nodeStatsByName.set({
        "JS Function": {
          state: "ready",
          primaryLabel: "23 runs",
          secondaryLabel: "p95: 395ms",
          status: "ok",
        },
      });
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const strip = el.querySelector('[data-testid="activity-strip"]');
      expect(strip?.textContent).toContain("23 runs");
      expect(strip?.textContent).toContain("p95: 395ms");
      expect(strip?.textContent).toContain("ok");

      // Never a fetch of its own — reuses the input the node-card footer
      // already populated. Asserts no leftover Output/Runs-tab-era request
      // (executions list, execution detail, node-runs) went out, without
      // asserting on this component's OTHER, unrelated setup requests
      // (channel accounts, adapters, agents…).
      const http = TestBed.inject(HttpTestingController);
      const removedTabRequests = http
        .match(() => true)
        .filter(
          (r) =>
            r.request.url.includes("/executions") ||
            r.request.url.includes("/node-runs")
        );
      expect(removedTabRequests).toHaveLength(0);
    });

    it("is hidden entirely when there is no stats row for this node (never renders fabricated zeros)", () => {
      selectNodeWithWorkflowId();
      fixture.componentInstance.nodeStatsByName.set({});
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('[data-testid="activity-strip"]')).toBeNull();
    });

    it("'View in Runs' navigates to the executions tab with a ?node= query param naming the action", () => {
      selectNodeWithWorkflowId();
      fixture.componentInstance.nodeStatsByName.set({
        "JS Function": {
          state: "ready",
          primaryLabel: "23 runs",
          status: "ok",
        },
      });
      fixture.detectChanges();

      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, "navigate");

      const el = fixture.nativeElement as HTMLElement;
      const link = el.querySelector<HTMLButtonElement>(
        '[data-testid="activity-view-in-runs"]'
      );
      expect(link).toBeTruthy();
      link!.click();
      fixture.detectChanges();

      expect(navigateSpy).toHaveBeenCalledWith(
        ["/workflows", "wf-1", "executions"],
        { queryParams: { node: "JS Function" } }
      );
    });
  });

  /**
   * IF-editor round-2 task, Workstream A regression: the comparator pill
   * is now a styled native <select> (was a mat-form-field/mat-select) —
   * this asserts it still writes the SAME frozen branch model
   * ({ label, condition: { variable, comparator, value } }) the
   * serializer/deserializer/round-trip spec depends on, unchanged by the
   * control swap.
   */
  it("comparator pill (native select) and value pill still write the frozen branch condition model", () => {
    const node = createNodeFromDefault(EWorkflowNodeType.CONDITIONAL, {
      x: 0,
      y: 0,
    });
    fixture.componentInstance.flow.update((f) => ({
      ...f,
      nodes: { ...f.nodes, [node.key]: node },
    }));
    fixture.detectChanges();
    fixture.componentInstance.selectNode(node.key);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const addBranchBtn = Array.from(el.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Add branch")
    );
    expect(addBranchBtn).toBeTruthy();
    (addBranchBtn as HTMLButtonElement).click();
    fixture.detectChanges();

    const comparatorSelect = el.querySelector<HTMLSelectElement>(
      ".bc-comparator-select"
    );
    expect(comparatorSelect).toBeTruthy();
    comparatorSelect!.value = "neq";
    comparatorSelect!.dispatchEvent(new Event("change"));
    fixture.detectChanges();

    const valueInput = el.querySelector<HTMLInputElement>(".bc-value-input");
    expect(valueInput).toBeTruthy();
    valueInput!.value = "gold";
    valueInput!.dispatchEvent(new Event("input"));
    fixture.detectChanges();

    const branches = fixture.componentInstance.flow().nodes[node.key]
      ?.configuration["branches"] as Array<{
      label: string;
      condition: { variable: string; comparator: string; value: string };
    }>;
    expect(branches).toHaveLength(1);
    expect(branches[0]?.condition.comparator).toBe("neq");
    expect(branches[0]?.condition.value).toBe("gold");
  });
});
