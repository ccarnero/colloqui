import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { Router } from "@angular/router";
import { PageHeaderComponent } from "../../shared/components/page-header/page-header.component";
import { ConnectionsFleetComponent } from "./connections-fleet.component";

/**
 * Connections section landing — fleet operational view.
 *
 * Rebuilt per `manual-loops/admin-console/console-redesign-connections.md`
 * T02: fleet MetricCard row (real counts only, ConnectionsMetricsService),
 * an InventoryTable of every HTTP/MCP/hosted connection, and a
 * NeedsAttentionPanel for non-ok connections. The previous "most-used
 * connectors"/"recent activity" panels were dead code (T01 §2, §7 — hard-
 * coded to empty arrays) and have been removed along with their styles.
 *
 * T05 (console-redesign-polish.md, T01 findings §5/§6, SIGNED decision 5b):
 * the fleet body (KPI strip + chips + inventory table + needs-attention)
 * moved into the shared `ConnectionsFleetComponent` so `/connections/mcp`
 * can reuse the exact same composition pre-filtered to MCP instead of
 * keeping its own separate legacy chrome.
 */
@Component({
  selector: "app-connections-landing",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, ConnectionsFleetComponent],
  template: `
    <app-page-header title="Connections" subtitle="Tenant integration catalog">
      <ng-container slot="actions">
        <button class="btn btn-primary btn-sm" type="button" (click)="newConnector()">
          + New connector
        </button>
      </ng-container>
    </app-page-header>

    <app-connections-fleet initialKind="all" />
  `,
  styles: `
    :host {
      display: block;
    }
    .btn {
      font-size: 12px;
      padding: 6px 12px;
      border: 1px solid var(--rd-line);
      border-radius: var(--rd-radius-7, 8px);
      background: var(--rd-panel);
      color: var(--rd-text-1);
      cursor: pointer;
    }
    .btn-primary {
      background: var(--rd-accent);
      color: var(--rd-bg);
      border-color: var(--rd-accent);
    }
  `,
})
export class ConnectionsLandingComponent {
  private readonly router = inject(Router);

  protected newConnector(): void {
    this.router.navigate(["/connections", "http"]).catch((error: unknown) => {
      console.error(
        "[ConnectionsLandingComponent] navigation to new-connector failed",
        { error }
      );
    });
  }
}
