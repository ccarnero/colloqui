import { ComponentFixture, TestBed } from "@angular/core/testing";
import { FeatureFlagsComponent } from "./feature-flags.component";

describe("FeatureFlagsComponent", () => {
  let fixture: ComponentFixture<FeatureFlagsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeatureFlagsComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(FeatureFlagsComponent);
    fixture.detectChanges();
  });

  it("renders Feature Flags title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Feature Flags");
  });
});
