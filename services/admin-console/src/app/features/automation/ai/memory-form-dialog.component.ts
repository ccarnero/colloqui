import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from "@angular/material/dialog";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { firstValueFrom } from "rxjs";
import {
  MEMORY_KIND,
  MEMORY_SCOPE,
  type IAgentMemory,
  type IAgentMemoryCreatePayload,
  type IAgentMemoryUpdatePayload,
  type MemoryKind,
  type MemoryScope,
} from "../../../core/models/agent.model";
import { AgentAdminService } from "../../../core/services/agent-admin.service";

export interface IMemoryDialogData {
  memory?: IAgentMemory;
}

export interface IMemoryDialogResult {
  saved: boolean;
}

const SCOPE_OPTIONS: { value: MemoryScope; label: string }[] = [
  { value: MEMORY_SCOPE.SESSION, label: "Session" },
  { value: MEMORY_SCOPE.USER, label: "User" },
  { value: MEMORY_SCOPE.TENANT, label: "Tenant" },
];

const KIND_OPTIONS: { value: MemoryKind; label: string }[] = [
  { value: MEMORY_KIND.PREFERENCE, label: "Preference" },
  { value: MEMORY_KIND.FACT, label: "Fact" },
  { value: MEMORY_KIND.NOTICE, label: "Notice" },
  { value: MEMORY_KIND.INCIDENT, label: "Incident" },
  { value: MEMORY_KIND.PROMO, label: "Promo" },
];

@Component({
  selector: "app-memory-form-dialog",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ isEdit ? "Edit Memory" : "Create Memory" }}</h2>

    <mat-dialog-content>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Title</mat-label>
        <input matInput [(ngModel)]="title" placeholder="Short descriptive title" />
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Content</mat-label>
        <textarea
          matInput
          [(ngModel)]="content"
          rows="4"
          placeholder="Memory content"
        ></textarea>
      </mat-form-field>

      @if (!isEdit) {
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Scope</mat-label>
          <mat-select [(ngModel)]="scope">
            @for (opt of scopeOptions; track opt.value) {
              <mat-option [value]="opt.value">{{ opt.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Kind</mat-label>
          <mat-select [(ngModel)]="kind">
            @for (opt of kindOptions; track opt.value) {
              <mat-option [value]="opt.value">{{ opt.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Topic Key (optional)</mat-label>
          <input matInput [(ngModel)]="topicKey" placeholder="e.g. architecture/auth-model" />
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>TTL (seconds, optional)</mat-label>
          <input matInput type="number" [(ngModel)]="ttl" placeholder="Leave empty for no expiry" />
        </mat-form-field>
      }

      @if (isEdit) {
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Topic Key (optional)</mat-label>
          <input matInput [(ngModel)]="topicKey" />
        </mat-form-field>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancel</button>
      <button
        mat-flat-button
        color="primary"
        type="button"
        [disabled]="saving() || !title.trim() || !content.trim()"
        (click)="save()"
      >
        {{ saving() ? "Saving..." : isEdit ? "Update" : "Create" }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    :host {
      display: block;
      min-width: 420px;
      max-width: 560px;
    }
    mat-dialog-content {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .full-width {
      width: 100%;
    }
  `,
})
export class MemoryFormDialogComponent {
  private readonly agentAdminService = inject(AgentAdminService);
  private readonly dialogRef = inject<
    MatDialogRef<MemoryFormDialogComponent, IMemoryDialogResult>
  >(MatDialogRef);
  private readonly data = inject<IMemoryDialogData>(MAT_DIALOG_DATA);

  readonly scopeOptions = SCOPE_OPTIONS;
  readonly kindOptions = KIND_OPTIONS;
  readonly saving = signal(false);

  readonly isEdit: boolean;

  title = "";
  content = "";
  scope: MemoryScope = MEMORY_SCOPE.TENANT;
  kind: MemoryKind = MEMORY_KIND.FACT;
  topicKey = "";
  ttl: number | null = null;

  constructor() {
    const memory = this.data.memory;
    this.isEdit = !!memory;
    if (memory) {
      this.title = memory.title;
      this.content = memory.content;
      this.scope = memory.scope;
      this.kind = memory.kind;
      this.topicKey = memory.topicKey ?? "";
    }
  }

  async save(): Promise<void> {
    this.saving.set(true);

    try {
      if (this.isEdit && this.data.memory) {
        const payload: IAgentMemoryUpdatePayload = {
          title: this.title.trim(),
          content: this.content.trim(),
          ...(this.topicKey.trim() ? { topicKey: this.topicKey.trim() } : {}),
        };
        await firstValueFrom(
          this.agentAdminService.updateMemory(this.data.memory.id, payload),
        );
      } else {
        const payload: IAgentMemoryCreatePayload = {
          scope: this.scope,
          kind: this.kind,
          title: this.title.trim(),
          content: this.content.trim(),
          ...(this.topicKey.trim() ? { topicKey: this.topicKey.trim() } : {}),
          ...(this.ttl != null && this.ttl > 0 ? { ttl: this.ttl } : {}),
        };
        await firstValueFrom(
          this.agentAdminService.createMemory(payload),
        );
      }

      this.dialogRef.close({ saved: true });
    } catch {
      this.saving.set(false);
    }
  }
}
