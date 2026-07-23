import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from "@angular/core";
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import type { IUser } from "../../../core/models";

export interface IUserDetailDialogData {
  user: IUser;
  /** True when the caller has `users:delete` and may deactivate. */
  canDeactivate: boolean;
  formatRole: (role: string) => string;
  formatCreatedAt: (createdAt: string) => string;
}

export interface IUserDetailDialogResult {
  action: "deactivate";
  userId: string;
}

/**
 * Row-detail overlay for a single tenant user, opened from the users
 * inventory table's row click. The shared `app-detail-dialog` primitive
 * (`shared/components/detail-dialog`) is read-only (title/subtitle/fields
 * only, no action slot) and is out of scope to modify for T02 (ONLY
 * `features/identity/users/` may change) — see design
 * `Rediseño Terminal.dc.html` lines 658-681, which renders "Deactivate
 * user" as a per-row affordance. This local dialog mirrors the shared
 * primitive's layout/tokens exactly and adds the one action the design
 * requires: Deactivate, gated by `users:delete` (T01 finding 1).
 */
@Component({
  selector: "app-user-detail-dialog",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatIconModule],
  template: `
    <div class="dialog-header">
      <span class="dialog-heading">
        <span class="dialog-title">{{
          data.user.display_name || data.user.email
        }}</span>
        <span class="dialog-subtitle">{{ data.user.email }}</span>
      </span>
      <button
        type="button"
        class="dialog-close"
        (click)="close()"
        aria-label="Close"
      >
        <mat-icon class="dialog-close-icon">close</mat-icon>
      </button>
    </div>
    <mat-dialog-content class="dialog-content">
      <dl class="dialog-fields">
        <dt>Email</dt>
        <dd>{{ data.user.email }}</dd>
        <dt>Name</dt>
        <dd>{{ data.user.display_name || "—" }}</dd>
        <dt>Role</dt>
        <dd>{{ formattedRole() }}</dd>
        <dt>Created</dt>
        <dd>{{ formattedCreatedAt() }}</dd>
      </dl>
    </mat-dialog-content>
    @if (data.canDeactivate) {
      <div class="dialog-actions">
        <button
          type="button"
          class="deactivate-btn"
          aria-label="Deactivate user"
          (click)="deactivate()"
        >
          <mat-icon class="deactivate-icon">person_off</mat-icon>
          Deactivate user
        </button>
      </div>
    }
  `,
  styles: `
    /*
     * NOTE ON DUPLICATION: this block mirrors the header/content/fields
     * layout of shared/components/detail-dialog/detail-dialog.component.ts
     * because that component has no action-projection slot and is out of
     * scope for T02 (see class comment above). The global \`.rd-dialog-panel\`
     * panelClass (styles.scss) only themes the MatDialog container/surface
     * chrome (background, border, radius, shadow) — it does NOT provide any
     * header/title/fields layout, so those rules below are genuinely needed
     * here, not redundant with global styling. Each kept rule is commented
     * with why it can't be dropped.
     *
     * FOLLOW-UP: the proper fix for the duplication is to add an optional
     * action-projection slot (e.g. an <ng-content select="[dialogActions]">)
     * to DetailDialogComponent so feature dialogs like this one can reuse
     * the shared header/fields template+styles and only supply the action
     * row, instead of reimplementing the whole layout.
     */
    :host {
      /* Sizing not set by .rd-dialog-panel (container-chrome only). */
      display: block;
      min-width: 360px;
      max-width: 560px;
    }
    .dialog-header {
      /* Header flex layout has no global equivalent. */
      display: flex;
      align-items: flex-start;
      gap: var(--rd-space-5, 10px);
      padding: var(--rd-space-7, 14px) var(--rd-space-9, 18px);
      border-bottom: 1px solid var(--rd-line);
    }
    .dialog-heading {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
    }
    .dialog-title {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-lg, 15px);
      font-weight: 600;
      color: var(--rd-text-1);
    }
    .dialog-subtitle {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-2xs, 10px);
      color: var(--rd-text-3);
    }
    .dialog-close {
      width: 26px;
      height: 26px;
      border: none;
      background: transparent;
      border-radius: var(--rd-radius-5, 6px);
      color: var(--rd-text-2);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      padding: 0;
    }
    /* Shared hover treatment for the close affordance and the new deactivate
       action — consolidated instead of duplicated per-element. */
    .dialog-close:hover,
    .deactivate-btn:hover {
      background: var(--rd-hover);
    }
    /* Shared 16px icon sizing for the close icon and the new deactivate
       icon — consolidated instead of duplicated per-element. */
    .dialog-close-icon,
    .deactivate-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .dialog-content {
      padding: var(--rd-space-8, 16px) var(--rd-space-9, 18px);
    }
    .dialog-fields {
      /* Field grid layout has no global equivalent. */
      display: grid;
      grid-template-columns: auto 1fr;
      gap: var(--rd-space-4, 8px) var(--rd-space-6, 12px);
      margin: 0;
      font-size: var(--rd-text-size-sm, 12px);
    }
    .dialog-fields dt {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-2xs, 10px);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--rd-text-3);
    }
    .dialog-fields dd {
      margin: 0;
      color: var(--rd-text-1);
      word-break: break-word;
    }
    /* Genuinely new: the Deactivate action row this component adds on top
       of the shared detail-dialog layout. */
    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      padding: var(--rd-space-7, 14px) var(--rd-space-9, 18px);
      border-top: 1px solid var(--rd-line);
    }
    .deactivate-btn {
      display: inline-flex;
      align-items: center;
      gap: var(--rd-space-4, 8px);
      border: 1px solid var(--rd-line);
      background: transparent;
      border-radius: var(--rd-radius-5, 6px);
      color: var(--rd-red, #ef4444);
      font-size: var(--rd-text-size-sm, 12px);
      font-weight: 500;
      padding: var(--rd-space-4, 8px) var(--rd-space-6, 12px);
      cursor: pointer;
    }
  `,
})
export class UserDetailDialogComponent {
  private readonly dialogRef =
    inject<
      MatDialogRef<
        UserDetailDialogComponent,
        IUserDetailDialogResult | undefined
      >
    >(MatDialogRef);
  readonly data = inject<IUserDetailDialogData>(MAT_DIALOG_DATA);

  readonly formattedRole = computed(() =>
    this.data.formatRole(this.data.user.role)
  );
  readonly formattedCreatedAt = computed(() =>
    this.data.formatCreatedAt(this.data.user.created_at)
  );

  close(): void {
    // Verbose logging: track dialog dismissal without an action.
    console.debug("[UserDetailDialogComponent] closed without action", {
      userId: this.data.user.id,
    });
    this.dialogRef.close();
  }

  deactivate(): void {
    // Verbose logging: the row action the design's person_off icon maps to.
    console.debug("[UserDetailDialogComponent] deactivate requested", {
      userId: this.data.user.id,
    });
    this.dialogRef.close({ action: "deactivate", userId: this.data.user.id });
  }
}
