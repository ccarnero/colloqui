import { Component } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { type Observable, of, Subject } from "rxjs";
import { describe, expect, it } from "vitest";
import { AgentAdminService } from "../../../../../../core/services/agent-admin.service";
import { ChannelAdminService } from "../../../../../../core/services/channel-admin.service";
import {
  HttpAdapterService,
  type IAdapterDto,
} from "../../../../../../core/services/http-adapter.service";
import { RegistryService } from "../../../../../../core/services/registry.service";
import {
  EWorkflowNodeType,
  type IWorkflowNode,
} from "../../../domain/workflow-node.types";
import { WorkflowNodeConfigComponent } from "./workflow-node-config.component";

/**
 * Fix 2 (retention-endpoint loop): the HTTP connector node inspector's
 * Endpoint select must ALWAYS show the configured endpoint (method + path)
 * in the closed control, never fall back to its placeholder while a real
 * value is configured — whether the adapters() list hasn't loaded yet or
 * the endpoint has since been removed from the adapter.
 */
function makeNode(configuration: Record<string, unknown> = {}): IWorkflowNode {
  return {
    key: "node-1",
    type: EWorkflowNodeType.ENDPOINT_CALL,
    name: "searchContact",
    icon: "http",
    position: { x: 0, y: 0 },
    configuration,
  };
}

const ADAPTER: IAdapterDto = {
  id: "adapter-1",
  tenantId: "t1",
  name: "demo-hubspot",
  context: "crm",
  baseUrl: "https://api.hubspot.com",
  authType: "none",
  authConfig: {},
  headers: [],
  timeoutMs: 5000,
  endpoints: [
    {
      id: "ep-1",
      adapterId: "adapter-1",
      label: "Search contacts",
      method: "POST",
      path: "/crm/v3/objects/contacts/search",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
} as unknown as IAdapterDto;

@Component({
  selector: "app-node-config-test-host",
  imports: [WorkflowNodeConfigComponent],
  template: `<app-workflow-node-config [node]="node" />`,
})
class TestHostComponent {
  node: IWorkflowNode | null = null;
}

async function createFixture(
  node: IWorkflowNode,
  adapterList$: Observable<IAdapterDto[]>
): Promise<ComponentFixture<TestHostComponent>> {
  await TestBed.configureTestingModule({
    imports: [TestHostComponent],
    providers: [
      {
        provide: HttpAdapterService,
        useValue: { list: () => adapterList$ },
      },
      {
        provide: ChannelAdminService,
        useValue: { listAccounts: () => of([]) },
      },
      {
        provide: RegistryService,
        useValue: {
          services: () => [],
          loading: () => false,
          loadServices: () => {},
        },
      },
      {
        provide: AgentAdminService,
        useValue: {
          listAgents: () => of({ agents: [] }),
          listMcpServers: () => of([]),
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(TestHostComponent);
  fixture.componentInstance.node = node;
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

function endpointTriggerText(
  fixture: ComponentFixture<TestHostComponent>
): string | null {
  const el = fixture.nativeElement as HTMLElement;
  const select = el.querySelector('[data-testid="endpoint-select"]');
  return select?.textContent?.trim().replace(/\s+/g, " ") ?? null;
}

describe("WorkflowNodeConfigComponent — HTTP connector Endpoint select", () => {
  it("renders the stored endpoint (method + path) when the adapters list has NOT loaded yet", async () => {
    const pending = new Subject<IAdapterDto[]>();
    const node = makeNode({
      adapterId: "adapter-1",
      endpointId: "ep-1",
      method: "POST",
      url: "/crm/v3/objects/contacts/search",
    });
    const fixture = await createFixture(node, pending);

    const text = endpointTriggerText(fixture);
    expect(text).not.toBeNull();
    expect(text).toContain("POST");
    expect(text).toContain("/crm/v3/objects/contacts/search");
    expect(text).not.toContain("(unavailable)");
  });

  it("renders the matched option's label once the endpoint IS present in the loaded adapters list", async () => {
    const node = makeNode({
      adapterId: "adapter-1",
      endpointId: "ep-1",
      method: "POST",
      url: "/crm/v3/objects/contacts/search",
    });
    const fixture = await createFixture(node, of([ADAPTER]));

    const text = endpointTriggerText(fixture);
    expect(text).toContain("Search contacts");
    expect(text).not.toContain("(unavailable)");
  });

  it("marks the endpoint unavailable when the adapters list HAS loaded and no longer contains it (stale/removed)", async () => {
    const node = makeNode({
      adapterId: "adapter-1",
      endpointId: "ep-removed",
      method: "DELETE",
      url: "/crm/v3/objects/contacts/old",
    });
    const fixture = await createFixture(node, of([ADAPTER]));

    const text = endpointTriggerText(fixture);
    expect(text).toContain("DELETE");
    expect(text).toContain("/crm/v3/objects/contacts/old");
    expect(text).toContain("(unavailable)");
  });

  it("renders the placeholder ONLY when the config truly has no endpoint configured", async () => {
    const node = makeNode({ adapterId: "adapter-1", endpointId: "" });
    const fixture = await createFixture(node, of([ADAPTER]));

    const text = endpointTriggerText(fixture);
    expect(text).toContain("Select an endpoint");
  });

  // Live-data regression (dev cluster, crm-support-telegram's
  // searchContact action, confirmed via GET /workflows/:id): the persisted
  // action args are exactly {adapterId, method, url} — NO endpointId field
  // at all. This is the actual root cause of the reported bug (the
  // Endpoint select showed "Select an endpoint" while the canvas card
  // correctly read "POST /crm/v3/objects/contacts/search…"), distinct from
  // the async-loading and stale-id cases covered above.
  it("renders the configured endpoint by matching (method, path) when endpointId was never stored (legacy/ad-hoc identity)", async () => {
    const node = makeNode({
      adapterId: "adapter-1",
      method: "POST",
      url: "/crm/v3/objects/contacts/search",
    });
    const fixture = await createFixture(node, of([ADAPTER]));

    const text = endpointTriggerText(fixture);
    expect(text).toContain("Search contacts");
    expect(text).toContain("POST");
    expect(text).toContain("/crm/v3/objects/contacts/search");
    expect(text).not.toContain("(unavailable)");
  });
});
