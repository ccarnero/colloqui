import { CommonModule } from "@angular/common";
import { Component, inject, signal } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { firstValueFrom } from "rxjs";
import {
  MEMORY_STATUS,
  type IAgentMemory,
} from "../../../core/models/agent.model";
import { AgentAdminService } from "../../../core/services/agent-admin.service";
import { ConfirmDialogComponent } from "../../../shared/components/confirm-dialog/confirm-dialog.component";

@Component({
  selector: "app-agent-memory-proposals-panel",
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <section class="queue">
      <div class="queue__header">
        <div class="queue__title-row">
          <mat-icon class="queue__icon">inbox</mat-icon>
          <div>
            <p class="queue__label">Tenant memory proposals</p>
            <h3 class="queue__title">Human review queue</h3>
          </div>
        </div>
        <button
          mat-stroked-button
          type="button"
          class="queue__refresh"
          (click)="refresh()"
          [disabled]="loading()"
        >
          <mat-icon>refresh</mat-icon>
          Refresh
        </button>
      </div>

      <!-- Loading -->
      <div *ngIf="loading()" class="queue__loading">
        <mat-spinner diameter="20"></mat-spinner>
        <span>Loading proposals...</span>
      </div>

      <!-- Error -->
      <p *ngIf="!loading() && error()" class="queue__error">{{ error() }}</p>

      <!-- Empty State -->
      <div
        *ngIf="!loading() && !error() && proposals().length === 0"
        class="queue__empty"
      >
        <div class="queue__empty-icon">
          <mat-icon>check_circle</mat-icon>
        </div>
        <h4 class="queue__empty-title">All caught up!</h4>
        <p class="queue__empty-text">
          No pending tenant memory proposals to review right now.
        </p>
      </div>

      <!-- Proposals List -->
      <div
        *ngIf="!loading() && proposals().length > 0"
        class="queue__list"
      >
        <div
          *ngFor="let proposal of proposals()"
          class="card"
        >
          <div class="card__header">
            <div class="card__badges">
              <span class="badge badge--kind">{{
                proposal.kind
              }}</span>
              <span class="badge badge--scope">{{
                proposal.scope
              }}</span>
            </div>
            <span class="card__id">{{ proposal.id }}</span>
          </div>

          <h4 class="card__title">
            {{ proposal.title }}
          </h4>

          <div class="card__excerpt">
            {{ truncateContent(proposal.content) }}
          </div>

          <div class="card__actions">
            <button
              mat-flat-button
              type="button"
              class="card__btn card__btn--approve"
              (click)="approve(proposal.id)"
              [disabled]="busyProposalId() === proposal.id"
            >
              <mat-icon>check</mat-icon>
              Approve
            </button>
            <button
              mat-stroked-button
              type="button"
              class="card__btn card__btn--reject"
              (click)="reject(proposal.id)"
              [disabled]="busyProposalId() === proposal.id"
            >
              <mat-icon>close</mat-icon>
              Reject
            </button>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .queue {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 24px;
        border-radius: 12px;
        border: 1px solid var(--border-subtle, #2a2a2a);
        background: var(--bg2, #1a1a1a);
      }

      .queue__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .queue__title-row {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .queue__icon {
        color: var(--primary, #1a66ff);
        font-size: 22px;
        width: 22px;
        height: 22px;
      }

      .queue__label {
        margin: 0;
        color: var(--text2, #a0a0a0);
        font-size: 0.7rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .queue__title {
        margin: 2px 0 0;
        font-size: 1.05rem;
        font-weight: 600;
        color: var(--text-primary, #fff);
      }

      .queue__refresh {
        color: var(--text2, #a0a0a0);
        border-color: var(--border-subtle, #333);
        font-size: 0.8rem;
      }

      .queue__loading,
      .queue__error {
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--text2, #a0a0a0);
        margin: 0;
        padding: 8px 0;
      }

      .queue__error {
        color: #ef5350;
      }

      .queue__empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 56px 24px;
        text-align: center;
        border-radius: 10px;
        border: 1px dashed var(--border-subtle, #333);
        background: rgba(255, 255, 255, 0.01);
      }

      .queue__empty-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: rgba(76, 175, 80, 0.1);
        margin-bottom: 16px;
      }

      .queue__empty-icon mat-icon {
        font-size: 28px;
        width: 28px;
        height: 28px;
        color: #66bb6a;
      }

      .queue__empty-title {
        margin: 0 0 6px;
        font-size: 1.1rem;
        font-weight: 600;
        color: var(--text-primary, #fff);
      }

      .queue__empty-text {
        margin: 0;
        color: var(--text2, #a0a0a0);
        font-size: 0.85rem;
      }

      .queue__list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .card {
        padding: 20px 24px;
        border-radius: 10px;
        border: 1px solid var(--border-subtle, #2a2a2a);
        background: var(--bg3, #222);
        transition: border-color 0.2s ease, box-shadow 0.2s ease;
      }

      .card:hover {
        border-color: rgba(26, 102, 255, 0.35);
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
      }

      .card__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
      }

      .card__badges {
        display: flex;
        gap: 6px;
      }

      .badge {
        font-size: 0.65rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        padding: 3px 10px;
        border-radius: 6px;
      }

      .badge--kind {
        background: rgba(26, 102, 255, 0.12);
        color: var(--primary, #5c9aff);
      }

      .badge--scope {
        background: rgba(156, 39, 176, 0.12);
        color: #ce93d8;
      }

      .card__id {
        font-size: 0.7rem;
        color: var(--text3, #555);
        font-family: "JetBrains Mono", monospace;
      }

      .card__title {
        margin: 0 0 12px;
        font-size: 1rem;
        font-weight: 600;
        color: var(--text-primary, #fff);
        letter-spacing: -0.01em;
      }

      .card__excerpt {
        padding: 14px 16px;
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.25);
        border: 1px solid var(--border-subtle, #333);
        color: var(--text-primary, #fff);
        font-size: 0.85rem;
        line-height: 1.6;
        white-space: pre-wrap;
        margin-bottom: 16px;
      }

      .card__actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
      }

      .card__btn--approve {
        background: rgba(76, 175, 80, 0.15);
        color: #81c784;
      }

      .card__btn--approve:hover {
        background: rgba(76, 175, 80, 0.25);
      }

      .card__btn--reject {
        color: #ef5350;
        border-color: rgba(239, 83, 80, 0.3);
      }

      .card__btn--reject:hover {
        background: rgba(239, 83, 80, 0.08);
      }
    `,
  ],
})
export class AgentMemoryProposalsPanelComponent {
  private readonly agentAdminService = inject(AgentAdminService);
  private readonly dialog = inject(MatDialog);

  readonly proposals = signal<IAgentMemory[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly busyProposalId = signal<string | null>(null);

  constructor() {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const response = await firstValueFrom(
        this.agentAdminService.listMemories({
          status: MEMORY_STATUS.PROPOSED,
        }),
      );
      this.proposals.set(response.items);
    } catch {
      this.error.set("Failed to load memory proposals.");
    } finally {
      this.loading.set(false);
    }
  }

  async approve(proposalId: string): Promise<void> {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      width: "400px",
      data: {
        title: "Approve Memory Proposal",
        message:
          "Are you sure you want to approve this memory proposal? It will be published immediately and become readable by agents.",
        confirmLabel: "Approve",
        icon: "check_circle",
      },
    });

    const confirmed = await firstValueFrom(ref.afterClosed());
    if (!confirmed) return;

    await this.reviewProposal(proposalId, "approve");
  }

  async reject(proposalId: string): Promise<void> {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      width: "400px",
      data: {
        title: "Reject Memory Proposal",
        message:
          "Are you sure you want to reject this memory proposal?",
        confirmLabel: "Reject",
        variant: "danger" as const,
        icon: "cancel",
      },
    });

    const confirmed = await firstValueFrom(ref.afterClosed());
    if (!confirmed) return;

    await this.reviewProposal(proposalId, "reject");
  }

  truncateContent(content: string): string {
    if (!content) return "No content available.";
    return content.length > 200 ? content.slice(0, 200) + "..." : content;
  }

  private async reviewProposal(
    proposalId: string,
    action: "approve" | "reject",
  ): Promise<void> {
    this.busyProposalId.set(proposalId);
    this.error.set(null);

    try {
      if (action === "approve") {
        await firstValueFrom(
          this.agentAdminService.approveMemory(proposalId),
        );
      } else {
        await firstValueFrom(
          this.agentAdminService.rejectMemory(proposalId),
        );
      }

      this.proposals.update((items) =>
        items.filter((item) => item.id !== proposalId),
      );
    } catch {
      this.error.set(`Failed to ${action} proposal ${proposalId}.`);
    } finally {
      this.busyProposalId.set(null);
    }
  }
}
