import { Component } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { MatDialog } from "@angular/material/dialog";
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
  type Routes,
} from "@angular/router";
import { BehaviorSubject, of } from "rxjs";
import { vi } from "vitest";
import type { IChannelAccount } from "../../core/models/channel-account.model";
import { AuthService } from "../../core/services/auth.service";
import { ChannelAdminService } from "../../core/services/channel-admin.service";
import { ChannelsComponent } from "./channels.component";

const ACTIVE_ACCOUNT_ID = "56ecde94-9789-4041-800d-7675ab54eb1e";
const INACTIVE_ACCOUNT_ID = "9b1f6c3a-2e4a-4b3b-9d3a-1a2b3c4d5e6f";

const mockActiveAccount: IChannelAccount = {
  id: ACTIVE_ACCOUNT_ID,
  channel: "telegram",
  provider: "telegram",
  name: "Test Business",
  externalId: "ext-1",
  accessToken: "token",
  isActive: true,
  createdAt: "2024-01-01T00:00:00.000Z",
};

const mockInactiveAccount: IChannelAccount = {
  id: INACTIVE_ACCOUNT_ID,
  channel: "telegram",
  provider: "telegram",
  name: "Support MX",
  externalId: "ext-2",
  accessToken: "token",
  isActive: false,
  createdAt: "2024-01-02T00:00:00.000Z",
};

@Component({ standalone: true, template: "", selector: "app-stub" })
class StubComponent {}

const testRoutes: Routes = [
  { path: "channels/:channel/accounts/:accountId", component: StubComponent },
  { path: "channels/:channel", component: StubComponent },
];

function buildChannelAdminServiceMock(accounts: IChannelAccount[]) {
  return {
    listAccounts: vi.fn().mockReturnValue(of(accounts)),
    deleteAccount: vi.fn().mockReturnValue(of(undefined)),
    getUsageTotals: vi.fn().mockReturnValue(
      of({
        items: [
          { direction: "ingress", events: 8100, firstTs: null, lastTs: null },
          { direction: "egress", events: 4300, firstTs: null, lastTs: null },
        ],
      })
    ),
  };
}

