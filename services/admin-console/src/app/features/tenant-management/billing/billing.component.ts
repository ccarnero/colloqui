import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatTableModule } from "@angular/material/table";
import { TenantService } from "../../../core/services/tenant.service";

@Component({
  selector: "app-billing",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatTableModule, MatButtonModule],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Billing & Plans</div>
        <div class="ws-subtitle">
          Manage subscription for {{ tenant.currentTenant().name }}
        </div>
      </div>
    </div>

    <div class="plans-row">
      @for (plan of plans; track plan.name) {
        <div class="plan-card">
          <div class="plan-name">{{ plan.name }}</div>
          <div class="plan-price">
            {{ plan.price }}<span>/month</span>
          </div>
          <div style="margin: 12px 0">
            @for (f of plan.features; track f) {
              <div class="plan-feature">{{ f }}</div>
            }
          </div>
          <button class="btn btn-secondary btn-sm" style="width:100%">
            View Details
          </button>
        </div>
      }
    </div>

    <div class="section-card" style="margin-top: 20px">
      <div class="section-card-header">
        <div class="section-card-title">Payment History</div>
      </div>
      <table mat-table [dataSource]="payments">
        <ng-container matColumnDef="date">
          <th mat-header-cell *matHeaderCellDef>Date</th>
          <td mat-cell *matCellDef="let p">{{ p.date }}</td>
        </ng-container>
        <ng-container matColumnDef="amount">
          <th mat-header-cell *matHeaderCellDef>Amount</th>
          <td mat-cell *matCellDef="let p">{{ p.amount }}</td>
        </ng-container>
        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>Status</th>
          <td mat-cell *matCellDef="let p">
            <span class="badge badge-green">{{ p.status }}</span>
          </td>
        </ng-container>
        <ng-container matColumnDef="invoice">
          <th mat-header-cell *matHeaderCellDef>Invoice</th>
          <td mat-cell *matCellDef="let p">
            <a style="color:var(--accent2);cursor:pointer">Download</a>
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="paymentColumns"></tr>
        <tr mat-row *matRowDef="let row; columns: paymentColumns"></tr>
      </table>
    </div>
  `,
  styles: `
    .plans-row {
      display: flex;
      gap: 16px;
    }
    .plan-card {
      background: var(--bg3);
      border: 1.5px solid var(--border);
      border-radius: var(--radius2);
      padding: 20px;
      flex: 1;
      transition: border-color 0.15s;
    }
    .plan-card.current {
      border-color: var(--accent);
    }
    .plan-name {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .plan-price {
      font-size: 28px;
      font-weight: 700;
      color: var(--accent2);
    }
    .plan-price span {
      font-size: 13px;
      color: var(--text3);
      font-weight: 400;
    }
    .plan-feature {
      font-size: 12px;
      color: var(--text2);
      padding: 4px 0;
    }
    .plan-feature::before {
      content: "✓ ";
      color: var(--green);
      font-weight: 700;
    }
  `,
})
export class BillingComponent {
  protected readonly tenant = inject(TenantService);

  readonly paymentColumns = ["date", "amount", "status", "invoice"] as const;

  readonly plans = [
    {
      name: "Starter",
      price: "$49",
      features: [
        "Up to 50 users",
        "5 GB storage",
        "Basic support",
        "5 API keys",
      ],
    },
    {
      name: "Pro",
      price: "$149",
      features: [
        "Up to 200 users",
        "50 GB storage",
        "Priority support",
        "20 API keys",
        "SSO / SAML",
      ],
    },
    {
      name: "Enterprise",
      price: "$499",
      features: [
        "Unlimited users",
        "500 GB storage",
        "24/7 support",
        "Unlimited API keys",
        "SSO / SAML",
        "Custom branding",
        "SLA guarantee",
      ],
    },
  ];

  readonly payments = [
    { date: "Feb 1, 2025", amount: "$4,200.00", status: "Paid" },
    { date: "Jan 1, 2025", amount: "$4,200.00", status: "Paid" },
    { date: "Dec 1, 2024", amount: "$3,800.00", status: "Paid" },
  ];
}
