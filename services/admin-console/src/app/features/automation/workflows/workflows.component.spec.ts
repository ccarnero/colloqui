import { ComponentFixture, TestBed } from "@angular/core/testing";
import { WorkflowsComponent } from "./workflows.component";

describe("WorkflowsComponent", () => {
  let fixture: ComponentFixture<WorkflowsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkflowsComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(WorkflowsComponent);
    fixture.detectChanges();
  });

  it("renders Workflows title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Workflows");
  });
});
