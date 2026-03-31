import { CommonModule } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  computed,
  inject,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatChipsModule } from "@angular/material/chips";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatSelectModule } from "@angular/material/select";
import { AdaptersService } from "../../../core/services/adapters.service";
import type {
  IAdapterEndpoint,
  IAdapterSummary,
} from "../../../core/services/adapters.service";
import type { IToolAdapterRef } from "../../../core/models/yoizenclaw.model";

type ToolSourceType = "http" | "adapter";

const AUTH_TYPE_LABELS: ReadonlyMap<string, string> = new Map([
  ["none", "None"],
  ["api-key", "API Key"],
  ["bearer", "Bearer"],
  ["basic", "Basic Auth"],
  ["oauth2", "OAuth2"],
]);

@Component({
  selector: "app-tool-adapter-form",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatIconModule,
    MatChipsModule,
  ],
  template: `
    <div class="adapter-form">
      @if (loading()) {
        <div class="adapter-form-loading">Loading adapters...</div>
      }

      @if (error()) {
        <div class="adapter-form-error">
          <mat-icon>warning</mat-icon>
          <span>{{ error() }}</span>
        </div>
      }

      @if (adapterWarning()) {
        <div class="adapter-form-warning">
          <mat-icon>report_problem</mat-icon>
          <span>{{ adapterWarning() }}</span>
        </div>
      }

      <div class="adapter-form-row">
        <mat-form-field appearance="outline" class="adapter-field">
          <mat-label>Adapter</mat-label>
          <mat-select
            [value]="selectedAdapterId()"
            (selectionChange)="onAdapterChange($event.value)"
          >
            <mat-option [value]="null">Select adapter...</mat-option>
            @for (adapter of adapters(); track adapter.id) {
              <mat-option [value]="adapter.id">
                {{ adapter.name }}
                @if (adapter.status === "disabled") {
                  <span class="adapter-status-warn">(disabled)</span>
                }
              </mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="adapter-field">
          <mat-label>Endpoint</mat-label>
          <mat-select
            [value]="selectedEndpointId()"
            (selectionChange)="onEndpointChange($event.value)"
            [disabled]="!selectedAdapter()"
          >
            <mat-option [value]="null">Select endpoint...</mat-option>
            @for (ep of currentEndpoints(); track ep.id) {
              <mat-option [value]="ep.id">
                {{ ep.label || ep.path }}
                <span class="endpoint-method">({{ ep.method }})</span>
              </mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>

      @if (preview()) {
        <div class="adapter-preview">
          <div class="adapter-preview-title">Resolved Configuration</div>
          <div class="adapter-preview-grid">
            <div class="preview-item">
              <span class="preview-label">URL</span>
              <code class="preview-value">{{ preview()!.url }}</code>
            </div>
            <div class="preview-item">
              <span class="preview-label">Method</span>
              <span class="preview-value method-badge" [class]="preview()!.method.toLowerCase()">{{ preview()!.method }}</span>
            </div>
            <div class="preview-item">
              <span class="preview-label">Auth Type</span>
              <span class="preview-value">{{ authTypeLabel() }}</span>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .adapter-form {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .adapter-form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }

    .adapter-field {
      width: 100%;
    }

    .adapter-form-loading,
    .adapter-form-error,
    .adapter-form-warning {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 13px;
    }

    .adapter-form-loading {
      color: var(--text3);
    }

    .adapter-form-error {
      background: rgba(244, 67, 54, 0.1);
      color: #f44336;
      border: 1px solid rgba(244, 67, 54, 0.2);
    }

    .adapter-form-warning {
      background: rgba(255, 193, 7, 0.1);
      color: #ffc107;
      border: 1px solid rgba(255, 193, 7, 0.2);
    }

    .adapter-form-warning mat-icon,
    .adapter-form-error mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .adapter-status-warn {
      color: var(--text3);
      font-size: 11px;
      margin-left: 4px;
    }

    .endpoint-method {
      color: var(--text3);
      font-size: 11px;
      margin-left: 4px;
    }

    .adapter-preview {
      padding: 12px 14px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 8px;
    }

    .adapter-preview-title {
      font-size: 11px;
      font-weight: 600;
      color: var(--text3);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 10px;
    }

    .adapter-preview-grid {
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 16px;
      align-items: center;
    }

    .preview-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .preview-label {
      font-size: 10px;
      color: var(--text3);
      text-transform: uppercase;
      letter-spacing: 0.3px;
      font-weight: 600;
    }

    .preview-value {
      font-size: 13px;
      color: var(--text-primary);
    }

    .preview-value code {
      background: rgba(255, 255, 255, 0.06);
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      color: var(--text-primary);
      border: none;
    }

    .method-badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      font-family: "JetBrains Mono", ui-monospace, monospace;
    }

    .method-badge.get {
      background: rgba(76, 175, 80, 0.15);
      color: #4caf50;
    }

    .method-badge.post {
      background: rgba(33, 150, 243, 0.15);
      color: #2196f3;
    }

    .method-badge.put {
      background: rgba(255, 152, 0, 0.15);
      color: #ff9800;
    }

    .method-badge.delete {
      background: rgba(244, 67, 54, 0.15);
      color: #f44336;
    }

    .method-badge.patch {
      background: rgba(156, 39, 176, 0.15);
      color: #9c27b0;
    }

    @media (max-width: 720px) {
      .adapter-form-row {
        grid-template-columns: 1fr;
      }

      .adapter-preview-grid {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class ToolAdapterFormComponent implements OnInit {
  private readonly adaptersService = inject(AdaptersService);

  @Input() initialAdapterRef: IToolAdapterRef | null = null;
  @Input() initialAdapterName: string | null = null;
  @Output() readonly adapterRefChange = new EventEmitter<IToolAdapterRef | null>();

  readonly adapters = signal<IAdapterSummary[]>([]);
  readonly selectedAdapter = signal<IAdapterSummary | null>(null);
  readonly selectedEndpoint = signal<IAdapterEndpoint | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly selectedAdapterId = computed(() => this.selectedAdapter()?.id ?? null);
  readonly selectedEndpointId = computed(() => this.selectedEndpoint()?.id ?? null);

  readonly currentEndpoints = computed(() => {
    const adapter = this.selectedAdapter();
    return adapter?.endpoints ?? [];
  });

  readonly adapterInactive = computed(() => {
    const adapter = this.selectedAdapter();
    if (!adapter) return false;
    return adapter.status === "disabled";
  });

  readonly adapterWarning = computed<string | null>(() => {
    const adapter = this.selectedAdapter();
    if (!adapter) return null;
    if (adapter.status === "disabled") {
      return `Adapter "${adapter.name}" is disabled.`;
    }
    return null;
  });

  readonly adapterRef = computed<IToolAdapterRef | null>(() => {
    const adapter = this.selectedAdapter();
    const endpoint = this.selectedEndpoint();
    if (!adapter || !endpoint) return null;
    return { adapterId: adapter.id, endpointId: endpoint.id };
  });

  readonly preview = computed(() => {
    const adapter = this.selectedAdapter();
    const endpoint = this.selectedEndpoint();
    if (!adapter || !endpoint) return null;
    return {
      url: `${adapter.baseUrl || "..."}${endpoint.path}`,
      method: endpoint.method,
      authType: adapter.authType || "none",
      hasAuth: adapter.hasAuth ?? false,
    };
  });

  readonly authTypeLabel = computed(() => {
    const p = this.preview();
    if (!p) return "None";
    return AUTH_TYPE_LABELS.get(p.authType) ?? p.authType;
  });

  ngOnInit(): void {
    this.loadAdapters();
  }

  onAdapterChange(adapterId: string | null): void {
    if (!adapterId) {
      this.selectedAdapter.set(null);
      this.selectedEndpoint.set(null);
      this.adapterRefChange.emit(null);
      return;
    }

    const adapter = this.adapters().find((a) => a.id === adapterId) ?? null;
    this.selectedAdapter.set(adapter);
    this.selectedEndpoint.set(null);

    if (adapter && adapter.endpoints.length === 1) {
      this.selectedEndpoint.set(adapter.endpoints[0]);
      this.adapterRefChange.emit({
        adapterId: adapter.id,
        endpointId: adapter.endpoints[0].id,
      });
    } else {
      this.adapterRefChange.emit(null);
    }
  }

  onEndpointChange(endpointId: string | null): void {
    if (!endpointId) {
      this.selectedEndpoint.set(null);
      this.adapterRefChange.emit(null);
      return;
    }

    const adapter = this.selectedAdapter();
    if (!adapter) return;

    const endpoint = adapter.endpoints.find((e) => e.id === endpointId) ?? null;
    this.selectedEndpoint.set(endpoint);

    if (endpoint) {
      this.adapterRefChange.emit({ adapterId: adapter.id, endpointId: endpoint.id });
    } else {
      this.adapterRefChange.emit(null);
    }
  }

  private loadAdapters(): void {
    this.loading.set(true);
    this.error.set(null);

    this.adaptersService.listAdapters().subscribe({
      next: (response) => {
        this.adapters.set(response.adapters);
        this.loading.set(false);
        this.restoreInitialSelection(response.adapters);
      },
      error: () => {
        this.error.set("Failed to load adapters.");
        this.loading.set(false);
      },
    });
  }

  private restoreInitialSelection(loadedAdapters: IAdapterSummary[]): void {
    const ref = this.initialAdapterRef;
    if (!ref) return;

    const adapter = loadedAdapters.find((a) => a.id === ref.adapterId) ?? null;
    if (!adapter) {
      const name = this.initialAdapterName ?? ref.adapterId;
      this.error.set(`Adapter "${name}" not found.`);
      return;
    }

    this.selectedAdapter.set(adapter);

    const endpoint = adapter.endpoints.find((e) => e.id === ref.endpointId) ?? null;
    if (!endpoint) {
      this.error.set("Endpoint not found in adapter.");
      return;
    }

    this.selectedEndpoint.set(endpoint);
  }
}
