import { Component, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatButtonModule } from "@angular/material/button";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { LucideAngularModule, MessageSquare } from "lucide-angular";
import { AuthService } from "../../core/services/auth.service";

@Component({
  selector: "app-login",
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    LucideAngularModule,
  ],
  template: `
    <div class="login-page">
      <div class="login-card">
        <div class="login-brand">
          <lucide-icon [img]="MessageSquare" [size]="28" />
          <h1>Messaging Console</h1>
        </div>
        <p class="login-sub">Sign in to manage your messaging channels</p>

        @if (error()) {
          <div class="alert alert-error">{{ error() }}</div>
        }

        <form (ngSubmit)="onSubmit()" class="login-form">
          <mat-form-field appearance="outline">
            <mat-label>Email</mat-label>
            <input matInput
                   type="email"
                   [(ngModel)]="email"
                   name="email"
                   required
                   autocomplete="email" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Password</mat-label>
            <input matInput
                   type="password"
                   [(ngModel)]="password"
                   name="password"
                   required
                   autocomplete="current-password" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Tenant</mat-label>
            <input matInput
                   type="text"
                   [(ngModel)]="tenantId"
                   name="tenantId"
                   placeholder="e.g. acme"
                   autocomplete="off" />
          </mat-form-field>

          <button mat-flat-button
                  color="primary"
                  type="submit"
                  class="login-btn"
                  [disabled]="submitting()">
            @if (submitting()) {
              <mat-spinner diameter="18" />
            } @else {
              Sign In
            }
          </button>
        </form>
      </div>
    </div>
  `,
  styles: `
    .login-page {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: var(--bg);
    }
    .login-card {
      width: 100%;
      max-width: 380px;
      padding: 36px;
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: var(--radius2);
    }
    .login-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
      color: var(--accent);
    }
    .login-brand h1 {
      font-size: 20px;
      font-weight: 700;
    }
    .login-sub {
      font-size: 13px;
      color: var(--text3);
      margin-bottom: 24px;
    }
    .login-form {
      display: flex;
      flex-direction: column;
    }
    .login-form mat-form-field {
      width: 100%;
    }
    .login-btn {
      margin-top: 8px;
      height: 42px;
      font-weight: 600;
    }
    .alert-error {
      background: var(--red-dim);
      border: 1px solid rgba(239, 68, 68, 0.25);
      color: var(--red);
      padding: 10px 14px;
      border-radius: var(--radius);
      font-size: 13px;
      margin-bottom: 16px;
    }
  `,
})
export class LoginComponent {
  protected readonly MessageSquare = MessageSquare;
  private readonly auth = inject(AuthService);

  email = "";
  password = "";
  tenantId = "";
  readonly error = signal<string | null>(null);
  readonly submitting = signal(false);

  onSubmit(): void {
    if (!this.email || !this.password) return;

    this.submitting.set(true);
    this.error.set(null);

    const tenant = this.tenantId.trim() || undefined;

    this.auth.loginWithResult(this.email, this.password, tenant).subscribe({
      next: (res) => {
        this.submitting.set(false);
        this.auth.handleLoginSuccess(res);
      },
      error: (err) => {
        this.submitting.set(false);
        const message =
          err?.error?.message ?? err?.message ?? "Login failed";
        this.error.set(message);
      },
    });
  }
}
