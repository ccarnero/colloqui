import { provideHttpClient } from "@angular/common/http";
import { provideHttpClientTesting } from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ActivatedRoute, provideRouter } from "@angular/router";
import { of, Subject, throwError } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import type { INodeStatsRow } from "../../domain/map-node-stats-to-view-models";
import {
  type IWorkflowDefinitionDto,
  WorkflowApiService,
} from "../../services/workflow-api.service";
import { WorkflowBuilderComponent } from "../workflow-builder.component";

/**
 * jsdom has no ResizeObserver; @foblex/flow's FNodeDirective observes node
 * size on mount. Same test-only stub every other builder spec uses.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??=
  ResizeObserverStub;

const WORKFLOW_DTO: IWorkflowDefinitionDto = {
  id: "wf-1",
  name: "http-fanout-telegram",
  application: "default",
  tenantId: "acme",
  actions: [
    { activity: "jsFunction", name: "Fetch user", args: { code: "1" } },
  ],
  trigger: null,
  createdAt: "2026-07-01T00:00:00.000Z",
};

/**
 * T07 of console-redesign-builder-v2.md: real per-node stats wiring —
 * one fetch per builder load, cached, never blocking the canvas, with the
 * loading/error/hidden/ready footer states `statsFor()` derives.
 */
describe("WorkflowBuilderComponent — per-node stats (T07)", () => {
  let fixture: ComponentFixture<WorkflowBuilderComponent>;
  let getNodeStatsForDefinition: ReturnType<typeof vi.fn>;

  async function setup(
    routeId: string | null,
    statsSource: unknown
  ): Promise<void> {
    getNodeStatsForDefinition = vi.fn().mockReturnValue(statsSource);

    await TestBed.configureTestingModule({
      imports: [WorkflowBuilderComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: WorkflowApiService,
          useValue: {
            get: vi.fn().mockReturnValue(of(WORKFLOW_DTO)),
            getNodeStatsForDefinition,
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: new Map(routeId ? [["id", routeId]] : []) },
            parent: null,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WorkflowBuilderComponent);
    fixture.detectChanges();
  }

  it("fetches node stats exactly once per builder load", async () => {
    await setup("wf-1", of<INodeStatsRow[]>([]));
    expect(getNodeStatsForDefinition).toHaveBeenCalledTimes(1);
    expect(getNodeStatsForDefinition).toHaveBeenCalledWith("wf-1");
  });

  it("does not fetch node stats for an unsaved workflow with no id (idle -> hidden, never a permanent skeleton)", async () => {
    await setup(null, of<INodeStatsRow[]>([]));
    expect(getNodeStatsForDefinition).not.toHaveBeenCalled();
    expect(fixture.componentInstance.nodeStatsFetchState()).toBe("idle");
  });

  it("renders the loading state while the fetch is in flight, never blocking canvas render", async () => {
    const pending = new Subject<INodeStatsRow[]>();
    await setup("wf-1", pending.asObservable());

    // Canvas render is independent of the stats fetch — the flow signal is
    // already populated via the separate `api.get` subscription.
    expect(fixture.componentInstance.nodes().length).toBeGreaterThan(0);

    const node = fixture.componentInstance.nodes()[0]!;
    expect(fixture.componentInstance.statsFor(node).state).toBe("loading");
  });

  it("maps a ready response to real per-node numbers, joined on action name", async () => {
    const rows: INodeStatsRow[] = [
      {
        action_name: "Fetch user",
        branch: null,
        runs: 12,
        p95_ms: 620,
        ok_ratio: 0.99,
      },
    ];
    await setup("wf-1", of(rows));

    const node = fixture.componentInstance.nodes()[0]!;
    expect(node.name).toBe("Fetch user");
    const stats = fixture.componentInstance.statsFor(node);
    expect(stats.state).toBe("ready");
    expect(stats.primaryLabel).toBe("12 runs");
    expect(stats.secondaryLabel).toBe("p95: 620ms");
    expect(stats.status).toBe("ok");
  });

  it("degrades to hidden when the fetch errors, keeping the canvas working", async () => {
    await setup(
      "wf-1",
      throwError(() => new Error("network down"))
    );

    const node = fixture.componentInstance.nodes()[0]!;
    expect(fixture.componentInstance.nodeStatsFetchState()).toBe("error");
    expect(fixture.componentInstance.statsFor(node).state).toBe("hidden");
    // Canvas still rendered the node despite the stats fetch failing.
    expect(fixture.componentInstance.nodes().length).toBeGreaterThan(0);
  });

  it("hides the footer for a zero-runs workflow (legitimate empty case, not an error)", async () => {
    await setup("wf-1", of<INodeStatsRow[]>([]));

    const node = fixture.componentInstance.nodes()[0]!;
    expect(fixture.componentInstance.nodeStatsFetchState()).toBe("ready");
    expect(fixture.componentInstance.statsFor(node).state).toBe("hidden");
  });

  it("hides the footer for a node whose action name has no matching aggregate row", async () => {
    const rows: INodeStatsRow[] = [
      {
        action_name: "Some other action",
        branch: null,
        runs: 5,
        p95_ms: 100,
        ok_ratio: 1,
      },
    ];
    await setup("wf-1", of(rows));

    const node = fixture.componentInstance.nodes()[0]!;
    expect(node.name).toBe("Fetch user");
    expect(fixture.componentInstance.statsFor(node).state).toBe("hidden");
  });
});
