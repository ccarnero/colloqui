import { ChangeDetectionStrategy, Component } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { StatusBadgeComponent } from "../../../shared/components/status-badge/status-badge.component";

@Component({
  selector: "app-workflows",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, StatusBadgeComponent],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Workflows</div>
        <div class="ws-subtitle">Automate business processes</div>
      </div>
      <div class="ws-actions">
        <button class="btn btn-primary btn-sm" type="button">
          + New Workflow
        </button>
      </div>
    </div>

    @for (wf of workflows; track wf.id) {
      <div class="section-card">
        <div class="section-card-header">
          <div>
            <div class="section-card-title">{{ wf.name }}</div>
            <div class="section-card-sub">
              Trigger: {{ wf.trigger }} · {{ wf.runs }} runs · Last:
              {{ wf.lastRun }}
            </div>
          </div>
          <app-status-badge [status]="wf.status" />
        </div>
        <div class="section-card-body">
          <div class="wf-nodes">
            @for (step of wf.steps; track step; let i = $index) {
              @if (i > 0) {
                <div class="wf-arrow"></div>
              }
              <div class="wf-node">
                <div class="wf-node-box">
                  <div class="wf-node-label">{{ step }}</div>
                </div>
              </div>
            }
            <div class="wf-arrow"></div>
            <button type="button" class="wf-add-btn" aria-label="Add step">
              +
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .wf-nodes {
      display: flex;
      align-items: center;
      gap: 0;
      overflow-x: auto;
      padding-bottom: 8px;
    }
    .wf-node {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex-shrink: 0;
    }
    .wf-node-box {
      padding: 10px 14px;
      background: var(--bg3);
      border: 1.5px solid var(--border2);
      border-radius: var(--radius2);
      text-align: center;
      cursor: pointer;
      transition: border-color 0.15s;
    }
    .wf-node-box:hover {
      border-color: var(--accent);
    }
    .wf-node-label {
      font-size: 11px;
      font-weight: 600;
    }
    .wf-arrow {
      width: 40px;
      height: 2px;
      background: var(--border2);
      position: relative;
      flex-shrink: 0;
    }
    .wf-arrow::after {
      content: "";
      position: absolute;
      right: -1px;
      top: -4px;
      border: 5px solid transparent;
      border-left-color: var(--border2);
    }
    .wf-add-btn {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--bg3);
      border: 1.5px dashed var(--border2);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: var(--text3);
      font-size: 18px;
      flex-shrink: 0;
    }
    .wf-add-btn:hover {
      border-color: var(--accent);
      color: var(--accent);
      background: var(--accent-dim);
    }
  `,
})
export class WorkflowsComponent {
  readonly workflows = [
    {
      id: 1,
      name: "User Onboarding",
      trigger: "user.created",
      steps: [
        "Send Welcome Email",
        "Assign Default Role",
        "Create Workspace",
        "Notify Admin",
      ],
      status: "active",
      runs: 1240,
      lastRun: "5 min ago",
    },
    {
      id: 2,
      name: "Offboarding Flow",
      trigger: "user.deactivated",
      steps: [
        "Revoke Sessions",
        "Archive Data",
        "Notify Manager",
        "Send Summary",
      ],
      status: "active",
      runs: 87,
      lastRun: "2 days ago",
    },
    {
      id: 3,
      name: "Billing Alert",
      trigger: "quota.exceeded",
      steps: ["Check Threshold", "Send Alert Email", "Upgrade Prompt"],
      status: "draft",
      runs: 0,
      lastRun: "Never",
    },
  ];
}
