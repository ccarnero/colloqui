import "@angular/compiler";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ActivatedRoute, Router } from "@angular/router";
import { of } from "rxjs";
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
