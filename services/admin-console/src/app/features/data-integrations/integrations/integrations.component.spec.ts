import { ComponentFixture, TestBed } from "@angular/core/testing";
import { IntegrationsComponent } from "./integrations.component";

describe("IntegrationsComponent", () => {
  let fixture: ComponentFixture<IntegrationsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IntegrationsComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(IntegrationsComponent);
    fixture.detectChanges();
  });

  it("renders Integrations title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Integrations");
  });
});
