import { ComponentFixture, TestBed } from "@angular/core/testing";
import { FormBuilder, ReactiveFormsModule } from "@angular/forms";
import { provideNoopAnimations } from "@angular/platform-browser/animations";

import { AdapterAuthConfigComponent } from "./adapter-auth-config.component";

describe("AdapterAuthConfigComponent", () => {
  let fixture: ComponentFixture<AdapterAuthConfigComponent>;
  let fb: FormBuilder;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdapterAuthConfigComponent, ReactiveFormsModule],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fb = TestBed.inject(FormBuilder);
    fixture = TestBed.createComponent(AdapterAuthConfigComponent);
    fixture.componentRef.setInput(
      "authForm",
      fb.group({
        type: ["none"],
        apiKeyHeader: [""],
        apiKey: [""],
        bearerToken: [""],
        basicUsername: [""],
        basicPassword: [""],
        oauth2ClientId: [""],
        oauth2ClientSecret: [""],
        oauth2TokenUrl: [""],
      }),
    );
    fixture.componentRef.setInput("authType", "none");
    fixture.detectChanges();
  });

  it("renders authentication section", () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain("Authentication");
    expect(el.textContent).toContain("Auth Type");
  });
});
