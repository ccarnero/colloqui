import { ComponentFixture, TestBed } from "@angular/core/testing";
import { SecurityCenterComponent } from "./security-center.component";

describe("SecurityCenterComponent", () => {
  let fixture: ComponentFixture<SecurityCenterComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SecurityCenterComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SecurityCenterComponent);
    fixture.detectChanges();
  });

  it("renders Security Center title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Security Center");
  });
});
