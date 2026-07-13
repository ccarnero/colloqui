import "@angular/compiler";
import { type ComponentFixture, TestBed } from "@angular/core/testing";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from "@angular/router";
import { BehaviorSubject, of, throwError } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../../../../core/services/auth.service";
import {
  ConnectorCallService,
  type IConnectorCall,
} from "../../../../core/services/connector-call.service";
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

  async function setup(
    adapterObs = of(makeAdapter()),
    permissionValue = true,
    callsObs = of<IConnectorCall[]>([])
  ) {
    paramMap$ = new BehaviorSubject(convertToParamMap({ id: "adp-1" }));
    adapters = { get: vi.fn().mockReturnValue(adapterObs) };
    calls = { recentCalls: vi.fn().mockReturnValue(callsObs) };
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

  it("shows the 7-day window in the empty state copy", async () => {
    await setup(of(makeAdapter()), true, of([]));

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("No calls in the last 7 days.");
  });

  it("passes the default (7-day) window through to recentCalls", async () => {
    await setup(of(makeAdapter()), true, of([]));

    expect(calls.recentCalls).toHaveBeenCalledWith("adp-1", undefined, 20);
  });

  it("shows cache hit calls even when current cache config is absent", async () => {
    await setup(
      of(makeAdapter({ defaultCache: undefined, endpoints: [] })),
      true,
      of([
        {
          adapterId: "adp-1",
          endpointId: "ep-1",
          method: "GET",
          resolvedUrl: "https://api.example.com/data",
          status: 200,
          durationMs: 20,
          cacheResult: "hit",
          timestamp: "2026-06-01T12:00:00.000Z",
        },
      ])
    );

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("Cache hits (7d)");
    expect(text).toContain("hit");
  });

  it("renders the scalar row + View trace link, with the dead REQUEST/RESPONSE sections removed (T09)", async () => {
    await setup(
      of(makeAdapter({ defaultCache: undefined, endpoints: [] })),
      true,
      of([
        {
          adapterId: "adp-1",
          endpointId: "ep-1",
          method: "GET",
          resolvedUrl: "https://api.example.com/data",
          status: 200,
          durationMs: 20,
          cacheResult: "hit",
          timestamp: "2026-06-01T12:00:00.000Z",
          correlationId: "corr-42",
        },
      ])
    );

    const host = fixture.nativeElement as HTMLElement;
    // Scalar row present.
    expect(host.querySelector(".call-row")).toBeTruthy();
    const text = host.textContent ?? "";
    expect(text).toContain("GET");
    expect(text).toContain("200");
    // View-trace link present and always visible (no expand needed).
    const trace = host.querySelector(
      "a.trace-link[href='/processes/trace/corr-42']"
    );
    expect(trace).toBeTruthy();
    // Dead audit-era expand/detail markup gone.
    expect(host.querySelector(".call-detail")).toBeFalsy();
    expect(host.querySelector(".detail-section")).toBeFalsy();
    expect(text).not.toContain("Request");
    expect(text).not.toContain("Response");
  });
});
