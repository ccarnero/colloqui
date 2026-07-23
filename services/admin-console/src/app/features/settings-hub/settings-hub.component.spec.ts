import { signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { Router } from "@angular/router";
import { vi } from "vitest";
import { SettingsMetricsService } from "../../core/services/metrics/settings-metrics.service";
import { SettingsHubComponent } from "./settings-hub.component";

async function renderComponent(options: {
  usersActive?: number | null;
  invitationsPending?: number | null;
  navigate?: ReturnType<typeof vi.fn>;
}): Promise<{
  fixture: ComponentFixture<SettingsHubComponent>;
  navigate: ReturnType<typeof vi.fn>;
}> {
  const navigate = options.navigate ?? vi.fn().mockResolvedValue(true);
  const usersActive =
    options.usersActive !== undefined ? options.usersActive : 142;
  const invitationsPending =
    options.invitationsPending !== undefined ? options.invitationsPending : 3;

  await TestBed.configureTestingModule({
    imports: [SettingsHubComponent],
    providers: [
      {
        provide: SettingsMetricsService,
        useValue: {
          usersActive: signal(usersActive),
          invitationsPending: signal(invitationsPending),
        },
      },
      { provide: Router, useValue: { navigate } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(SettingsHubComponent);
  fixture.detectChanges();
  return { fixture, navigate };
}

describe("SettingsHubComponent", () => {
  it("renders the section header", async () => {
    const { fixture } = await renderComponent({});
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Settings");
  });

  describe("nav links (T04 amendment: replaces the field-id snapshot)", () => {
    it("renders the Identity group chips: Users, Roles & permissions, API keys", async () => {
      const { fixture } = await renderComponent({});
      const el = fixture.nativeElement as HTMLElement;
      const chips = Array.from(el.querySelectorAll(".chip")).map((c) =>
        c.textContent?.trim()
      );
      expect(chips).toContain("Users");
      expect(chips).toContain("Roles & permissions");
      expect(chips).toContain("API keys");
    });

    it("renders the Tenant group chip: Billing", async () => {
      const { fixture } = await renderComponent({});
      const el = fixture.nativeElement as HTMLElement;
      const chips = Array.from(el.querySelectorAll(".chip")).map((c) =>
        c.textContent?.trim()
      );
      expect(chips).toContain("Billing");
    });

    it("navigates to /users when the Users chip is clicked", async () => {
      const { fixture, navigate } = await renderComponent({});
      const el = fixture.nativeElement as HTMLElement;
      const chips = Array.from(el.querySelectorAll(".chip"));
      const usersChip = chips.find(
        (c) => c.textContent?.trim() === "Users"
      ) as HTMLElement;
      usersChip.click();
      expect(navigate).toHaveBeenCalledWith(["/users"]);
    });

    it("navigates to /roles when the Roles & permissions chip is clicked", async () => {
      const { fixture, navigate } = await renderComponent({});
      const el = fixture.nativeElement as HTMLElement;
      const chips = Array.from(el.querySelectorAll(".chip"));
      const rolesChip = chips.find(
        (c) => c.textContent?.trim() === "Roles & permissions"
      ) as HTMLElement;
      rolesChip.click();
      expect(navigate).toHaveBeenCalledWith(["/roles"]);
    });

    it("navigates to /api-keys when the API keys chip is clicked", async () => {
      const { fixture, navigate } = await renderComponent({});
      const el = fixture.nativeElement as HTMLElement;
      const chips = Array.from(el.querySelectorAll(".chip"));
      const apiKeysChip = chips.find(
        (c) => c.textContent?.trim() === "API keys"
      ) as HTMLElement;
      apiKeysChip.click();
      expect(navigate).toHaveBeenCalledWith(["/api-keys"]);
    });

    it("navigates to /billing when the Billing chip is clicked", async () => {
      const { fixture, navigate } = await renderComponent({});
      const el = fixture.nativeElement as HTMLElement;
      const chips = Array.from(el.querySelectorAll(".chip"));
      const billingChip = chips.find(
        (c) => c.textContent?.trim() === "Billing"
      ) as HTMLElement;
      billingChip.click();
      expect(navigate).toHaveBeenCalledWith(["/billing"]);
    });
  });

  describe("permission gating", () => {
    it("has no permission-gated chips (T01 finding 5: no gating exists on this component today)", async () => {
      const { fixture } = await renderComponent({});
      const el = fixture.nativeElement as HTMLElement;
      const chips = el.querySelectorAll(".chip");
      // All four chips render unconditionally regardless of permissions.
      expect(chips.length).toBe(4);
    });
  });

  describe("metrics chips from SettingsMetricsService", () => {
    it("renders the users-active headline without pending invitations", async () => {
      const { fixture } = await renderComponent({
        usersActive: 142,
        invitationsPending: 0,
      });
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain("142 users");
      expect(el.textContent).not.toContain("invitations pending");
    });

    it("renders the users-active headline with pending invitations", async () => {
      const { fixture } = await renderComponent({
        usersActive: 142,
        invitationsPending: 3,
      });
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain("142 users · 3 invitations pending");
    });

    it("falls back to 0 when usersActive/invitationsPending are null", async () => {
      const { fixture } = await renderComponent({
        usersActive: null,
        invitationsPending: null,
      });
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain("0 users");
    });
  });
});
