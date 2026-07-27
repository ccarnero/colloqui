import "@angular/compiler";
import { HttpErrorResponse } from "@angular/common/http";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ActivatedRoute, Router } from "@angular/router";
import { of, throwError } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import {
  type IWorkflowExecutionDetail,
  WorkflowApiService,
} from "../services/workflow-api.service";
import { WorkflowRunDetailComponent } from "./workflow-run-detail.component";

const detail: IWorkflowExecutionDetail = {
  executionId: "exec-1",
  definitionId: "def-1",
  temporalWorkflowId: "acme:order-workflow:abc123",
  status: "completed",
  result: {
    results: {
      normalizeContact: { ok: true },
      vipRoute: { branchTaken: "default" },
      replyStandard: { sent: true },
    },
  },
  createdAt: "2026-07-27T10:00:00.000Z",
};

/**
 * Shape-scoped inspector correction: `?node=` (set by the builder
 * inspector's "View in Runs" link, possibly forwarded through
 * `WorkflowExecutionsComponent`) highlights/scrolls to the matching step
 * once this run's step list renders. Absent param → unchanged rendering.
 */
describe("WorkflowRunDetailComponent — deep-link step highlight", () => {
  let fixture: ComponentFixture<WorkflowRunDetailComponent>;
  let getExecutionDetail: ReturnType<typeof vi.fn>;

  async function createFixture(
    queryParams: Record<string, string>
  ): Promise<void> {
    getExecutionDetail = vi.fn().mockReturnValue(of(detail));

    await TestBed.configureTestingModule({
      imports: [WorkflowRunDetailComponent],
      providers: [
        { provide: WorkflowApiService, useValue: { getExecutionDetail } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        {
          provide: ActivatedRoute,
          useValue: {
            parent: {
              params: of({ id: "def-1" }),
              snapshot: { params: { id: "def-1" } },
            },
            params: of({ runId: "exec-1" }),
            queryParams: of(queryParams),
            snapshot: {
              params: { runId: "exec-1" },
              queryParams,
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WorkflowRunDetailComponent);
    fixture.detectChanges();
  }

  it("highlights the step matching ?node= once the step list renders", async () => {
    await createFixture({ node: "vipRoute" });

    const el = fixture.nativeElement as HTMLElement;
    const highlighted = el.querySelector('[data-testid="step-highlighted"]');
    expect(highlighted?.textContent).toContain("vipRoute");
    expect(highlighted?.classList.contains("step-highlight")).toBe(true);

    const others = Array.from(el.querySelectorAll(".step")).filter(
      (s) => s !== highlighted
    );
    for (const step of others) {
      expect(step.classList.contains("step-highlight")).toBe(false);
    }
  });

  it("highlights nothing when ?node= is absent (unchanged rendering)", async () => {
    await createFixture({});

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="step-highlighted"]')).toBeNull();
    expect(el.querySelector(".step-highlight")).toBeNull();
  });

  it("highlights nothing when ?node= names a step outside this run", async () => {
    await createFixture({ node: "doesNotExist" });

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="step-highlighted"]')).toBeNull();
  });
});

/**
 * Fix 1 (retention-expired runs): workflow-service's getExecutionStatus
 * maps Temporal's WorkflowNotFoundError (history aged past retention) to
 * 410 GoneException with `code: "RUN_HISTORY_EXPIRED"`. This distinguishes
 * that case from every other error so the run-detail page renders a calm,
 * honest empty state instead of "Failed to load this run: 500".
 */
describe("WorkflowRunDetailComponent — retention-expired run", () => {
  async function createFixtureWithError(
    err: unknown
  ): Promise<ComponentFixture<WorkflowRunDetailComponent>> {
    const getExecutionDetail = vi.fn().mockReturnValue(throwError(() => err));

    await TestBed.configureTestingModule({
      imports: [WorkflowRunDetailComponent],
      providers: [
        { provide: WorkflowApiService, useValue: { getExecutionDetail } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        {
          provide: ActivatedRoute,
          useValue: {
            parent: {
              params: of({ id: "def-1" }),
              snapshot: { params: { id: "def-1" } },
            },
            params: of({ runId: "exec-1" }),
            queryParams: of({}),
            snapshot: {
              params: { runId: "exec-1" },
              queryParams: {},
            },
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(WorkflowRunDetailComponent);
    fixture.detectChanges();
    return fixture;
  }

  it("renders the honest 'no longer retained' empty state on 410 RUN_HISTORY_EXPIRED", async () => {
    const fixture = await createFixtureWithError(
      new HttpErrorResponse({
        status: 410,
        error: { code: "RUN_HISTORY_EXPIRED", message: "gone" },
      })
    );

    const el = fixture.nativeElement as HTMLElement;
    const expired = el.querySelector('[data-testid="run-history-expired"]');
    expect(expired).not.toBeNull();
    expect(expired?.textContent).toContain(
      "This run's output is no longer retained"
    );
    expect(el.querySelector(".err-msg")).toBeNull();
  });

  it("keeps the generic red error state for a plain 500", async () => {
    const fixture = await createFixtureWithError(
      new HttpErrorResponse({ status: 500, error: { message: "boom" } })
    );

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="run-history-expired"]')).toBeNull();
    expect(el.querySelector(".err-msg")).not.toBeNull();
  });

  it("keeps the generic red error state for a 410 without the RUN_HISTORY_EXPIRED code", async () => {
    const fixture = await createFixtureWithError(
      new HttpErrorResponse({ status: 410, error: { code: "OTHER" } })
    );

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="run-history-expired"]')).toBeNull();
    expect(el.querySelector(".err-msg")).not.toBeNull();
  });
});
