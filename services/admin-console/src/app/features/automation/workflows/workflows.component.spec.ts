import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { MatDialog } from "@angular/material/dialog";
import { provideRouter } from "@angular/router";
import { of } from "rxjs";
import { vi } from "vitest";
import type { IWorkflowDefinitionDto } from "./services/workflow-api.service";
import { WorkflowsComponent } from "./workflows.component";

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

describe("WorkflowsComponent status toggle", () => {
  let fixture: ComponentFixture<WorkflowsComponent>;
  let httpMock: HttpTestingController;

  const wf: IWorkflowDefinitionDto = {
    id: "wf1",
    name: "My Workflow",
    application: "app1",
    tenantId: "t1",
    actions: [],
    trigger: null,
    status: "enabled",
    createdAt: new Date().toISOString(),
  };

  async function setup(dialogAfterClosed: unknown) {
    const dialogSpy = {
      open: vi.fn().mockReturnValue({
        afterClosed: () => of(dialogAfterClosed),
      }),
    };

    await TestBed.configureTestingModule({
      imports: [WorkflowsComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MatDialog, useValue: dialogSpy },
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(WorkflowsComponent);
    fixture.detectChanges();

    httpMock.expectOne("/api/workflows").flush([wf]);
    httpMock.expectOne("/api/workflows/executions/counts").flush({});
    fixture.detectChanges();

    return dialogSpy;
  }

  it("opens the confirm dialog and calls setStatus when disabling is confirmed", async () => {
    await setup(true);
    const component = fixture.componentInstance;

    component.onStatusToggle(false, wf);

    const req = httpMock.expectOne("/api/workflows/wf1/status");
    expect(req.request.method).toBe("PATCH");
    expect(req.request.body).toEqual({ status: "disabled" });
    req.flush({ ...wf, status: "disabled", terminated: 2 });

    fixture.detectChanges();
    httpMock.verify();
  });

  it("does not call setStatus when disabling is cancelled", async () => {
    await setup(false);
    const component = fixture.componentInstance;

    component.onStatusToggle(false, wf);

    httpMock.expectNone("/api/workflows/wf1/status");
    httpMock.verify();
  });

  it("calls setStatus directly with no dialog when enabling", async () => {
    const dialogSpy = await setup(true);
    const component = fixture.componentInstance;

    component.onStatusToggle(true, wf);

    expect(dialogSpy.open).not.toHaveBeenCalled();
    const req = httpMock.expectOne("/api/workflows/wf1/status");
    expect(req.request.body).toEqual({ status: "enabled" });
    req.flush({ ...wf, status: "enabled", terminated: 0 });

    fixture.detectChanges();
    httpMock.verify();
  });
});
