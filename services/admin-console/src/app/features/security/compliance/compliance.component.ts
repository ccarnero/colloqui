import { Component, signal } from "@angular/core";
import { MatCardModule } from "@angular/material/card";
import { MatIconModule } from "@angular/material/icon";
import { ProgressBarComponent } from "../../../shared/components/progress-bar/progress-bar.component";

interface FrameworkCard {
  id: string;
  name: string;
  description: string;
  pass: number;
  fail: number;
  icon: string;
}

@Component({
  selector: "app-compliance",
  standalone: true,
  imports: [MatCardModule, MatIconModule, ProgressBarComponent],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Compliance</div>
        <div class="ws-subtitle">Framework coverage and control status</div>
      </div>
    </div>

    <div class="framework-grid">
      @for (f of frameworks(); track f.id) {
        <mat-card>
          <mat-card-header>
            <mat-icon mat-card-avatar>{{ f.icon }}</mat-icon>
            <mat-card-title>{{ f.name }}</mat-card-title>
            <mat-card-subtitle>{{ f.description }}</mat-card-subtitle>
          </mat-card-header>
          <mat-card-content>
            <div class="counts">
              <span class="pass">{{ f.pass }} pass</span>
              <span class="fail">{{ f.fail }} fail</span>
            </div>
            @let total = f.pass + f.fail;
            @if (total > 0) {
              <app-progress-bar [value]="(f.pass / total) * 100" />
            } @else {
              <app-progress-bar [value]="0" />
            }
          </mat-card-content>
        </mat-card>
      }
    </div>
  `,
  styles: `
    .framework-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1rem;
    }
    .counts {
      display: flex;
      gap: 1rem;
      margin-bottom: 0.75rem;
      font-weight: 500;
    }
    .pass {
      color: var(--green, #22c55e);
    }
    .fail {
      color: var(--red, #ef4444);
    }
  `,
})
export class ComplianceComponent {
  readonly frameworks = signal<FrameworkCard[]>([
    {
      id: "soc2",
      name: "SOC 2 Type II",
      description: "Trust services criteria",
      pass: 48,
      fail: 2,
      icon: "fact_check",
    },
    {
      id: "gdpr",
      name: "GDPR",
      description: "EU data protection",
      pass: 36,
      fail: 1,
      icon: "public",
    },
    {
      id: "hipaa",
      name: "HIPAA",
      description: "Health information safeguards",
      pass: 29,
      fail: 4,
      icon: "local_hospital",
    },
  ]);
}
