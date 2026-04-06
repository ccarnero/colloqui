import { ComponentFixture, TestBed } from "@angular/core/testing";
import { NotificationRulesComponent } from "./notification-rules.component";

describe("NotificationRulesComponent", () => {
  let fixture: ComponentFixture<NotificationRulesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NotificationRulesComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(NotificationRulesComponent);
    fixture.detectChanges();
  });

  it("renders Notification Rules title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Notification Rules");
  });
});
