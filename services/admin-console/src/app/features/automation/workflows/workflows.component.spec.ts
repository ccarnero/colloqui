import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { vi } from "vitest";
import type {
  IWorkflowDefinitionDto,
  IWorkflowsSummary,
} from "./services/workflow-api.service";
import { WorkflowsComponent } from "./workflows.component";

const EMPTY_SUMMARY: IWorkflowsSummary = {
  activeDefinitions: 0,
  definitionsFailingNow: 0,
  definitionsWithFailuresLast7d: 0,
  executionsCompletedLast7d: 0,
  executionsFailedLast7d: 0,
  executionsRunningLast7d: 0,
  executionsCompletedLast24h: 0,
  topByExecutionCountLast7d: [],
};

function buildWorkflow(
  overrides: Partial<IWorkflowDefinitionDto> = {}
): IWorkflowDefinitionDto {
  return {
    id: "wf1",
    name: "My Workflow",
    application: "app1",
    tenantId: "t1",
    actions: [],
    trigger: { type: "message_received" },
    status: "enabled",
    createdAt: "2026-01-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("WorkflowsComponent", () => {
  let fixture: ComponentFixture<WorkflowsComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkflowsComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(WorkflowsComponent);
    fixture.detectChanges();

    httpMock.expectOne("/api/workflows").flush([]);
    fixture.detectChanges();
  });

  it("renders Workflows title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Workflows");
  });
});

