import { ChangeDetectionStrategy, Component, signal } from "@angular/core";
import { MatCardModule } from "@angular/material/card";
import { MatIconModule } from "@angular/material/icon";
import { MatTableModule } from "@angular/material/table";
import { ProgressBarComponent } from "../../../shared/components/progress-bar/progress-bar.component";
import { StatusBadgeComponent } from "../../../shared/components/status-badge/status-badge.component";

interface ISecurityEventRow {
  time: string;
  severity: string;
  summary: string;
  source: string;
}

@Component({
  selector: "app-security-center",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatCardModule,
    MatIconModule,
    MatTableModule,
    ProgressBarComponent,
    StatusBadgeComponent,
  ],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Security Center</div>
        <div class="ws-subtitle">Posture, threats, and recent security events</div>
      </div>
    </div>

    <div class="score-row">
      <mat-card class="score-card">
        <mat-card-header>
          <mat-icon mat-card-avatar>shield</mat-icon>
          <mat-card-title>Security score</mat-card-title>
          <mat-card-subtitle>Organization-wide</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          <div class="score-value">{{ securityScore() }}%</div>
          <app-progress-bar [value]="securityScore()" />
        </mat-card-content>
      </mat-card>
    </div>

    <div class="threat-cards">
      @for (t of threats(); track t.title) {
        <mat-card>
          <mat-card-header>
            <mat-icon mat-card-avatar>{{ t.icon }}</mat-icon>
            <mat-card-title>{{ t.title }}</mat-card-title>
            <mat-card-subtitle>{{ t.subtitle }}</mat-card-subtitle>
          </mat-card-header>
          <mat-card-content>
            <div class="threat-metric">{{ t.metric }}</div>
            <app-status-badge [status]="t.status" />
          </mat-card-content>
        </mat-card>
      }
    </div>

    <div class="ws-subtitle section-label">Recent security events</div>
    <div class="table-wrap">
      <table mat-table [dataSource]="events()">
        <ng-container matColumnDef="time">
          <th mat-header-cell *matHeaderCellDef>Time</th>
          <td mat-cell *matCellDef="let e" style="font-family:monospace">
            {{ e.time }}
          </td>
        </ng-container>
        <ng-container matColumnDef="severity">
          <th mat-header-cell *matHeaderCellDef>Severity</th>
          <td mat-cell *matCellDef="let e">
            <app-status-badge [status]="e.severity" />
          </td>
        </ng-container>
        <ng-container matColumnDef="summary">
          <th mat-header-cell *matHeaderCellDef>Summary</th>
          <td mat-cell *matCellDef="let e">{{ e.summary }}</td>
        </ng-container>
        <ng-container matColumnDef="source">
          <th mat-header-cell *matHeaderCellDef>Source</th>
          <td mat-cell *matCellDef="let e" style="font-family:monospace">
            {{ e.source }}
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="cols"></tr>
        <tr mat-row *matRowDef="let row; columns: cols"></tr>
      </table>
    </div>
  `,
  styles: `
    .score-row {
      margin-bottom: 1.5rem;
    }
    .score-card {
      max-width: 420px;
    }
    .score-value {
      font-size: 2rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }
    .threat-cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .threat-metric {
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }
    .section-label {
      margin: 0 0 0.75rem;
    }
  `,
})
export class SecurityCenterComponent {
  readonly cols = ["time", "severity", "summary", "source"] as const;

  readonly securityScore = signal(87);

  readonly threats = signal<
    ReadonlyArray<{
      title: string;
      subtitle: string;
      metric: string;
      status: string;
      icon: string;
    }>
  >([
    {
      title: "Failed logins (24h)",
      subtitle: "Brute-force monitoring",
      metric: "12 attempts",
      status: "monitoring",
      icon: "gpp_maybe",
    },
    {
      title: "Open vulnerabilities",
      subtitle: "Dependency scan",
      metric: "2 medium",
      status: "action_required",
      icon: "bug_report",
    },
    {
      title: "Policy violations",
      subtitle: "WAF + API rules",
      metric: "0 critical",
      status: "clear",
      icon: "verified_user",
    },
  ]);

  readonly events = signal<ISecurityEventRow[]>([
    {
      time: "14:10",
      severity: "medium",
      summary: "Unusual login from new ASN",
      source: "auth.acme.internal",
    },
    {
      time: "13:42",
      severity: "low",
      summary: "TLS cert renewed",
      source: "edge.acme.internal",
    },
    {
      time: "12:05",
      severity: "high",
      summary: "Rate limit exceeded on /api/v1/export",
      source: "api-gateway",
    },
  ]);
}
