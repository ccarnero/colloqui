import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { provideHttpClient } from "@angular/common/http";
import {
  provideHttpClientTesting,
  HttpTestingController,
} from "@angular/common/http/testing";
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
