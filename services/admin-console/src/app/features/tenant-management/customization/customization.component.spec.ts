import { ComponentFixture, TestBed } from "@angular/core/testing";
import { CustomizationComponent } from "./customization.component";

describe("CustomizationComponent", () => {
  let fixture: ComponentFixture<CustomizationComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CustomizationComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(CustomizationComponent);
    fixture.detectChanges();
  });

  it("renders Customization title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Customization");
  });
});
