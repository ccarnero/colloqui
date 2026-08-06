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
      })
    );
    fixture.componentRef.setInput("authType", "none");
    fixture.detectChanges();
  });

  it("renders authentication section", () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain("Authentication");
    expect(el.textContent).toContain("Auth Type");
  });

  // Regression guard: OAuth2 was removed from the connector auth types — the
  // selector must offer exactly the four supported values so the UI can never
  // persist a connector the injectors would drop.
  it("offers only the four supported auth types", () => {
    expect(fixture.componentInstance.authOptions.map((o) => o.value)).toEqual([
      "none",
      "api-key",
      "bearer",
      "basic",
    ]);
  });
});
