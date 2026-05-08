import { Injectable, signal } from "@angular/core";

export interface IAgentBridgeSavedEvent {
  id: string;
  name: string;
}

/**
 * Bridge between the parent agent-detail wrapper and the inner editor.
 *
 * The inner editor pushes its mutable state (saving, dirty, validity, ...)
 * into these signals; the parent reads them to render Save / Reset / Cancel
 * + the dirty pill in the detail header.
 *
 * Action callbacks let the parent trigger save/reset/cancel without holding
 * a viewChild reference to the inner editor.
 *
 * Provided at the YoizenclawAgentDetailComponent level so it lives only
 * while the user is on /agents/:id — never a global singleton.
 */
@Injectable()
export class AgentEditorBridgeService {
  // ---- State (set by the inner editor, read by the parent) ----

  /** Non-null while an editor is mounted; controls the parent's button block. */
  readonly editingAgentId = signal<string | null>(null);
  readonly saving = signal(false);
  readonly loading = signal(false);
  readonly canSave = signal(false);
  readonly isDirty = signal(false);
  readonly savedAgent = signal<IAgentBridgeSavedEvent | null>(null);
  readonly deletedAgentId = signal<string | null>(null);

  // ---- Action handlers (registered by the inner editor) ----

  private saveHandler: (() => void) | null = null;
  private resetHandler: (() => void) | null = null;
  private cancelHandler: (() => void) | null = null;

  registerHandlers(handlers: {
    onSave: () => void;
    onReset: () => void;
    onCancel: () => void;
  }): void {
    this.saveHandler = handlers.onSave;
    this.resetHandler = handlers.onReset;
    this.cancelHandler = handlers.onCancel;
    console.debug("[agent-editor-bridge] handlers registered");
  }

  unregisterHandlers(): void {
    this.saveHandler = null;
    this.resetHandler = null;
    this.cancelHandler = null;
    this.editingAgentId.set(null);
    this.saving.set(false);
    this.loading.set(false);
    this.canSave.set(false);
    this.isDirty.set(false);
    this.savedAgent.set(null);
    this.deletedAgentId.set(null);
    console.debug("[agent-editor-bridge] handlers torn down");
  }

  notifySavedAgent(event: IAgentBridgeSavedEvent): void {
    this.savedAgent.set(event);
  }

  notifyDeletedAgent(agentId: string): void {
    this.deletedAgentId.set(agentId);
  }

  // ---- Action methods (triggered by the parent detail) ----

  requestSave(): void {
    if (!this.saveHandler) {
      console.warn("[agent-editor-bridge] save requested but no handler");
      return;
    }
    this.saveHandler();
  }

  requestReset(): void {
    if (!this.resetHandler) {
      console.warn("[agent-editor-bridge] reset requested but no handler");
      return;
    }
    this.resetHandler();
  }

  requestCancel(): void {
    if (!this.cancelHandler) {
      console.warn("[agent-editor-bridge] cancel requested but no handler");
      return;
    }
    this.cancelHandler();
  }
}
