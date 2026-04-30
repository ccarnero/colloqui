import { ComponentFixture, TestBed } from "@angular/core/testing";
import { StatusBadgeComponent } from "./status-badge.component";

describe("StatusBadgeComponent", () => {
  let fixture: ComponentFixture<StatusBadgeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StatusBadgeComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(StatusBadgeComponent);
    fixture.componentRef.setInput("status", "Active");
    fixture.componentRef.setInput("color", "green");
    fixture.detectChanges();
  });

  it("renders status text", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent?.trim()).toBe("Active");
  });
});
