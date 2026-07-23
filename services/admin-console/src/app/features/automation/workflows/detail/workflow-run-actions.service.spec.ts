import "@angular/compiler";
import { TestBed } from "@angular/core/testing";
import { MatDialog } from "@angular/material/dialog";
import { Router } from "@angular/router";
import { of } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowApiService } from "../services/workflow-api.service";
import { WorkflowRunActionsService } from "./workflow-run-actions.service";

/**
 * T02 — the shared "Run now" / "Pause" wiring used by both
 * `WorkflowDetailComponent`'s header and `WorkflowBuilderComponent`'s
 * floating chrome. Verifies the exact pre-T02 wiring (dialog width,
 * `execute` payload, navigate-to-executions-on-success, silent swallow on
 * error, pause is a no-op) is preserved after extraction.
 */
describe("WorkflowRunActionsService", () => {
  let service: WorkflowRunActionsService;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let execute: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dialogOpen = vi.fn();
    execute = vi.fn();
    navigate = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        WorkflowRunActionsService,
        { provide: MatDialog, useValue: { open: dialogOpen } },
        { provide: WorkflowApiService, useValue: { execute } },
        { provide: Router, useValue: { navigate } },
      ],
    });

    service = TestBed.inject(WorkflowRunActionsService);
  });

  it("opens the run dialog with the expected width", () => {
    dialogOpen.mockReturnValue({ afterClosed: () => of(undefined) });

    service.runNow("wf-1");

    expect(dialogOpen).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ width: "400px" })
    );
  });

  it("does not execute when the dialog is cancelled (undefined result)", () => {
    dialogOpen.mockReturnValue({ afterClosed: () => of(undefined) });

    service.runNow("wf-1");

    expect(execute).not.toHaveBeenCalled();
  });

  it("executes with the chosen timeout and navigates to executions on success", () => {
    dialogOpen.mockReturnValue({ afterClosed: () => of(1800) });
    execute.mockReturnValue(of({}));

    service.runNow("wf-1");

    expect(execute).toHaveBeenCalledWith("wf-1", { agentTimeoutSec: 1800 });
    expect(navigate).toHaveBeenCalledWith(["/workflows", "wf-1", "executions"]);
  });

  it("swallows execute errors without navigating", () => {
    dialogOpen.mockReturnValue({ afterClosed: () => of(900) });
    execute.mockReturnValue({
      subscribe: ({ error }: { error: (e: unknown) => void }) =>
        error(new Error("boom")),
    });

    expect(() => service.runNow("wf-1")).not.toThrow();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("pause is a no-op (API pending) and never throws", () => {
    expect(() => service.pause("wf-1")).not.toThrow();
    expect(execute).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
