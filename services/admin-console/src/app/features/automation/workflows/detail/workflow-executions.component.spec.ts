import "@angular/compiler";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ActivatedRoute, Router } from "@angular/router";
import { of } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type IWorkflowExecutionRow,
  type IWorkflowExecutionsPage,
  WorkflowApiService,
} from "../services/workflow-api.service";
import { WorkflowExecutionsComponent } from "./workflow-executions.component";

function row(
  overrides: Partial<IWorkflowExecutionRow> = {}
): IWorkflowExecutionRow {
  return {
    id: "exec-1",
    definitionId: "def-1",
    tenantId: "acme",
    temporalWorkflowId: "acme:order-workflow:abc123",
    temporalRunId: "run-9",
    request: {},
    status: "completed",
    createdAt: "2026-07-11T10:00:00.000Z",
    updatedAt: "2026-07-11T10:00:01.000Z",
    ...overrides,
  };
}

const page: IWorkflowExecutionsPage = {
  items: [row()],
  total: 1,
  page: 0,
  pageSize: 20,
};

/**
 * T06 of `manual-loops/run-view.md`: a run row click navigates to the new
 * `processes/runs/:workflowId/:runId` route, using the row's
 * `temporalWorkflowId`/`temporalRunId` — the ids the ingester's run
 * endpoint is keyed by (see openRun()'s header comment) — NOT the row's
 * own `id`/`definitionId`. The parent route's definition id (`def-1`) IS
 * carried along, but as a `?definitionId=` query param (T06 finding fix):
 * `RunViewComponent` needs it separately, to fetch the workflow definition
 * for the header name — mixing it into the path would break the ingester's
 * `:workflowId`/`:runId` route contract.
 */
describe("WorkflowExecutionsComponent", () => {
  let fixture: ComponentFixture<WorkflowExecutionsComponent>;
  let navigate: ReturnType<typeof vi.fn>;
  let listExecutions: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    navigate = vi.fn();
    listExecutions = vi.fn().mockReturnValue(of(page));

    await TestBed.configureTestingModule({
      imports: [WorkflowExecutionsComponent],
      providers: [
        { provide: WorkflowApiService, useValue: { listExecutions } },
        { provide: Router, useValue: { navigate } },
        {
          provide: ActivatedRoute,
          useValue: {
            parent: {
              params: of({ id: "def-1" }),
              snapshot: { params: { id: "def-1" } },
            },
            params: of({}),
            snapshot: { params: {} },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WorkflowExecutionsComponent);
    fixture.detectChanges();
  });

  it("fetches executions for the parent workflow definition id", () => {
    expect(listExecutions).toHaveBeenCalledWith(
      "def-1",
      expect.objectContaining({ page: 0, pageSize: 20, sort: "desc" })
    );
  });

  it("navigates to the run-view route using the row's temporal ids on click", () => {
    const el = fixture.nativeElement as HTMLElement;
    const runRow = el.querySelector(".row:not(.row-head)") as HTMLElement;

    runRow.click();

    expect(navigate).toHaveBeenCalledWith(
      ["/processes/runs", "acme:order-workflow:abc123", "run-9"],
      expect.anything()
    );
  });

  it("carries the parent workflow definition id along as a definitionId query param (T06 finding fix)", () => {
    const el = fixture.nativeElement as HTMLElement;
    const runRow = el.querySelector(".row:not(.row-head)") as HTMLElement;

    runRow.click();

    expect(navigate).toHaveBeenCalledWith(expect.anything(), {
      queryParams: { definitionId: "def-1" },
    });
  });
});
