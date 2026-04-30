import { ComponentFixture, TestBed } from "@angular/core/testing";
import { SystemHealthComponent } from "./system-health.component";

describe("SystemHealthComponent", () => {
  let fixture: ComponentFixture<SystemHealthComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SystemHealthComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SystemHealthComponent);
    fixture.detectChanges();
  });

  it("renders System Health title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("System Health");
  });
});
