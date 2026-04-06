import { ComponentFixture, TestBed } from "@angular/core/testing";
import { RulesComponent } from "./rules.component";

describe("RulesComponent", () => {
  let fixture: ComponentFixture<RulesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RulesComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(RulesComponent);
    fixture.detectChanges();
  });

  it("renders Rules Engine title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Rules Engine");
  });
});
