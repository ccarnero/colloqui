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
import type { IServiceDetail } from "../../../core/models/registry.model";
import { AuthService } from "../../../core/services/auth.service";
import {
  ConnectorCallService,
  type IServiceCall,
} from "../../../core/services/connector-call.service";
import { RegistryService } from "../../../core/services/registry.service";
import { HostedServiceDetailComponent } from "./hosted-service-detail.component";

function makeService(overrides: Partial<IServiceDetail> = {}): IServiceDetail {
  return {
    id: "hosted-1",
    tenantId: "t1",
    name: "echo-service",
    image: "registry/echo:latest",
    port: 8080,
    minScale: 0,
    maxScale: 3,
    concurrencyTarget: 10,
    envVars: {},
    status: "active",
    knativeName: "echo-service-knative",
    namespace: "tenant-t1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("HostedServiceDetailComponent", () => {
  let fixture: ComponentFixture<HostedServiceDetailComponent>;
  let registryService: {
    getService: ReturnType<typeof vi.fn>;
    listServices: ReturnType<typeof vi.fn>;
  };
  let calls: { recentServiceCalls: ReturnType<typeof vi.fn> };
  let paramMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  async function setup(
    getServiceObs = of(makeService()),
    callsObs = of<IServiceCall[]>([]),
    routeParam = "hosted-1"
  ) {
    paramMap$ = new BehaviorSubject(convertToParamMap({ id: routeParam }));
    registryService = {
      getService: vi.fn().mockReturnValue(getServiceObs),
      listServices: vi.fn().mockReturnValue(of([])),
    };
    calls = { recentServiceCalls: vi.fn().mockReturnValue(callsObs) };

    await TestBed.configureTestingModule({
      imports: [HostedServiceDetailComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: paramMap$.asObservable() },
        },
        { provide: RegistryService, useValue: registryService },
        { provide: ConnectorCallService, useValue: calls },
        { provide: AuthService, useValue: { hasPermission: () => true } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HostedServiceDetailComponent);
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it("resolves the service directly by the id route param", async () => {
    await setup();
    expect(registryService.getService).toHaveBeenCalledWith("hosted-1");
    expect(fixture.componentInstance.server()?.id).toBe("hosted-1");
    expect(fixture.componentInstance.loading()).toBe(false);
  });

  it("sets errorMessage when getService errors and the name fallback also finds nothing", async () => {
    await setup(throwError(() => new Error("Not found")));
    expect(fixture.componentInstance.errorMessage()).toBe(
      "Failed to load hosted service."
    );
    expect(fixture.componentInstance.loading()).toBe(false);
  });

  it("renders the name, base URL, and a masked auth chip (Configuration section)", async () => {
    await setup();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("echo-service");
    expect(text).toContain(
      "http://echo-service-knative.tenant-t1.svc.cluster.local"
    );
    expect(text).toContain("Internal (tenant-scoped)");
  });

  it('shows "—" for base URL when the service has no Knative deployment yet', async () => {
    await setup(of(makeService({ knativeName: null, namespace: null })));
    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("—");
  });

  it("renders the recent-calls empty state naming the 7-day window", async () => {
    await setup();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("No calls in the last 7 days.");
  });

  describe("T11 — name fallback resolution", () => {
    it("resolves by name via listServices when getService(id) 404s, then loads that service's recent calls by name", async () => {
      paramMap$ = new BehaviorSubject(
        convertToParamMap({ id: "echo-service" })
      );
      registryService = {
        getService: vi
          .fn()
          .mockReturnValueOnce(throwError(() => new Error("404")))
          .mockReturnValueOnce(of(makeService({ id: "hosted-1" }))),
        listServices: vi.fn().mockReturnValue(
          of([
            { id: "hosted-1", name: "echo-service" },
            { id: "hosted-2", name: "other-service" },
          ])
        ),
      };
      calls = { recentServiceCalls: vi.fn().mockReturnValue(of([])) };

      await TestBed.configureTestingModule({
        imports: [HostedServiceDetailComponent],
        providers: [
          provideRouter([]),
          provideNoopAnimations(),
          {
            provide: ActivatedRoute,
            useValue: { paramMap: paramMap$.asObservable() },
          },
          { provide: RegistryService, useValue: registryService },
          { provide: ConnectorCallService, useValue: calls },
          { provide: AuthService, useValue: { hasPermission: () => true } },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(HostedServiceDetailComponent);
      fixture.detectChanges();

      expect(registryService.getService).toHaveBeenNthCalledWith(
        1,
        "echo-service"
      );
      expect(registryService.listServices).toHaveBeenCalledTimes(1);
      expect(registryService.getService).toHaveBeenNthCalledWith(2, "hosted-1");
      expect(fixture.componentInstance.server()?.id).toBe("hosted-1");
      expect(fixture.componentInstance.errorMessage()).toBeNull();
      expect(calls.recentServiceCalls).toHaveBeenCalledWith(
        "echo-service",
        undefined,
        20
      );
    });

    it("surfaces an error when no service matches the route param by id or name", async () => {
      paramMap$ = new BehaviorSubject(convertToParamMap({ id: "ghost" }));
      registryService = {
        getService: vi.fn().mockReturnValue(throwError(() => new Error("404"))),
        listServices: vi
          .fn()
          .mockReturnValue(of([{ id: "hosted-1", name: "echo-service" }])),
      };
      calls = { recentServiceCalls: vi.fn().mockReturnValue(of([])) };

      await TestBed.configureTestingModule({
        imports: [HostedServiceDetailComponent],
        providers: [
          provideRouter([]),
          provideNoopAnimations(),
          {
            provide: ActivatedRoute,
            useValue: { paramMap: paramMap$.asObservable() },
          },
          { provide: RegistryService, useValue: registryService },
          { provide: ConnectorCallService, useValue: calls },
          { provide: AuthService, useValue: { hasPermission: () => true } },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(HostedServiceDetailComponent);
      fixture.detectChanges();

      expect(fixture.componentInstance.errorMessage()).toBe(
        "Failed to load hosted service."
      );
      expect(fixture.componentInstance.loading()).toBe(false);
    });
  });

  describe("T11 — Recent calls + inspector", () => {
    function makeServiceCall(
      overrides: Partial<IServiceCall> = {}
    ): IServiceCall {
      return {
        serviceName: "echo-service",
        method: "POST",
        resolvedUrl:
          "http://echo-service-knative.tenant-t1.svc.cluster.local/echo",
        status: 200,
        durationMs: 42,
        cacheResult: null,
        timestamp: "2026-06-01T12:00:00.000Z",
        correlationId: "corr-42",
        eventId: "evt-42",
        ...overrides,
      };
    }

    it("loads recent calls filtered by the resolved service's name", async () => {
      await setup(of(makeService()), of([makeServiceCall()]));
      expect(calls.recentServiceCalls).toHaveBeenCalledWith(
        "echo-service",
        undefined,
        20
      );
      const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
      expect(text).toContain("POST");
    });

    it("clicking a call row opens the inspector with that row's event", async () => {
      await setup(of(makeService()), of([makeServiceCall()]));

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
          method: "POST",
          status: 200,
          durationMs: 42,
          resolvedUrl:
            "http://echo-service-knative.tenant-t1.svc.cluster.local/echo",
          cacheResult: null,
        },
      });
      expect(host.querySelector("app-call-inspector")).toBeTruthy();
    });

    it("does not open the inspector for a row without eventId/correlationId", async () => {
      await setup(
        of(makeService()),
        of([makeServiceCall({ correlationId: undefined, eventId: undefined })])
      );

      const host = fixture.nativeElement as HTMLElement;
      const row = host.querySelector<HTMLElement>(".call-row");
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      fixture.detectChanges();

      expect(fixture.componentInstance.inspectorRow()).toBeNull();
      expect(host.querySelector("app-call-inspector")).toBeFalsy();
    });

    it("the View trace link navigates to /processes/trace/<correlationId> and does not toggle the inspector", async () => {
      await setup(of(makeService()), of([makeServiceCall()]));

      const host = fixture.nativeElement as HTMLElement;
      const trace = host.querySelector<HTMLAnchorElement>(
        "a.trace-link[href='/processes/trace/corr-42']"
      );
      expect(trace).toBeTruthy();
      expect(trace?.getAttribute("href")).toBe("/processes/trace/corr-42");
    });
  });
});
