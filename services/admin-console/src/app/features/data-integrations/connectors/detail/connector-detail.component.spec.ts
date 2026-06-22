import { type ComponentFixture, TestBed } from "@angular/core/testing";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from "@angular/router";
import { BehaviorSubject, of, throwError } from "rxjs";
import { vi } from "vitest";
import { AuthService } from "../../../../core/services/auth.service";
import { ConnectorCallService } from "../../../../core/services/connector-call.service";
import type { IAdapterDto } from "../../../../core/services/http-adapter.service";
import { HttpAdapterService } from "../../../../core/services/http-adapter.service";
import { ConnectorDetailComponent } from "./connector-detail.component";

function makeAdapter(overrides: Partial<IAdapterDto> = {}): IAdapterDto {
  return {
    id: "adp-1",
    tenantId: "t1",
    name: "My Connector",
    context: "test",
    baseUrl: "https://api.example.com",
    authType: "none",
    authConfig: {},
    headers: [],
    defaultCache: undefined,
    timeoutMs: 5000,
    maxRetries: 3,
    retryBackoffMs: 100,
    healthCheckPath: "/health",
    status: "enabled" as never,
    tags: [],
    isEncrypted: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    endpoints: [],
    ...overrides,
  };
}

describe("ConnectorDetailComponent", () => {
  let fixture: ComponentFixture<ConnectorDetailComponent>;
  let adapters: { get: ReturnType<typeof vi.fn> };
  let calls: { recentCalls: ReturnType<typeof vi.fn> };
  let hasPermission: ReturnType<typeof vi.fn>;
  let paramMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  async function setup(adapterObs = of(makeAdapter()), permissionValue = true) {
    paramMap$ = new BehaviorSubject(convertToParamMap({ id: "adp-1" }));
    adapters = { get: vi.fn().mockReturnValue(adapterObs) };
    calls = { recentCalls: vi.fn().mockReturnValue(of([])) };
    hasPermission = vi.fn().mockReturnValue(permissionValue);

    await TestBed.configureTestingModule({
      imports: [ConnectorDetailComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: paramMap$.asObservable() },
        },
        { provide: HttpAdapterService, useValue: adapters },
        { provide: ConnectorCallService, useValue: calls },
        { provide: AuthService, useValue: { hasPermission } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConnectorDetailComponent);
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it("hasCacheConfig() is false when defaultCache is absent and no endpoint has cache.enabled", async () => {
    await setup(of(makeAdapter({ defaultCache: undefined, endpoints: [] })));
    expect(fixture.componentInstance.hasCacheConfig()).toBe(false);
  });

  it("hasCacheConfig() is true when defaultCache.enabled = true", async () => {
    await setup(
      of(
        makeAdapter({
          defaultCache: { enabled: true, ttlSeconds: 60 },
          endpoints: [],
        })
      )
    );
    expect(fixture.componentInstance.hasCacheConfig()).toBe(true);
  });

  it("hasCacheConfig() is true when only an endpoint has cache.enabled = true (defaultCache absent)", async () => {
    await setup(
      of(
        makeAdapter({
          defaultCache: undefined,
          endpoints: [
            {
              id: "ep-1",
              adapterId: "adp-1",
              label: "Get items",
              method: "GET",
              path: "/items",
              cache: { enabled: true, ttlSeconds: 30 },
              createdAt: "2026-01-01T00:00:00Z",
            },
          ],
        })
      )
    );
    expect(fixture.componentInstance.hasCacheConfig()).toBe(true);
  });

  it("sets errorMessage when HttpAdapterService.get errors", async () => {
    await setup(throwError(() => new Error("Not found")));
    expect(fixture.componentInstance.errorMessage()).toBe(
      "Failed to load connector."
    );
    expect(fixture.componentInstance.loading()).toBe(false);
  });

  it("canViewCalls() is false and recentCalls is NOT called when permission is denied", async () => {
    await setup(of(makeAdapter()), false);
    expect(fixture.componentInstance.canViewCalls()).toBe(false);
    expect(calls.recentCalls).not.toHaveBeenCalled();
  });
});
