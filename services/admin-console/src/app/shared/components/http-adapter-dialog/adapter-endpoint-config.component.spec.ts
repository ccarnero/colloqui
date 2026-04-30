import { ComponentFixture, TestBed } from "@angular/core/testing";
import { FormArray, FormBuilder, ReactiveFormsModule } from "@angular/forms";
import { provideNoopAnimations } from "@angular/platform-browser/animations";

import { AdapterEndpointConfigComponent } from "./adapter-endpoint-config.component";

describe("AdapterEndpointConfigComponent", () => {
  let fixture: ComponentFixture<AdapterEndpointConfigComponent>;
  let fb: FormBuilder;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdapterEndpointConfigComponent, ReactiveFormsModule],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fb = TestBed.inject(FormBuilder);
    const endpoints = fb.array([
      fb.group({
        id: ["ep-1"],
        label: ["default"],
        method: ["GET"],
        path: ["/"],
        cache: fb.group({
          enabled: [false],
          ttlSeconds: [60],
          methods: [["GET", "HEAD"]],
          keyBody: [false],
          keyHeaders: [[]],
          queryParamsMode: ["all"],
          keyQueryParamsList: [[]],
        }),
      }),
    ]);

    fixture = TestBed.createComponent(AdapterEndpointConfigComponent);
    fixture.componentRef.setInput("endpoints", endpoints as FormArray);
    fixture.detectChanges();
  });

  it("renders endpoints section with one row", () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain("Endpoints");
    expect(el.textContent).toContain("Method");
    expect(el.textContent).toContain("Path");
    expect(el.textContent).toContain("Cache");
  });

  it("addEndpoint appends a form group with cache controls", () => {
    const comp = fixture.componentInstance;
    const before = comp.endpoints().length;
    comp.addEndpoint();
    const added = comp.endpointGroup(before);

    expect(comp.endpoints().length).toBe(before + 1);
    expect(added.get("cache")).toBeTruthy();
  });
});
