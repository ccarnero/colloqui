import { ComponentFixture, TestBed } from "@angular/core/testing";
import { FormBuilder, FormGroup, Validators } from "@angular/forms";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { AdapterCacheStrategyFormComponent } from "./adapter-cache-strategy-form.component";

describe("AdapterCacheStrategyFormComponent", () => {
  let fixture: ComponentFixture<AdapterCacheStrategyFormComponent>;
  let group: FormGroup;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdapterCacheStrategyFormComponent],
      providers: [FormBuilder, provideNoopAnimations()],
    }).compileComponents();

    const fb = TestBed.inject(FormBuilder);
    group = fb.group({
      enabled: [false],
      ttlSeconds: [60, [Validators.required, Validators.min(1)]],
      methods: [["GET", "HEAD"], Validators.required],
      keyBody: [false],
      keyHeaders: [[] as string[]],
      queryParamsMode: ["all"],
      keyQueryParamsList: [[] as string[]],
    });

    fixture = TestBed.createComponent(AdapterCacheStrategyFormComponent);
    fixture.componentRef.setInput("group", group);
    fixture.detectChanges();
  });

  it("starts disabled with safe-method defaults", () => {
    expect(group.get("enabled")?.value).toBe(false);
    expect(group.get("ttlSeconds")?.value).toBe(60);
    expect(group.get("methods")?.value).toEqual(["GET", "HEAD"]);
    expect(group.get("keyBody")?.value).toBe(false);
  });

  it("marks the ttl control invalid when below one", () => {
    group.get("ttlSeconds")?.setValue(0);
    group.get("ttlSeconds")?.markAsTouched();
    fixture.detectChanges();

    expect(group.get("ttlSeconds")?.invalid).toBe(true);
  });

  it("shows a warning when mutating methods are selected", () => {
    group.patchValue({ enabled: true, methods: ["POST"] });
    fixture.componentInstance.syncKeyBodyDefault();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(group.get("keyBody")?.value).toBe(true);
    expect(el.textContent).toContain("Caching mutating methods suppresses");
  });
});
