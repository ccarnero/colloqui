import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from "@angular/material/dialog";
import { MatExpansionModule } from "@angular/material/expansion";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { firstValueFrom } from "rxjs";
import {
  KnowledgeBasesService,
  type IKnowledgeBase,
} from "../../../../core/services/knowledge-bases.service";
import {
  AdaptersService,
  type IAdapterSummary,
} from "../../../../core/services/adapters.service";

export interface IKnowledgeBaseFormResult {
  name: string;
  description: string;
  project: string;
  category: string;
  ingestion_config?: Record<string, unknown>;
}

export interface IKnowledgeBaseDialogData {
  knowledgeBase?: IKnowledgeBase;
}

export interface IKnowledgeBaseDialogResult {
  saved: boolean;
}

@Component({
  selector: "app-knowledge-base-form-dialog",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatDialogModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ isEdit ? "Edit Knowledge Base" : "New Knowledge Base" }}</h2>

    <mat-dialog-content>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Name</mat-label>
        <input matInput [(ngModel)]="name" placeholder="Knowledge base name" />
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Description (optional)</mat-label>
        <textarea
          matInput
          [(ngModel)]="description"
          rows="3"
          placeholder="What is this knowledge base for?"
        ></textarea>
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Project (optional)</mat-label>
        <input matInput [(ngModel)]="project" placeholder="e.g. customer-support" />
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Category (optional)</mat-label>
        <input matInput [(ngModel)]="category" placeholder="e.g. documentation" />
      </mat-form-field>

      <mat-expansion-panel>
        <mat-expansion-panel-header>
          <mat-panel-title>Ingestion Configuration</mat-panel-title>
          <mat-panel-description>Chunk size, embedding model, etc.</mat-panel-description>
        </mat-expansion-panel-header>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Chunk Size</mat-label>
          <input matInput type="number" [(ngModel)]="chunkSize" placeholder="1000" min="100" max="10000" />
          <mat-hint>Maximum characters per chunk (default: 1000)</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Chunk Overlap</mat-label>
          <input matInput type="number" [(ngModel)]="chunkOverlap" placeholder="200" min="0" max="2000" />
          <mat-hint>Overlap between chunks in characters (default: 200)</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Embedding Model</mat-label>
          <input matInput [(ngModel)]="embeddingModel" placeholder="text-embedding-3-small" />
          <mat-hint>OpenAI embedding model name (default: text-embedding-3-small)</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Provider Connector</mat-label>
          <mat-select [ngModel]="providerConnectorId()" (ngModelChange)="providerConnectorId.set($event)">
            <mat-option value="">None (use env-var)</mat-option>
            @for (conn of llmConnectors(); track conn.id) {
              <mat-option [value]="conn.id">
                {{ conn.name }} — {{ conn.baseUrl }}
              </mat-option>
            }
          </mat-select>
          <mat-hint>LLM connector for embedding API key and base URL</mat-hint>
        </mat-form-field>
      </mat-expansion-panel>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancel</button>
      <button
        mat-flat-button
        color="primary"
        type="button"
        [disabled]="saving() || !name.trim()"
        (click)="save()"
      >
        {{ saving() ? "Saving..." : isEdit ? "Update" : "Create" }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    :host {
      display: block;
      min-width: 520px;
      max-width: 700px;
    }
    mat-dialog-content {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-top: 8px !important;
    }
    .full-width {
      width: 100%;
    }
    mat-expansion-panel {
      margin-top: 4px;
    }
    mat-expansion-panel .mat-expansion-panel-content {
      padding: 4px 0;
    }
    mat-hint {
      font-size: 11px;
      line-height: 1.4;
      margin-top: 2px;
    }
  `,
})
export class KnowledgeBaseFormDialogComponent implements OnInit {
  private readonly service = inject(KnowledgeBasesService);
  private readonly dialogRef = inject(
    MatDialogRef<
      KnowledgeBaseFormDialogComponent,
      IKnowledgeBaseDialogResult | undefined
    >,
  );
  private readonly data = inject<IKnowledgeBaseDialogData>(MAT_DIALOG_DATA);
  private readonly adaptersService = inject(AdaptersService);

  readonly saving = signal(false);
  readonly providerConnectorId = signal("");
  readonly llmConnectors = signal<IAdapterSummary[]>([]);
  readonly isEdit: boolean;

  name = "";
  description = "";
  project = "";
  category = "";
  chunkSize: number | null = null;
  chunkOverlap: number | null = null;
  embeddingModel = "";

  constructor() {
    const kb = this.data?.knowledgeBase;
    this.isEdit = !!kb;
    if (kb) {
      this.name = kb.name;
      this.description = kb.description ?? "";
      this.project = kb.project ?? "";
      this.category = kb.category ?? "";
      const cfg = kb.ingestion_config;
      if (cfg) {
        this.chunkSize = (cfg["chunk_size"] as number) ?? null;
        this.chunkOverlap = (cfg["chunk_overlap"] as number) ?? null;
        this.embeddingModel = (cfg["embedding_model"] as string) ?? "";
        this.providerConnectorId.set((cfg["provider_connector_id"] as string) ?? "");
      }
    }
  }

  ngOnInit(): void {
    this.adaptersService.listByTag("llm").subscribe({
      next: (connectors) => this.llmConnectors.set(connectors),
    });
  }

  async save(): Promise<void> {
    this.saving.set(true);

    try {
      const ingestionConfig: Record<string, unknown> = {};
      if (this.chunkSize != null) ingestionConfig["chunk_size"] = this.chunkSize;
      if (this.chunkOverlap != null) ingestionConfig["chunk_overlap"] = this.chunkOverlap;
      if (this.embeddingModel.trim()) ingestionConfig["embedding_model"] = this.embeddingModel.trim();
      if (this.providerConnectorId()) ingestionConfig["provider_connector_id"] = this.providerConnectorId();

      const payload = {
        name: this.name.trim(),
        description: this.description.trim() || undefined,
        project: this.project.trim() || undefined,
        category: this.category.trim() || undefined,
        ...(Object.keys(ingestionConfig).length > 0 && {
          ingestion_config: ingestionConfig,
        }),
      };

      if (this.isEdit && this.data?.knowledgeBase) {
        await firstValueFrom(
          this.service.update(this.data.knowledgeBase.id, payload),
        );
      } else {
        await firstValueFrom(this.service.create(payload));
      }

      this.dialogRef.close({ saved: true });
    } catch {
      this.saving.set(false);
    }
  }
}
