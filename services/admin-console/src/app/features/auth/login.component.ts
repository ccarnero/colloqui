import { Component, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { AuthService } from "../../core/services/auth.service";

@Component({
  selector: "app-login",
  imports: [
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
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
        </mat-card-content>
        <mat-card-actions>
          <button
            mat-flat-button
            color="primary"
            class="full-width"
            type="button"
            (click)="onLogin()"
          >
            Sign In
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
    mat-form-field {
      margin-bottom: 8px;
    }
  `,
})
export class LoginComponent {
  private readonly authService = inject(AuthService);
  protected readonly email = signal("");
  protected readonly password = signal("");

  onLogin(): void {
    this.authService.login(this.email(), this.password());
  }
}
