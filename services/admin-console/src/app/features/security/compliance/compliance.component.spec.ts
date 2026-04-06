import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ComplianceComponent } from "./compliance.component";

describe("ComplianceComponent", () => {
  let fixture: ComponentFixture<ComplianceComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ComplianceComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ComplianceComponent);
    fixture.detectChanges();
  });

  it("renders Compliance title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Compliance");
  });
});
