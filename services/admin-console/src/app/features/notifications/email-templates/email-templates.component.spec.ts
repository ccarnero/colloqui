import { ComponentFixture, TestBed } from "@angular/core/testing";
import { EmailTemplatesComponent } from "./email-templates.component";

describe("EmailTemplatesComponent", () => {
  let fixture: ComponentFixture<EmailTemplatesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EmailTemplatesComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(EmailTemplatesComponent);
    fixture.detectChanges();
  });

  it("renders Email Templates title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Email Templates");
  });
});
