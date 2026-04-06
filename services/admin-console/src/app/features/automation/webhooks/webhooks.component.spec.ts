import { ComponentFixture, TestBed } from "@angular/core/testing";
import { WebhooksComponent } from "./webhooks.component";

describe("WebhooksComponent", () => {
  let fixture: ComponentFixture<WebhooksComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WebhooksComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(WebhooksComponent);
    fixture.detectChanges();
  });

  it("renders Webhooks title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Webhooks");
  });
});
