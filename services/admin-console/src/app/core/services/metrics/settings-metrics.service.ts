import {
  Injectable,
  computed,
  inject,
  signal,
  type Signal,
} from "@angular/core";
import { RoleService } from "../role.service";
import { TenantUsersService } from "../tenant-users.service";

/**
 * Settings section metrics (governance: identity, tenant, security, etc).
 *
 * `usersTotal` / `rolesTotal` back the sub-nav "created resources" badges and
 * are hydrated once via `loadCounts()`. Demo seeds remain for landing KPIs.
 */
@Injectable({ providedIn: "root" })
export class SettingsMetricsService {
  private readonly usersApi = inject(TenantUsersService);
  private readonly rolesApi = inject(RoleService);
  private countsLoaded = false;

  /** Total tenant users created. */
  readonly usersTotal = signal<number | null>(null);

  /**
   * Total tenant roles. Derived from the shared `RoleService.roles` signal so
   * the badge stays in sync with create/delete on the page.
   */
  readonly rolesTotal = computed<number | null>(() => {
    const n = this.rolesApi.roles().length;
    return n > 0 ? n : null;
  });

  // PHASE 2 DEMO SEEDS — replace with real fetches when backend lands.
  readonly usersActive = signal<number | null>(142);
  readonly invitationsPending = signal<number | null>(3);
  readonly quotasNearLimit = signal<number | null>(1);
  readonly auditAlerts = signal<number | null>(3);

  /** Fetches user count once and triggers the shared roles load. */
  loadCounts(): void {
    if (this.countsLoaded) return;
    this.countsLoaded = true;
    this.usersApi.listUsers().subscribe({
      next: (users) => this.usersTotal.set(users.length),
      error: () => this.usersTotal.set(null),
    });
    this.rolesApi.loadRoles();
  }

  /** Forces a re-fetch of the counts (e.g. after a create/delete). */
  reload(): void {
    this.countsLoaded = false;
    this.loadCounts();
  }

  resolve(source: string): Signal<number | null> | null {
    switch (source) {
      case "settings.users.total":
        return this.usersTotal;
      case "settings.roles.total":
        return this.rolesTotal;
      case "settings.quotas.nearLimit":
        return this.quotasNearLimit;
      case "settings.audit.alerts":
        return this.auditAlerts;
      case "settings.users.active":
        return this.usersActive;
      default:
        return null;
    }
  }
}
