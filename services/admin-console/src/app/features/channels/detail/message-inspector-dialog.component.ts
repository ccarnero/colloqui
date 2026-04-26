import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from "@angular/core";
import {
  DatePipe,
  DecimalPipe,
  JsonPipe,
  UpperCasePipe,
} from "@angular/common";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from "@angular/material/dialog";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { MatSelectModule } from "@angular/material/select";
import { ChannelAdminService } from "../../../core/services/channel-admin.service";
import type {
  IStreamMessage,
  StreamInspectionMode,
} from "../../../core/models/channel-streams.model";

export interface IMessageInspectorDialogData {
  readonly streamKey: "ingress" | "dlq";
  readonly streamName: string;
  readonly defaultSubject?: string;
  readonly subjectPlaceholder?: string;
  readonly defaultMode?: StreamInspectionMode;
  readonly accountId?: string;
}

@Component({
  selector: "app-message-inspector-dialog",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    DecimalPipe,
    JsonPipe,
    UpperCasePipe,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
  ],
  template: `
    <h2 mat-dialog-title>
      Inspect {{ data.streamKey | uppercase }} — {{ data.streamName }}
    </h2>
    <mat-dialog-content class="inspector">
      <div class="inspector__controls">
        <mat-form-field appearance="outline" class="mode-select">
          <mat-label>Mode</mat-label>
          <mat-select [(ngModel)]="mode">
            <mat-option value="last-per-subject">
              Last per subject
            </mat-option>
            <mat-option value="tail">Tail (last N)</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" class="subject-input">
          <mat-label>Subject filter</mat-label>
          <input
            matInput
            type="text"
            [(ngModel)]="subject"
            [placeholder]="subjectPlaceholder"
            (keydown.enter)="reload()"
          />
        </mat-form-field>
        <mat-form-field appearance="outline" class="limit-input">
          <mat-label>Limit</mat-label>
          <input
            matInput
            type="number"
            min="1"
            max="200"
            [(ngModel)]="limit"
          />
        </mat-form-field>
        <button mat-stroked-button type="button" (click)="reload()">
          <mat-icon>refresh</mat-icon>
          Reload
        </button>
      </div>

      <div class="inspector__hint">
        @if (mode === "last-per-subject") {
          <span>
            Returns the latest message for each subject matching the filter.
            Empty filter falls back to the stream's full subject pattern.
          </span>
        } @else {
          <span>
            Returns the last N messages by sequence, regardless of subject.
            Subject filter is optional and narrows the tail further.
          </span>
        }
      </div>

      @if (loading()) {
        <div class="inspector__state">
          <mat-spinner diameter="24"></mat-spinner>
          <span>Fetching messages…</span>
        </div>
      } @else if (errorMessage()) {
        <div class="inspector__state error">{{ errorMessage() }}</div>
      } @else if (messages().length === 0) {
        <div class="inspector__state">No messages matched the filter.</div>
      } @else {
        <ul class="message-list">
          @for (msg of messages(); track msg.seq) {
            <li class="message-item">
              <div class="message-item__header">
                <span class="msg-seq">#{{ msg.seq | number }}</span>
                <span class="msg-subject">{{ msg.subject }}</span>
                <span class="msg-ts">{{ msg.ts | date: "medium" }}</span>
                <span class="msg-size">{{ msg.size | number }} B</span>
              </div>
              @if (headerEntries(msg).length > 0) {
                <div class="message-item__headers">
                  @for (h of headerEntries(msg); track h[0]) {
                    <span class="hdr">
                      <strong>{{ h[0] }}</strong>: {{ h[1] }}
                    </span>
                  }
                </div>
              }
              <pre class="message-item__body">{{ msg.data | json }}</pre>
            </li>
          }
        </ul>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="dialogRef.close()">
        Close
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    :host {
      display: block;
    }
    .inspector {
      display: flex;
      flex-direction: column;
      gap: 16px;
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
    }
    .inspector__controls {
      display: flex;
      gap: 12px;
      align-items: flex-end;
      flex-wrap: wrap;
      min-width: 0;
    }
    .mode-select { width: 200px; flex: 0 0 auto; }
    .subject-input { flex: 1 1 320px; min-width: 240px; }
    .limit-input { width: 120px; flex: 0 0 auto; }
    .inspector__hint {
      font-size: 12px;
      color: var(--text3);
      padding: 0 4px;
    }
    .inspector__state {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 16px;
      color: var(--text3);
    }
    .inspector__state.error { color: #ef4444; word-break: break-word; }
    .message-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-height: 55vh;
      overflow-y: auto;
      min-width: 0;
    }
    .message-item {
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    }
    .message-item__header {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      font-size: 12px;
      color: var(--text3);
      font-family: monospace;
      min-width: 0;
    }
    .msg-seq { color: var(--text); font-weight: 700; flex: 0 0 auto; }
    .msg-subject {
      color: var(--text);
      flex: 1 1 200px;
      min-width: 0;
      word-break: break-all;
      overflow-wrap: anywhere;
    }
    .msg-ts,
    .msg-size { flex: 0 0 auto; }
    .message-item__headers {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      font-size: 11px;
      color: var(--text3);
      min-width: 0;
    }
    .hdr {
      word-break: break-all;
      overflow-wrap: anywhere;
    }
    .message-item__body {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 12px;
      font-family: monospace;
      color: var(--text);
      margin: 0;
      max-width: 100%;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
  `,
})
export class MessageInspectorDialogComponent {
  protected readonly dialogRef = inject<
    MatDialogRef<MessageInspectorDialogComponent>
  >(MatDialogRef);
  protected readonly data = inject<IMessageInspectorDialogData>(MAT_DIALOG_DATA);
  private readonly channels = inject(ChannelAdminService);

  subject: string = this.data.defaultSubject ?? "";
  limit = 20;
  mode: StreamInspectionMode = this.data.defaultMode ?? "last-per-subject";

  readonly subjectPlaceholder =
    this.data.subjectPlaceholder ?? "e.g. evt.<tenant>.>";

  readonly messages = signal<ReadonlyArray<IStreamMessage>>([]);
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly hasMessages = computed(() => this.messages().length > 0);

  constructor() {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.channels
      .getStreamMessages(this.data.streamKey, {
        subject: this.subject.trim() || undefined,
        accountId: this.data.accountId,
        limit: this.limit,
        mode: this.mode,
      })
      .subscribe({
        next: (result) => {
          this.messages.set(result.items);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.messages.set([]);
          this.errorMessage.set(this.extractErrorMessage(err));
          this.loading.set(false);
        },
      });
  }

  headerEntries(msg: IStreamMessage): ReadonlyArray<[string, string]> {
    return Object.entries(msg.headers ?? {});
  }

  private extractErrorMessage(err: unknown): string {
    if (err && typeof err === "object") {
      const e = err as { error?: { message?: string }; message?: string };
      if (e.error?.message) return e.error.message;
      if (e.message) return e.message;
    }
    return "Failed to fetch messages";
  }
}
