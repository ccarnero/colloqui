import { ComponentFixture, TestBed } from "@angular/core/testing";
import { IpAllowlistComponent } from "./ip-allowlist.component";

describe("IpAllowlistComponent", () => {
  let fixture: ComponentFixture<IpAllowlistComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IpAllowlistComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(IpAllowlistComponent);
    fixture.detectChanges();
  });

  it("renders IP Allow List title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("IP Allow List");
  });
});