describe("WorkflowsComponent redesigned list view", () => {
  let fixture: ComponentFixture<WorkflowsComponent>;
  let httpMock: HttpTestingController;
  let navigate: ReturnType<typeof vi.fn>;

  async function renderWithData(
    workflows: IWorkflowDefinitionDto[],
    summary: IWorkflowsSummary
  ): Promise<void> {
    navigate = vi.fn().mockResolvedValue(true);

    await TestBed.configureTestingModule({
      imports: [WorkflowsComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Router, useValue: { navigate } },
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(WorkflowsComponent);
    fixture.detectChanges();

    httpMock.expectOne("/api/workflows").flush(workflows);
    httpMock.expectOne("/api/workflows/summary").flush(summary);
    fixture.detectChanges();
    httpMock.verify();
  }

  describe("summary wrapper call + kpi rendering", () => {
    it("calls GET /workflows/summary and renders completed/failed 7d metrics from it", async () => {
      await renderWithData([buildWorkflow()], {
        ...EMPTY_SUMMARY,
        executionsCompletedLast7d: 42,
        executionsFailedLast7d: 3,
      });
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain("Completed (7d)");
      expect(el.textContent).toContain("42");
      expect(el.textContent).toContain("Failed (7d)");
      expect(el.textContent).toContain("3");
    });

    it("renders the workflow and active counts derived from the real list, not invented fields", async () => {
      await renderWithData(
        [
          buildWorkflow({ id: "wf1", status: "enabled" }),
          buildWorkflow({ id: "wf2", status: "disabled" }),
        ],
        EMPTY_SUMMARY
      );
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain("Workflows");
      expect(el.textContent).toContain("Active");
      expect(el.textContent).not.toContain("Success rate");
    });
  });

  describe("row mapping (health cases from real fields)", () => {
    it("maps an enabled workflow with a trigger to the ok health dot (active)", async () => {
      await renderWithData(
        [
          buildWorkflow({
            status: "enabled",
            trigger: { type: "message_received" },
          }),
        ],
        EMPTY_SUMMARY
      );
      const el = fixture.nativeElement as HTMLElement;
      const dot = el.querySelector(".health-dot") as HTMLElement;
      expect(dot.className).toContain("health-dot--ok");
    });

    it("maps an enabled workflow with no trigger to the idle health dot (draft)", async () => {
      await renderWithData(
        [buildWorkflow({ status: "enabled", trigger: null })],
        EMPTY_SUMMARY
      );
      const el = fixture.nativeElement as HTMLElement;
      const dot = el.querySelector(".health-dot") as HTMLElement;
      expect(dot.className).toContain("health-dot--idle");
    });

    it("maps a disabled workflow to the warn health dot", async () => {
      await renderWithData(
        [
          buildWorkflow({
            status: "disabled",
            trigger: { type: "message_received" },
          }),
        ],
        EMPTY_SUMMARY
      );
      const el = fixture.nativeElement as HTMLElement;
      const dot = el.querySelector(".health-dot") as HTMLElement;
      expect(dot.className).toContain("health-dot--warn");
    });

    it("renders the real 7d run count for a workflow present in the summary's top list", async () => {
      await renderWithData(
        [buildWorkflow({ id: "wf1", name: "Top Workflow" })],
        {
          ...EMPTY_SUMMARY,
          topByExecutionCountLast7d: [
            {
              definition_id: "wf1",
              name: "Top Workflow",
              application: "app1",
              count: 1842,
            },
          ],
        }
      );
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain("1,842");
    });

    it("does not render a fabricated 0 for a workflow absent from the summary's top list", async () => {
      await renderWithData(
        [buildWorkflow({ id: "wf-not-top", name: "Long Tail Workflow" })],
        EMPTY_SUMMARY
      );
      const el = fixture.nativeElement as HTMLElement;
      const row = el.querySelector(".table-row") as HTMLElement;
      const cells = Array.from(row.querySelectorAll(".table-cell"));
      const executionsCell = cells[3];
      expect(executionsCell.textContent?.trim()).toBe("");
    });
  });

  describe("empty state", () => {
    it("renders the inventory table empty message when there are no workflows", async () => {
      await renderWithData([], EMPTY_SUMMARY);
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelectorAll(".table-row").length).toBe(0);
      expect(el.textContent).toContain(
        "No workflows yet. Create your first workflow to automate business processes."
      );
    });
  });

  describe("row click navigation", () => {
    it("navigates to the existing /workflows/:id route when a row is clicked", async () => {
      await renderWithData([buildWorkflow({ id: "wf-42" })], EMPTY_SUMMARY);
      const el = fixture.nativeElement as HTMLElement;
      const row = el.querySelector(".table-row") as HTMLElement;
      expect(row).toBeTruthy();
      row.click();
      expect(navigate).toHaveBeenCalledWith(["/workflows", "wf-42"]);
    });
  });

  describe("needs-attention panel filtering", () => {
    it("lists only workflows in a non-ok state (disabled)", async () => {
      const active = buildWorkflow({
        id: "wf-active",
        name: "Active Workflow",
        status: "enabled",
      });
      const disabled = buildWorkflow({
        id: "wf-disabled",
        name: "Disabled Workflow",
        status: "disabled",
      });
      await renderWithData([active, disabled], EMPTY_SUMMARY);
      const el = fixture.nativeElement as HTMLElement;
      const issueRows = el.querySelectorAll(".issue-row");
      expect(issueRows.length).toBe(1);
      expect(el.textContent).toContain("Disabled Workflow is disabled.");
      expect(el.textContent).not.toContain("Active Workflow is disabled.");
    });

    it("does not flag draft workflows (enabled, no trigger) as needing attention", async () => {
      const draft = buildWorkflow({
        id: "wf-draft",
        name: "Draft Workflow",
        status: "enabled",
        trigger: null,
      });
      await renderWithData([draft], EMPTY_SUMMARY);
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelectorAll(".issue-row").length).toBe(0);
      expect(el.textContent).toContain("No workflows need attention");
    });

    it("navigates to the workflow route when an attention action link is clicked", async () => {
      const disabled = buildWorkflow({ id: "wf-disabled", status: "disabled" });
      await renderWithData([disabled], EMPTY_SUMMARY);
      const el = fixture.nativeElement as HTMLElement;
      const action = el.querySelector(".issue-action") as HTMLAnchorElement;
      expect(action).toBeTruthy();
      action.click();
      expect(navigate).toHaveBeenCalledWith(["/workflows", "wf-disabled"]);
    });
  });
});
