import { signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { MatDialog } from "@angular/material/dialog";
import { provideRouter, Router } from "@angular/router";
import { of } from "rxjs";
import { vi } from "vitest";
import type { IRegisteredService } from "../../../core/models/registry.model";
import { RegistryService } from "../../../core/services/registry.service";
import { TenantService } from "../../../core/services/tenant.service";
import { HostedServicesComponent } from "./hosted-services.component";

function buildService(
  overrides: Partial<IRegisteredService> = {}
): IRegisteredService {
  return {
    id: "svc-1",
    tenantId: "t1",
    name: "billing-api",
    image: "registry.local/billing-api:1.0.0",
    port: 8080,
    minScale: 0,
    maxScale: 3,
    concurrencyTarget: 10,
    envVars: {},
    status: "active",
    knativeName: "billing-api-knative",
    namespace: "default",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function renderComponent(
  services: IRegisteredService[] = [buildService()]
): Promise<{
  fixture: ComponentFixture<HostedServicesComponent>;
  navigate: ReturnType<typeof vi.fn>;
  registry: {
    loadServices: ReturnType<typeof vi.fn>;
    getService: ReturnType<typeof vi.fn>;
    deleteService: ReturnType<typeof vi.fn>;
  };
  dialogOpen: ReturnType<typeof vi.fn>;
}> {
  const navigate = vi.fn().mockResolvedValue(true);
  const registry = {
    loadServices: vi.fn(),
    getService: vi.fn().mockReturnValue(of(buildService())),
    deleteService: vi.fn(),
    services: signal(services),
    loading: signal(false),
  };
  const dialogOpen = vi.fn().mockReturnValue({
    afterClosed: () => of(undefined),
  });

  await TestBed.configureTestingModule({
    imports: [HostedServicesComponent],
    providers: [
      provideRouter([]),
      { provide: Router, useValue: { navigate } },
      { provide: RegistryService, useValue: registry },
      {
        provide: TenantService,
        useValue: {
          currentTenant: signal({
            id: "t1",
            name: "Test Tenant",
            configuration: {},
          }),
        },
      },
    ],
  })
    // MatDialogModule is imported by the standalone component, so its own
    // provider shadows a plain `providers` entry — override it explicitly.
    .overrideProvider(MatDialog, { useValue: { open: dialogOpen } })
    .compileComponents();

  const fixture = TestBed.createComponent(HostedServicesComponent);
  fixture.detectChanges();
  return { fixture, navigate, registry, dialogOpen };
}

function rowOf(
  fixture: ComponentFixture<HostedServicesComponent>
): HTMLElement {
  const el = fixture.nativeElement as HTMLElement;
  const row = el.querySelector("tr.clickable-row");
  expect(row).toBeTruthy();
  return row as HTMLElement;
}

describe("HostedServicesComponent", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it("renders Hosted Services title", async () => {
    const { fixture } = await renderComponent();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Hosted Services");
  });

  it("navigates to the hosted service detail page on row click", async () => {
    const { fixture, navigate } = await renderComponent([
      buildService({ id: "svc-42", name: "orders-api" }),
    ]);

    rowOf(fixture).click();

    expect(navigate).toHaveBeenCalledWith([
      "/connections/hosted-services",
      "svc-42",
    ]);
  });

  it("navigates on Enter and on Space", async () => {
    const { fixture, navigate } = await renderComponent([
      buildService({ id: "svc-7" }),
    ]);
    const row = rowOf(fixture);

    row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(navigate).toHaveBeenCalledWith([
      "/connections/hosted-services",
      "svc-7",
    ]);

    navigate.mockClear();
    row.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    expect(navigate).toHaveBeenCalledWith([
      "/connections/hosted-services",
      "svc-7",
    ]);
  });

  it("exposes the row as an accessible button naming the service", async () => {
    const { fixture } = await renderComponent([
      buildService({ id: "svc-9", name: "payments-api" }),
    ]);
    const row = rowOf(fixture);

    expect(row.getAttribute("role")).toBe("button");
    expect(row.getAttribute("tabindex")).toBe("0");
    expect(row.getAttribute("aria-label")).toBe("View payments-api");
  });

  it("navigates from the explicit view action", async () => {
    const { fixture, navigate } = await renderComponent([
      buildService({ id: "svc-view" }),
    ]);
    const el = fixture.nativeElement as HTMLElement;
    const viewButton = el.querySelector(
      'button[aria-label="View service"]'
    ) as HTMLButtonElement;
    expect(viewButton).toBeTruthy();

    viewButton.click();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith([
      "/connections/hosted-services",
      "svc-view",
    ]);
  });

  it("does not navigate when the Edit action is clicked", async () => {
    const { fixture, navigate, dialogOpen } = await renderComponent([
      buildService({ id: "svc-edit" }),
    ]);
    const el = fixture.nativeElement as HTMLElement;
    const editButton = el.querySelector(
      'button[aria-label="Edit service"]'
    ) as HTMLButtonElement;

    editButton.click();

    expect(dialogOpen).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does not navigate when the Delete action is clicked", async () => {
    const { fixture, navigate, registry } = await renderComponent([
      buildService({ id: "svc-del" }),
    ]);
    const el = fixture.nativeElement as HTMLElement;
    const deleteButton = el.querySelector(
      'button[aria-label="Delete service"]'
    ) as HTMLButtonElement;

    deleteButton.click();

    expect(registry.deleteService).toHaveBeenCalledWith("svc-del");
    expect(navigate).not.toHaveBeenCalled();
  });
});