async function renderChannelsComponent(
  accounts: IChannelAccount[],
  navigate: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(true)
): Promise<{
  fixture: ComponentFixture<ChannelsComponent>;
  navigate: ReturnType<typeof vi.fn>;
}> {
  const paramMap$ = new BehaviorSubject(
    convertToParamMap({ channel: "telegram" })
  );
  await TestBed.configureTestingModule({
    imports: [ChannelsComponent],
    providers: [
      provideRouter(testRoutes),
      {
        provide: ActivatedRoute,
        useValue: { paramMap: paramMap$.asObservable() },
      },
      {
        provide: ChannelAdminService,
        useValue: buildChannelAdminServiceMock(accounts),
      },
      {
        provide: AuthService,
        useValue: {
          hasPermission: vi.fn().mockReturnValue(true),
          tenantId: vi.fn().mockReturnValue("t1"),
        },
      },
      {
        provide: MatDialog,
        useValue: {
          open: vi.fn().mockReturnValue({
            afterClosed: () => of(undefined),
          }),
        },
      },
      { provide: Router, useValue: { navigate } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ChannelsComponent);
  fixture.detectChanges();
  return { fixture, navigate };
}

describe("ChannelsComponent", () => {
  it("renders channel management header", async () => {
    const { fixture } = await renderChannelsComponent([mockActiveAccount]);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Channels");
    expect(el.textContent).toContain("Manage channel accounts");
  });

  describe(
    "fleet table columns (T01 finding 3, FIX T05 — mock's " +
      "CUENTA/IDENTIDAD/ESTADO order)",
    () => {
      it("renders Account/Identity/Status and drops Channel/Created", async () => {
        const { fixture } = await renderChannelsComponent([mockActiveAccount]);
        const el = fixture.nativeElement as HTMLElement;
        const headers = Array.from(
          el.querySelectorAll(".table-header-cell")
        ).map((h) => h.textContent?.trim());
        expect(headers).toEqual(["Account", "Identity", "Status"]);
        expect(headers).not.toContain("Channel");
        expect(headers).not.toContain("Created");
      });
    }
  );

  describe("health mapping (Mapping A, decision 3)", () => {
    it("maps isActive=true to the ok health dot", async () => {
      const { fixture } = await renderChannelsComponent([mockActiveAccount]);
      const el = fixture.nativeElement as HTMLElement;
      const dot = el.querySelector(".health-dot") as HTMLElement;
      expect(dot).toBeTruthy();
      expect(dot.className).toContain("health-dot--ok");
      expect(dot.getAttribute("aria-label")).toBe("health: ok");
    });

    it("maps isActive=false to the error health dot (no warn, no idle)", async () => {
      const { fixture } = await renderChannelsComponent([mockInactiveAccount]);
      const el = fixture.nativeElement as HTMLElement;
      const dot = el.querySelector(".health-dot") as HTMLElement;
      expect(dot).toBeTruthy();
      expect(dot.className).toContain("health-dot--error");
      expect(dot.className).not.toContain("health-dot--warn");
      expect(dot.className).not.toContain("health-dot--idle");
    });

    it("renders one health dot per account, mixed active/inactive", async () => {
      const { fixture } = await renderChannelsComponent([
        mockActiveAccount,
        mockInactiveAccount,
      ]);
      const el = fixture.nativeElement as HTMLElement;
      const dots = Array.from(el.querySelectorAll(".health-dot"));
      expect(dots.length).toBe(2);
      expect(dots[0].className).toContain("health-dot--ok");
      expect(dots[1].className).toContain("health-dot--error");
    });
  });

  describe("empty fleet state", () => {
    it("renders the inventory table empty message when there are no accounts for the channel", async () => {
      const { fixture } = await renderChannelsComponent([]);
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelectorAll(".table-row").length).toBe(0);
      expect(el.textContent).toContain(
        "No accounts found. Connect your first telegram account to get started."
      );
    });
  });

  describe("row click navigation", () => {
    it("navigates to the account detail route when a fleet row is clicked", async () => {
      const { fixture, navigate } = await renderChannelsComponent([
        mockActiveAccount,
      ]);
      const el = fixture.nativeElement as HTMLElement;
      const row = el.querySelector(".table-row") as HTMLElement;
      expect(row).toBeTruthy();
      row.click();
      expect(navigate).toHaveBeenCalledWith([
        "/channels",
        "telegram",
        "accounts",
        ACTIVE_ACCOUNT_ID,
      ]);
    });
  });

  describe("needs-attention panel", () => {
    it("lists only inactive accounts", async () => {
      const { fixture } = await renderChannelsComponent([
        mockActiveAccount,
        mockInactiveAccount,
      ]);
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain(
        "Support MX is inactive and not receiving messages."
      );
      expect(el.textContent).not.toContain(
        "Test Business is inactive and not receiving messages."
      );
      const issueRows = el.querySelectorAll(".issue-row");
      expect(issueRows.length).toBe(1);
      expect(issueRows[0].querySelector(".issue-dot")?.className).toContain(
        "issue-dot--critical"
      );
    });

    it("shows the empty state when there are no inactive accounts", async () => {
      const { fixture } = await renderChannelsComponent([mockActiveAccount]);
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelectorAll(".issue-row").length).toBe(0);
      expect(el.textContent).toContain("No accounts need attention");
    });

    it("navigates to the account detail route when an attention action is clicked", async () => {
      const { fixture, navigate } = await renderChannelsComponent([
        mockInactiveAccount,
      ]);
      const el = fixture.nativeElement as HTMLElement;
      const action = el.querySelector(".issue-action") as HTMLAnchorElement;
      expect(action).toBeTruthy();
      action.click();
      expect(navigate).toHaveBeenCalledWith([
        "/channels",
        "telegram",
        "accounts",
        INACTIVE_ACCOUNT_ID,
      ]);
    });
  });

  describe("fleet strip metrics", () => {
    it("renders the messages 24h kpi from getUsageTotals scoped by channel", async () => {
      const { fixture } = await renderChannelsComponent([mockActiveAccount]);
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain("Messages - 24h");
      expect(el.textContent).toContain("12.4K");
      expect(el.textContent).toContain("8.1K in - 4.3K out");
    });

    it("renders account count kpis derived from the loaded accounts", async () => {
      const { fixture } = await renderChannelsComponent([
        mockActiveAccount,
        mockInactiveAccount,
      ]);
      const el = fixture.nativeElement as HTMLElement;
      const labels = Array.from(el.querySelectorAll(".kpi-label")).map(
        (n) => n.textContent
      );
      expect(labels).toEqual([
        "Messages - 24h",
        "Active accounts",
        "Inactive accounts",
      ]);
      const values = Array.from(el.querySelectorAll(".kpi-value")).map(
        (n) => n.textContent
      );
      expect(values).toEqual(["12.4K", "1", "1"]);
    });
  });
});
