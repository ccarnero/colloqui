import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ProgressBarComponent } from "./progress-bar.component";

describe("ProgressBarComponent", () => {
  let fixture: ComponentFixture<ProgressBarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProgressBarComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(ProgressBarComponent);
  });

  it("renders simple mode progress bar", () => {
    fixture.componentRef.setInput("value", 42);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const bar = el.querySelector('[role="progressbar"]');
    expect(bar).toBeTruthy();
  });

  it("renders quota mode when current and max are set", () => {
    fixture.componentRef.setInput("label", "API");
    fixture.componentRef.setInput("current", 3);
    fixture.componentRef.setInput("max", 10);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("API");
    expect(el.textContent).toContain("3");
    expect(el.textContent).toContain("10");
  });
});
