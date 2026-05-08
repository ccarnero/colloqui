import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from "@angular/core";
import { HttpErrorResponse } from "@angular/common/http";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { Subscription } from "rxjs";
import { AuthService } from "../../core/services/auth.service";

@Component({
  selector: "app-login",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="login-container">
      <mat-card class="login-card">
        <mat-card-header>
          <div class="logo">
            <div class="logo-icon"></div>
            <span>AdminConsole</span>
          </div>
        </mat-card-header>
        <mat-card-content>
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Email</mat-label>
            <input
              matInput
              type="email"
              autocomplete="email"
              [ngModel]="email()"
              (ngModelChange)="email.set($event)"
            />
          </mat-form-field>
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Password</mat-label>
            <input
              matInput
              type="password"
              autocomplete="current-password"
              [ngModel]="password()"
              (ngModelChange)="password.set($event)"
              (keyup.enter)="onLogin()"
            />
          </mat-form-field>
          @if (showTenantId()) {
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Tenant ID</mat-label>
              <input
                matInput
                type="text"
                autocomplete="off"
                [ngModel]="tenantId()"
                (ngModelChange)="tenantId.set($event)"
              />
            </mat-form-field>
          }
          @if (errorMessage()) {
            <p class="error-message">{{ errorMessage() }}</p>
          }
        </mat-card-content>
        <mat-card-actions>
          <button
            mat-flat-button
            color="primary"
            class="full-width"
            type="button"
            (click)="onLogin()"
            [disabled]="submitting()"
          >
            @if (submitting()) {
              <mat-spinner diameter="18" />
            } @else {
              Sign In
            }
          </button>
        </mat-card-actions>
      </mat-card>
    </div>
  `,
  styles: `
    .login-container {
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--bg);
    }
    .login-card {
      width: 400px;
      padding: 32px;
      background: var(--bg2);
      border: 1px solid var(--border);
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      font-size: 18px;
      margin-bottom: 24px;
    }
    .logo-icon {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, var(--accent), var(--purple));
      border-radius: 8px;
    }
    .full-width {
      width: 100%;
    }
    mat-card-actions {
      display: flex;
      justify-content: center;
    }
    button mat-spinner {
      margin: 0 auto;
    }
    .error-message {
      margin: 0;
      color: var(--red);
      font-size: 13px;
      padding: 4px 2px 0;
    }
    mat-form-field {
      margin-bottom: 8px;
    }
  `,
})
export class LoginComponent {
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  readonly email = signal("");
  readonly password = signal("");
  readonly tenantId = signal("");
  readonly showTenantId = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly submitting = signal(false);
  private activeLoginSub: Subscription | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.activeLoginSub?.unsubscribe());
  }

  onLogin(): void {
    const email = this.email().trim();
    const password = this.password();
    const tenantId = this.tenantId().trim() || undefined;
    if (!email || !password) {
      this.errorMessage.set("Email and password are required.");
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);
    this.activeLoginSub?.unsubscribe();
    this.activeLoginSub = this.authService
      .loginWithResult(email, password, tenantId)
      .subscribe({
        next: (res) => {
          this.submitting.set(false);
          this.authService.handleLoginSuccess(res);
        },
        error: (err: unknown) => {
          this.submitting.set(false);
          const message = this.extractHttpErrorMessage(err);
          if (message.includes("Please provide tenant_id")) {
            this.showTenantId.set(true);
          }
          this.errorMessage.set(message);
        },
      });
  }

  private extractHttpErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const body = error.error;
      if (typeof body === "string" && body.trim()) return body;
      if (body && typeof body === "object") {
        const bodyMessage = body["message"];
        if (typeof bodyMessage === "string" && bodyMessage.trim()) {
          return bodyMessage;
        }
      }
      if (typeof error.message === "string" && error.message.trim()) {
        return error.message;
      }
    }
    return "Login failed";
  }
}
