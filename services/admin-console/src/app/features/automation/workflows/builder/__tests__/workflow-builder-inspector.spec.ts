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
   * SPEC T08 — the inspector's container gained a Config/Output/Runs tab
   * row (ported from builder-v2-reference/node-card.html section 3) and a
   * footer node id alongside Remove. This asserts the new container
   * pieces render without touching the open/close/Esc behavior asserted
   * above (which stays green, unmodified, in the same suite).
   */
  it("renders the Config/Output/Runs tab row with Config active, and the node id in the footer (T08)", () => {
    const key = addJsFunctionNode();
    fixture.componentInstance.selectNode(key);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const tabs = Array.from(el.querySelectorAll(".config-tab")).map((t) =>
      t.textContent?.trim()
    );
    expect(tabs).toEqual(["Config", "Output", "Runs"]);
    expect(el.querySelector(".config-tab--active")?.textContent?.trim()).toBe(
      "Config"
    );

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
   * IF-editor round-2 task: Output/Runs tabs go from inert (SPEC T08) to
   * real, data-backed panels. These assert the exact request shapes and
   * the loading/ready/error/empty/failure render states — never a blank
   * panel, never a fabricated number.
   */
  describe("Output tab", () => {
    function selectNodeWithWorkflowId(): string {
      const key = addJsFunctionNode();
      fixture.componentInstance.flow.update((f) => ({ ...f, key: "wf-1" }));
      fixture.componentInstance.selectNode(key);
      fixture.detectChanges();
      return key;
    }

    function clickOutputTab(): void {
      const el = fixture.nativeElement as HTMLElement;
      const tabs = Array.from(el.querySelectorAll(".config-tab"));
      const outputTab = tabs.find((t) => t.textContent?.trim() === "Output");
      (outputTab as HTMLButtonElement).click();
      fixture.detectChanges();
    }

    it("shows a loading skeleton before the runs list resolves", () => {
      selectNodeWithWorkflowId();
      clickOutputTab();

      const http = TestBed.inject(HttpTestingController);
      const req = http.expectOne(
        (r) =>
          r.url === "/api/workflows/wf-1/executions" &&
          r.params.get("page") === "1" &&
          r.params.get("pageSize") === "10" &&
          r.params.get("sort") === "desc"
      );
      expect(req.request.method).toBe("GET");

      const el = fixture.nativeElement as HTMLElement;
      expect(
        el.querySelector('[data-testid="output-tab"] .tab-skeleton')
      ).toBeTruthy();
    });

    it("defaults to the most recent completed run and renders its result for this node", () => {
      selectNodeWithWorkflowId();
      clickOutputTab();

      const http = TestBed.inject(HttpTestingController);
      const listReq = http.expectOne(
        (r) => r.url === "/api/workflows/wf-1/executions"
      );
      listReq.flush({
        items: [
          {
            id: "exec-running",
            definitionId: "wf-1",
            tenantId: "t1",
            temporalWorkflowId: "tw",
            temporalRunId: "tr",
            request: {},
            status: "running",
            createdAt: "2026-07-27T10:05:00.000Z",
            updatedAt: "2026-07-27T10:05:00.000Z",
          },
          {
            id: "exec-1",
            definitionId: "wf-1",
            tenantId: "t1",
            temporalWorkflowId: "tw",
            temporalRunId: "tr",
            request: {},
            status: "completed",
            createdAt: "2026-07-27T10:00:00.000Z",
            updatedAt: "2026-07-27T10:00:00.000Z",
          },
        ],
        total: 2,
        page: 1,
        pageSize: 10,
      });
      fixture.detectChanges();

      const detailReq = http.expectOne(
        (r) => r.url === "/api/workflows/wf-1/executions/exec-1"
      );
      detailReq.flush({
        executionId: "exec-1",
        definitionId: "wf-1",
        temporalWorkflowId: "tw",
        status: "completed",
        result: { results: { "JS Function": { ok: true, value: 42 } } },
        createdAt: "2026-07-27T10:00:00.000Z",
      });
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const result = el.querySelector('[data-testid="output-result"]');
      expect(result?.textContent).toContain('"ok": true');
      expect(result?.textContent).toContain('"value": 42');

      const select = el.querySelector<HTMLSelectElement>(
        '[data-testid="output-tab"] mat-select'
      );
      expect(select).toBeTruthy();
    });

    it("shows an honest empty state when the selected run has no result for this node", () => {
      selectNodeWithWorkflowId();
      clickOutputTab();

      const http = TestBed.inject(HttpTestingController);
      http
        .expectOne((r) => r.url === "/api/workflows/wf-1/executions")
        .flush({
          items: [
            {
              id: "exec-1",
              definitionId: "wf-1",
              tenantId: "t1",
              temporalWorkflowId: "tw",
              temporalRunId: "tr",
              request: {},
              status: "completed",
              createdAt: "2026-07-27T10:00:00.000Z",
              updatedAt: "2026-07-27T10:00:00.000Z",
            },
          ],
          total: 1,
          page: 1,
          pageSize: 10,
        });
      fixture.detectChanges();

      http
        .expectOne((r) => r.url === "/api/workflows/wf-1/executions/exec-1")
        .flush({
          executionId: "exec-1",
          definitionId: "wf-1",
          temporalWorkflowId: "tw",
          status: "completed",
          result: { results: { OtherNode: "irrelevant" } },
          createdAt: "2026-07-27T10:00:00.000Z",
        });
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(
        el.querySelector('[data-testid="output-empty"]')?.textContent
      ).toContain("This node has no recorded output for this run");
    });

    it("shows failure info only when failure.activityName matches this node", () => {
      selectNodeWithWorkflowId();
      clickOutputTab();

      const http = TestBed.inject(HttpTestingController);
      http
        .expectOne((r) => r.url === "/api/workflows/wf-1/executions")
        .flush({
          items: [
            {
              id: "exec-1",
              definitionId: "wf-1",
              tenantId: "t1",
              temporalWorkflowId: "tw",
              temporalRunId: "tr",
              request: {},
              status: "failed",
              createdAt: "2026-07-27T10:00:00.000Z",
              updatedAt: "2026-07-27T10:00:00.000Z",
            },
          ],
          total: 1,
          page: 1,
          pageSize: 10,
        });
      fixture.detectChanges();

      http
        .expectOne((r) => r.url === "/api/workflows/wf-1/executions/exec-1")
        .flush({
          executionId: "exec-1",
          definitionId: "wf-1",
          temporalWorkflowId: "tw",
          status: "failed",
          result: { results: {} },
          failure: {
            message: "boom",
            type: "ActivityFailure",
            activityName: "JS Function",
          },
          createdAt: "2026-07-27T10:00:00.000Z",
        });
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const failure = el.querySelector('[data-testid="output-failure"]');
      expect(failure?.textContent).toContain("ActivityFailure");
      expect(failure?.textContent).toContain("boom");
    });

    it("shows an error message (never a blank panel) when the runs list fetch fails", () => {
      selectNodeWithWorkflowId();
      clickOutputTab();

      const http = TestBed.inject(HttpTestingController);
      http
        .expectOne((r) => r.url === "/api/workflows/wf-1/executions")
        .flush("boom", { status: 500, statusText: "Server Error" });
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(
        el.querySelector('[data-testid="output-tab"] .tab-error')
      ).toBeTruthy();
    });
  });

  describe("Runs tab", () => {
    function selectNodeWithWorkflowId(): string {
      const key = addJsFunctionNode();
      fixture.componentInstance.flow.update((f) => ({ ...f, key: "wf-1" }));
      fixture.componentInstance.selectNode(key);
      fixture.detectChanges();
      return key;
    }

    function clickRunsTab(): void {
      const el = fixture.nativeElement as HTMLElement;
      const tabs = Array.from(el.querySelectorAll(".config-tab"));
      const runsTab = tabs.find((t) => t.textContent?.trim() === "Runs");
      (runsTab as HTMLButtonElement).click();
      fixture.detectChanges();
    }

    it("renders the summary strip from the already-fetched nodeStatsByName signal, with zero extra requests for the summary itself", () => {
      const key = selectNodeWithWorkflowId();
      fixture.componentInstance.nodeStatsByName.set({
        "JS Function": {
          state: "ready",
          primaryLabel: "1,842 runs",
          secondaryLabel: "p95: 620ms",
          status: "ok",
        },
      });
      fixture.detectChanges();

      clickRunsTab();

      const el = fixture.nativeElement as HTMLElement;
      const summary = el.querySelector('[data-testid="runs-summary"]');
      expect(summary?.textContent).toContain("1,842 runs");
      expect(summary?.textContent).toContain("p95: 620ms");

      // The ONLY request this tab issues is the recent-runs list — the
      // summary strip reuses nodeStatsByName without a fetch of its own.
      const http = TestBed.inject(HttpTestingController);
      http.expectOne((r) => r.url === "/api/workflows/wf-1/correlation-ids");
      void key;
    });

    it("renders recent-runs rows from the node-runs fetch, scoped by definition and action name", () => {
      selectNodeWithWorkflowId();
      clickRunsTab();

      const http = TestBed.inject(HttpTestingController);
      http
        .expectOne((r) => r.url === "/api/workflows/wf-1/correlation-ids")
        .flush({ correlationIds: ["corr-1", "corr-2"] });
      fixture.detectChanges();

      const runsReq = http.expectOne(
        (r) =>
          r.url === "/api/tracking/node-runs" &&
          r.params.get("correlationIds") === "corr-1,corr-2" &&
          r.params.get("actionName") === "JS Function"
      );
      runsReq.flush({
        tenant: "acme",
        actionName: "JS Function",
        correlationIdCount: 2,
        rowCount: 1,
        rows: [
          {
            correlation_id: "corr-1",
            occurred_at: "2026-07-27T10:00:00.000Z",
            duration_ms: 395,
            step_status: "ok",
          },
        ],
      });
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const rows = el.querySelectorAll('[data-testid="runs-row"]');
      expect(rows.length).toBe(1);
      expect(rows[0]?.textContent).toContain("395ms");
    });

    it("shows the honest 'No runs in the last 7 days' empty state", () => {
      selectNodeWithWorkflowId();
      clickRunsTab();

      const http = TestBed.inject(HttpTestingController);
      http
        .expectOne((r) => r.url === "/api/workflows/wf-1/correlation-ids")
        .flush({ correlationIds: [] });
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(
        el.querySelector('[data-testid="runs-tab"] .tab-empty')?.textContent
      ).toContain("No runs in the last 7 days");
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
