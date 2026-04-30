import { ComponentFixture, TestBed } from "@angular/core/testing";
import { FormBuilder } from "@angular/forms";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import { vi } from "vitest";
import { HttpAdapterDialogComponent } from "./http-adapter-dialog.component";

describe("HttpAdapterDialogComponent", () => {
  let fixture: ComponentFixture<HttpAdapterDialogComponent>;
  const dialogRef = { close: vi.fn() };

  beforeEach(async () => {
    dialogRef.close.mockReset();
    await TestBed.configureTestingModule({
      imports: [HttpAdapterDialogComponent],
      providers: [
        FormBuilder,
        {
          provide: MAT_DIALOG_DATA,
          useValue: { mode: "create" as const },
        },
        {
          provide: MatDialogRef,
          useValue: dialogRef,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HttpAdapterDialogComponent);
    fixture.detectChanges();
  });

  it("renders dialog title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Connector");
  });

  it("serializes cache settings into the dialog result payload", () => {
    const component = fixture.componentInstance;

    component.form.patchValue({
      name: "Cacheable Connector",
      baseUrl: "https://api.example.com",
      defaultCache: {
        enabled: true,
        ttlSeconds: 120,
        methods: ["GET", "POST"],
        keyBody: true,
        keyHeaders: ["x-region"],
        queryParamsMode: "custom",
        keyQueryParamsList: ["page"],
      },
    });

    component.endpoints.push(
      TestBed.inject(FormBuilder).group({
        id: ["ep-1"],
        label: ["Search"],
        method: ["POST"],
        path: ["/search"],
        cache: TestBed.inject(FormBuilder).group({
          enabled: true,
          ttlSeconds: [45],
          methods: [["POST"]],
          keyBody: [true],
          keyHeaders: [["x-customer"]],
          queryParamsMode: ["all"],
          keyQueryParamsList: [[]],
        }),
      }),
    );

    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith({
      context: "internal",
      adapter: {
        name: "Cacheable Connector",
        baseUrl: "https://api.example.com",
        auth: { type: "none" },
        headers: [],
        defaultCache: {
          enabled: true,
          ttlSeconds: 120,
          methods: ["GET", "POST"],
          keyBody: true,
          keyHeaders: ["x-region"],
          keyQueryParams: ["page"],
        },
        endpoints: [
          {
            id: "ep-1",
            label: "Search",
            method: "POST",
            path: "/search",
            cache: {
              enabled: true,
              ttlSeconds: 45,
              methods: ["POST"],
              keyBody: true,
              keyHeaders: ["x-customer"],
              keyQueryParams: "all",
            },
          },
        ],
        timeoutMs: 5000,
        maxRetries: 3,
        retryBackoffMs: 1000,
        healthCheckPath: "/health",
        tags: [],
        isEncrypted: false,
      },
    });
  });
});
