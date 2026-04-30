import { ComponentFixture, TestBed } from "@angular/core/testing";
import { EnvironmentsComponent } from "./environments.component";

describe("EnvironmentsComponent", () => {
  let fixture: ComponentFixture<EnvironmentsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EnvironmentsComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(EnvironmentsComponent);
    fixture.detectChanges();
  });

  it("renders Environments title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Environments");
  });
});
