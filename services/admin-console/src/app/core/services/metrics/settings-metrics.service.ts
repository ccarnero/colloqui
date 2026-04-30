import { Injectable, signal, type Signal } from "@angular/core";

/**
 * Settings section metrics (governance: identity, tenant, security, etc).
 *
 * Phase 1 stub: signals return `null`. Phase 2 wires real fetches.
 */
@Injectable({ providedIn: "root" })
export class SettingsMetricsService {
  // PHASE 2 DEMO SEEDS — replace with real fetches when backend lands.
  readonly usersActive = signal<number | null>(142);
  readonly invitationsPending = signal<number | null>(3);
  readonly quotasNearLimit = signal<number | null>(1);
  readonly auditAlerts = signal<number | null>(3);

  resolve(source: string): Signal<number | null> | null {
    switch (source) {
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
