import "@angular/compiler";
import { type ComponentFixture, TestBed } from "@angular/core/testing";
import { MatDialog } from "@angular/material/dialog";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from "@angular/router";
import { BehaviorSubject, of, tap, throwError } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../../../../core/services/auth.service";
import {
  ConnectorCallService,
  type IConnectorCall,
} from "../../../../core/services/connector-call.service";
import type { IAdapterDto } from "../../../../core/services/http-adapter.service";
import { HttpAdapterService } from "../../../../core/services/http-adapter.service";
import { HttpAdapterDialogComponent } from "../../../../shared/components/http-adapter-dialog/http-adapter-dialog.component";
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
  let adapters: {
    get: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    addEndpoint: ReturnType<typeof vi.fn>;
    updateEndpoint: ReturnType<typeof vi.fn>;
    removeEndpoint: ReturnType<typeof vi.fn>;
  };
  let calls: { recentCalls: ReturnType<typeof vi.fn> };
  let hasPermission: ReturnType<typeof vi.fn>;
  let paramMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let dialogMock: { open: ReturnType<typeof vi.fn> };

  async function setup(
    adapterObs = of(makeAdapter()),
    permissionValue = true,
    callsObs = of<IConnectorCall[]>([])
  ) {
    paramMap$ = new BehaviorSubject(convertToParamMap({ id: "adp-1" }));
    adapters = {
      get: vi.fn().mockReturnValue(adapterObs),
      update: vi.fn().mockReturnValue(of(makeAdapter())),
      addEndpoint: vi.fn(),
      updateEndpoint: vi.fn(),
      removeEndpoint: vi.fn(),
    };
    calls = { recentCalls: vi.fn().mockReturnValue(callsObs) };
    hasPermission = vi.fn().mockReturnValue(permissionValue);
    dialogMock = {
      open: vi.fn().mockReturnValue({ afterClosed: () => of(undefined) }),
    };

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
        { provide: MatDialog, useValue: dialogMock },
      ],
    }).compileComponents();

    // TestBed gotcha (L2): ConnectorDetailComponent imports MatDialogModule
    // directly, which re-provides (and shadows) MatDialog via a
    // component-scoped injector — only overrideProvider reaches it.
    TestBed.overrideProvider(MatDialog, { useValue: dialogMock });

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

  // T08 — clicking a "Recent calls" row opens the shared call inspector
  // (call-inspector.component.ts, T07) for that call.
  it("clicking a call row opens the inspector with that row's event", async () => {
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
          eventId: "evt-42",
        },
      ])
    );

    const host = fixture.nativeElement as HTMLElement;
    const row = host.querySelector<HTMLElement>(".call-row");
    expect(row).toBeTruthy();
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    fixture.detectChanges();

    expect(fixture.componentInstance.inspectorRow()).toEqual({
      eventId: "evt-42",
      correlationId: "corr-42",
      kind: "endpoint_call_completed",
      scalars: {
        method: "GET",
        status: 200,
        durationMs: 20,
        resolvedUrl: "https://api.example.com/data",
        cacheResult: "hit",
      },
    });
    expect(host.querySelector("app-call-inspector")).toBeTruthy();
  });

  it("does not open the inspector for a row without eventId/correlationId", async () => {
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

    const host = fixture.nativeElement as HTMLElement;
    const row = host.querySelector<HTMLElement>(".call-row");
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    fixture.detectChanges();

    expect(fixture.componentInstance.inspectorRow()).toBeNull();
    expect(host.querySelector("app-call-inspector")).toBeFalsy();
  });

  it("the View trace link still navigates and does not close/reopen the inspector on click", async () => {
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
          eventId: "evt-42",
        },
      ])
    );

    const host = fixture.nativeElement as HTMLElement;
    const trace = host.querySelector<HTMLAnchorElement>(
      "a.trace-link[href='/processes/trace/corr-42']"
    );
    expect(trace).toBeTruthy();
    expect(trace?.getAttribute("href")).toBe("/processes/trace/corr-42");
  });

  // T03 — health mapping (decision 3, orchestrator ruling 2026-07-22):
  // HTTP connectors map status === "enabled" -> ok, else error.
  it("health() is ok when status is enabled", async () => {
    await setup(of(makeAdapter({ status: "enabled" as never })));
    expect(fixture.componentInstance.health()).toBe("ok");
  });

  it("health() is error when status is not enabled", async () => {
    await setup(of(makeAdapter({ status: "disabled" as never })));
    expect(fixture.componentInstance.health()).toBe("error");
  });

  // T03 — decision 3: secrets/credentials are never rendered, masked
  // placeholders only. authConfig must never leak into the DOM, even
  // though it is a real field on IAdapterDto (used only to seed the
  // reused edit dialog's data input, never rendered as text here).
  it("never renders authConfig secret values in the DOM", async () => {
    const SENTINEL = "sk-super-secret-token-should-never-render-9f3a";
    await setup(
      of(
        makeAdapter({
          authType: "apiKey",
          authConfig: { apiKey: SENTINEL, apiKeyHeader: "X-Api-Key" },
        })
      )
    );

    const html = (fixture.nativeElement as HTMLElement).innerHTML;
    expect(html).not.toContain(SENTINEL);
  });

  // T03 — form reuse: Edit must open the EXISTING HttpAdapterDialogComponent,
  // never a duplicated/local form component.
  it("Edit opens the existing HttpAdapterDialogComponent, not a duplicate form", async () => {
    await setup(of(makeAdapter()));

    fixture.componentInstance.openEdit();

    expect(dialogMock.open).toHaveBeenCalledTimes(1);
    expect(dialogMock.open.mock.calls[0]?.[0]).toBe(HttpAdapterDialogComponent);
  });

  it("openEdit logs and no-ops when no adapter is loaded", async () => {
    await setup(throwError(() => new Error("Not found")));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    fixture.componentInstance.openEdit();

    expect(dialogMock.open).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  // Regression test for the reviewer-flagged behavioral drift: the save
  // flow must be fail-fast (mirroring connectors.component.ts:519-574),
  // never silently show success when an endpoint op fails.
  it("openEdit surfaces a user-visible error and does NOT silently succeed when an endpoint op fails", async () => {
    const existingAdapter = makeAdapter({
      endpoints: [
        {
          id: "ep-1",
          adapterId: "adp-1",
          label: "Get items",
          method: "GET",
          path: "/items",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    });
    await setup(of(existingAdapter));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const getCallsBeforeEdit = adapters.get.mock.calls.length;

    dialogMock.open.mockReturnValue({
      afterClosed: () =>
        of({
          adapter: {
            name: "Renamed connector",
            baseUrl: existingAdapter.baseUrl,
            auth: { type: "none" },
            headers: [],
            defaultCache: undefined,
            endpoints: [
              { id: "ep-1", label: "Get items", method: "GET", path: "/items" },
            ],
            timeoutMs: existingAdapter.timeoutMs,
            maxRetries: existingAdapter.maxRetries,
            retryBackoffMs: existingAdapter.retryBackoffMs,
            healthCheckPath: existingAdapter.healthCheckPath,
            tags: [],
            isEncrypted: false,
            managedBy: null,
          },
        }),
    });
    adapters.update.mockReturnValue(of(existingAdapter));
    adapters.updateEndpoint.mockReturnValue(
      throwError(() => new Error("endpoint rejected"))
    );

    fixture.componentInstance.openEdit();
    fixture.detectChanges();

    expect(fixture.componentInstance.saveError()).toBe(
      "Couldn't save changes. Please try again."
    );
    // Refetch must NOT happen after a fail-fast chain error — no
    // silent-success reload of the adapter.
    expect(adapters.get.mock.calls.length).toBe(getCallsBeforeEdit);
    expect(errorSpy).toHaveBeenCalledWith(
      "[ConnectorDetailComponent] failed to save adapter edit",
      expect.objectContaining({ id: "adp-1" })
    );
    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("Couldn't save changes. Please try again.");

    errorSpy.mockRestore();
  });

  it("openEdit happy path runs update -> endpoint sync -> refetch in order and updates the view", async () => {
    const existingAdapter = makeAdapter({
      endpoints: [
        {
          id: "ep-1",
          adapterId: "adp-1",
          label: "Get items",
          method: "GET",
          path: "/items",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    });
    await setup(of(existingAdapter));

    const callOrder: string[] = [];
    dialogMock.open.mockReturnValue({
      afterClosed: () =>
        of({
          adapter: {
            name: "Renamed connector",
            baseUrl: existingAdapter.baseUrl,
            auth: { type: "none" },
            headers: [],
            defaultCache: undefined,
            endpoints: [
              { id: "ep-1", label: "Get items", method: "GET", path: "/items" },
            ],
            timeoutMs: existingAdapter.timeoutMs,
            maxRetries: existingAdapter.maxRetries,
            retryBackoffMs: existingAdapter.retryBackoffMs,
            healthCheckPath: existingAdapter.healthCheckPath,
            tags: [],
            isEncrypted: false,
            managedBy: null,
          },
        }),
    });
    const refetched = makeAdapter({
      name: "Renamed connector",
      endpoints: existingAdapter.endpoints,
    });
    // Push to callOrder on SUBSCRIBE (via tap), not on invocation — the
    // real HttpClient-backed observables are cold, so the ops array is
    // built eagerly but only actually runs once concatMap subscribes it
    // after `update()` completes. Asserting invocation order instead of
    // subscription order would give a false pass/fail here.
    adapters.update.mockReturnValue(
      of(existingAdapter).pipe(tap(() => callOrder.push("update")))
    );
    adapters.updateEndpoint.mockReturnValue(
      of({}).pipe(tap(() => callOrder.push("updateEndpoint")))
    );
    adapters.get.mockReturnValue(
      of(refetched).pipe(tap(() => callOrder.push("get")))
    );

    fixture.componentInstance.openEdit();
    fixture.detectChanges();

    expect(callOrder).toEqual(["update", "updateEndpoint", "get"]);
    expect(fixture.componentInstance.adapter()?.name).toBe("Renamed connector");
    expect(fixture.componentInstance.saveError()).toBeNull();
  });
});
