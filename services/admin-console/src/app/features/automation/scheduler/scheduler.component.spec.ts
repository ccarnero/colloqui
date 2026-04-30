import { ComponentFixture, TestBed } from "@angular/core/testing";
import { SchedulerComponent } from "./scheduler.component";

describe("SchedulerComponent", () => {
  let fixture: ComponentFixture<SchedulerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SchedulerComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(SchedulerComponent);
    fixture.detectChanges();
  });

  it("renders Scheduler title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Scheduler");
  });
});
