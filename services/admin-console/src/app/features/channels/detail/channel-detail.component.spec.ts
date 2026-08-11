import { ComponentFixture, TestBed } from "@angular/core/testing";
import { MatDialog } from "@angular/material/dialog";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
} from "@angular/router";
import { BehaviorSubject, of, throwError } from "rxjs";
import { vi } from "vitest";
import type { IChannelAccount } from "../../../core/models/channel-account.model";
import { AuthService } from "../../../core/services/auth.service";
import { ChannelAdminService } from "../../../core/services/channel-admin.service";
import { ConfirmDialogComponent } from "../../../shared/components/confirm-dialog/confirm-dialog.component";
import { AccountDialogComponent } from "../account-dialog.component";
import { ChannelDetailComponent } from "./channel-detail.component";

const ACCOUNT_1: IChannelAccount = {
  id: "acct-1",
  channel: "telegram",
  provider: "telegram",
  name: "Ventas AR",
  externalId: "waba-1",
  accessToken: "token-1",
  isActive: true,
};

describe("ChannelDetailComponent", () => {
  let fixture: ComponentFixture<ChannelDetailComponent>;
  let channels: {
    getUsage: ReturnType<typeof vi.fn>;
    getUsageTotals: ReturnType<typeof vi.fn>;
    getStreamMessages: ReturnType<typeof vi.fn>;
    listAccounts: ReturnType<typeof vi.fn>;
    deleteAccount: ReturnType<typeof vi.fn>;
  };
  let dialogMock: { open: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const paramMap$ = new BehaviorSubject(
      convertToParamMap({ channel: "telegram", accountId: "acct-1" })
    );
    channels = {
      getUsage: vi.fn().mockReturnValue(
        of({
          items: [
            {
              bucket: "2026-04-23T10:00:00Z",
              accountId: "acct-1",
              channel: "telegram",
              direction: "ingress",
              events: 10,
            },
          ],
        })
      ),
      getUsageTotals: vi.fn().mockReturnValue(
        of({
          items: [
            {
              direction: "ingress",
              events: 10,
              firstTs: "2026-04-23T10:00:00.000Z",
              lastTs: "2026-04-23T11:00:00.000Z",
            },
            {
              direction: "egress",
              events: 4,
              firstTs: null,
              lastTs: null,
            },
          ],
        })
      ),
      getStreamMessages: vi.fn().mockReturnValue(of({ items: [] })),
      listAccounts: vi.fn().mockReturnValue(of([ACCOUNT_1])),
      deleteAccount: vi.fn().mockReturnValue(of(undefined)),
    };
    dialogMock = {
      open: vi.fn().mockReturnValue({ afterClosed: () => of(undefined) }),
    };
    await TestBed.configureTestingModule({
      imports: [ChannelDetailComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: paramMap$.asObservable() },
        },
        { provide: ChannelAdminService, useValue: channels },
        {
          provide: AuthService,
          useValue: {
            tenantId: () => "tenant-1",
            hasPermission: vi.fn().mockReturnValue(false),
          },
        },
        { provide: MatDialog, useValue: dialogMock },
      ],
    }).compileComponents();
    // Verified: ChannelDetailComponent's direct MatDialogModule import creates a component-scoped
    // injector that re-provides (and shadows) MatDialog, so only overrideProvider reaches it.
    TestBed.overrideProvider(MatDialog, { useValue: dialogMock });
    fixture = TestBed.createComponent(ChannelDetailComponent);
    fixture.detectChanges();
  });

  it("resolves the account for the route param and renders header identity/status", () => {
    expect(channels.listAccounts).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.account()?.id).toBe("acct-1");
    expect(fixture.componentInstance.accountNotFound()).toBe(false);

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Ventas AR");
    expect(el.textContent).toContain("waba-1");
    expect(el.textContent).toContain("Active");
  });

  it(
    "splits the identity row and the action/time-range row (T01 finding 4, " +
      "FIX T05 — mock's two-row rhythm)",
    () => {
      const el = fixture.nativeElement as HTMLElement;
      const header = el.querySelector("app-page-header") as HTMLElement;
      const toolbar = el.querySelector(".detail-toolbar") as HTMLElement;
      expect(header).toBeTruthy();
      expect(toolbar).toBeTruthy();

      // Identity row: name + meta chips + status badge, no Edit/Delete/
      // range/refresh actions leaking into the page-header's own row.
      expect(header.textContent).toContain("Ventas AR");
      expect(header.querySelector("app-status-badge")).toBeTruthy();
      expect(header.textContent).not.toContain("Edit");
      expect(header.textContent).not.toContain("Refresh");

      // Action/time-range row: Edit/Delete + range selector + Refresh.
      expect(toolbar.textContent).toContain("Edit");
      expect(toolbar.textContent).toContain("Delete");
      expect(toolbar.textContent).toContain("Refresh");
      expect(toolbar.querySelector("app-range-selector")).toBeTruthy();
    }
  );

  it("shows a not-found state for an unknown account id, verbose-logged", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    channels.listAccounts.mockReturnValue(of([]));

    fixture.componentInstance.loadAccount();
    fixture.detectChanges();

    expect(fixture.componentInstance.account()).toBeNull();
    expect(fixture.componentInstance.accountNotFound()).toBe(true);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Account not found");
    expect(errorSpy).toHaveBeenCalledWith(
      "[ChannelDetailComponent] account not found for route params",
      expect.objectContaining({ accountId: "acct-1" })
    );
    errorSpy.mockRestore();
  });

  it("opens the account dialog in edit mode with the loaded account", () => {
    fixture.componentInstance.openEdit();

    expect(dialogMock.open).toHaveBeenCalledWith(
      AccountDialogComponent,
      expect.objectContaining({ data: { account: ACCOUNT_1 } })
    );
  });

  it("does not open the edit dialog when no account is loaded", () => {
    channels.listAccounts.mockReturnValue(of([]));
    fixture.componentInstance.loadAccount();
    dialogMock.open.mockClear();

    fixture.componentInstance.openEdit();

    expect(dialogMock.open).not.toHaveBeenCalled();
  });

  it("confirms deletion, calls deleteAccount, and navigates back to the fleet list", () => {
    dialogMock.open.mockReturnValueOnce({ afterClosed: () => of(true) });
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, "navigate").mockResolvedValue(true);

    fixture.componentInstance.confirmDelete();

    expect(dialogMock.open).toHaveBeenCalledWith(
      ConfirmDialogComponent,
      expect.objectContaining({
        data: expect.objectContaining({ title: "Delete Account" }),
      })
    );
    expect(channels.deleteAccount).toHaveBeenCalledWith("acct-1");
    expect(navigateSpy).toHaveBeenCalledWith(["/channels", "telegram"]);
  });

  it("does not delete when the confirm dialog is cancelled", () => {
    dialogMock.open.mockReturnValueOnce({ afterClosed: () => of(false) });

    fixture.componentInstance.confirmDelete();

    expect(channels.deleteAccount).not.toHaveBeenCalled();
  });

  it("logs and skips deletion when the delete call fails", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dialogMock.open.mockReturnValueOnce({ afterClosed: () => of(true) });
    channels.deleteAccount.mockReturnValue(throwError(() => new Error("boom")));

    fixture.componentInstance.confirmDelete();

    expect(errorSpy).toHaveBeenCalledWith(
      "[ChannelDetailComponent] failed to delete account",
      expect.objectContaining({ accountId: "acct-1" })
    );
    errorSpy.mockRestore();
  });

  it("loads usage and totals on init", () => {
    expect(channels.getUsage).toHaveBeenCalledTimes(1);
    expect(channels.getUsageTotals).toHaveBeenCalledTimes(1);
    const call = channels.getUsage.mock.calls[0][0];
    expect(call.accountId).toBe("acct-1");
    expect(call.channel).toBe("telegram");
    expect(call.bucket).toBe("hour");
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(
      "1h"
    );
  });

  it("propagates account context from the route into the header", () => {
    // Header title now renders the resolved account name (T03) rather than
    // the raw accountId placeholder used before the account entity was
    // fetched - the route accountId is still the source of truth used to
    // resolve it, so we assert that wiring directly.
    expect(fixture.componentInstance.accountId()).toBe("acct-1");
    expect(fixture.componentInstance.headerTitle()).toBe("Ventas AR");
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Ventas AR");
  });

  it("falls back to the raw accountId in the title while the account is unresolved", () => {
    channels.listAccounts.mockReturnValue(of([]));
    fixture.componentInstance.loadAccount();
    fixture.detectChanges();
    expect(fixture.componentInstance.headerTitle()).toBe("Account acct-1");
  });

  it("uses hour buckets for the 6h preset", () => {
    fixture.componentInstance.onRangeChange({ mode: "preset", preset: "6h" });

    const call = channels.getUsage.mock.calls.at(-1)?.[0];
    expect(call.bucket).toBe("hour");
    expect(call.accountId).toBe("acct-1");
  });

  it("uses day buckets for the 7d preset", () => {
    fixture.componentInstance.onRangeChange({ mode: "preset", preset: "7d" });

    const call = channels.getUsage.mock.calls.at(-1)?.[0];
    expect(call.bucket).toBe("day");
    expect(call.accountId).toBe("acct-1");
  });

  it("uses exact custom range values when custom selection is valid", () => {
    const from = "2026-04-24T15:00:00.000Z";
    const to = "2026-04-24T16:00:00.000Z";

    fixture.componentInstance.onRangeChange({ mode: "custom", from, to });

    const usageCall = channels.getUsage.mock.calls.at(-1)?.[0];
    const totalsCall = channels.getUsageTotals.mock.calls.at(-1)?.[0];
    expect(usageCall.from).toBe(from);
    expect(usageCall.to).toBe(to);
    expect(usageCall.bucket).toBe("hour");
    expect(totalsCall.from).toBe(from);
    expect(totalsCall.to).toBe(to);
  });

  it("shows an error and skips reload when custom range is invalid", () => {
    channels.getUsage.mockClear();
    channels.getUsageTotals.mockClear();

    fixture.componentInstance.onRangeChange({
      mode: "custom",
      from: "2026-04-24T16:00:00.000Z",
      to: "2026-04-24T15:00:00.000Z",
    });
    fixture.detectChanges();

    expect(channels.getUsage).not.toHaveBeenCalled();
    expect(channels.getUsageTotals).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      "Start date must be before end date"
    );
  });

  it("renders the densified chart even when usage has a single sparse bucket", () => {
    const component = fixture.componentInstance;
    component.resolvedRange.set({
      from: "2026-04-24T00:00:00.000Z",
      to: "2026-04-25T00:00:00.000Z",
      bucket: "hour",
      label: "24h",
    });
    component.usage.set([
      {
        bucket: "2026-04-24T17:00:00.000Z",
        accountId: "acct-1",
        channel: "telegram",
        direction: "ingress",
        events: 5,
      },
    ]);
    component.totals.set([
      {
        direction: "ingress",
        events: 5,
        firstTs: "2026-04-24T17:31:41.000Z",
        lastTs: "2026-04-24T17:59:50.000Z",
      },
    ]);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain(
      "Selected range has activity, but it is too narrow"
    );
    expect(el.querySelector("svg.usage-chart__svg")).not.toBeNull();
    expect(el.querySelectorAll("svg.usage-chart__svg polyline").length).toBe(3);
  });

  it("shows empty message when totals and chart buckets are empty", () => {
    const component = fixture.componentInstance;
    component.usage.set([]);
    component.totals.set([]);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("No usage data for the selected range.");
  });
});
