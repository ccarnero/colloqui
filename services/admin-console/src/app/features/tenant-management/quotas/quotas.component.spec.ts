import { ComponentFixture, TestBed } from "@angular/core/testing";
import { QuotasComponent } from "./quotas.component";

describe("QuotasComponent", () => {
  let fixture: ComponentFixture<QuotasComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QuotasComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(QuotasComponent);
    fixture.detectChanges();
  });

  it("renders Quotas & Limits title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Quotas & Limits");
  });
});
