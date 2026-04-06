import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import { MatIconModule } from "@angular/material/icon";
import { YoizenclawMemoryProposalsPanelComponent } from "./memory-proposals-panel.component";

@Component({
  selector: "app-yoizenclaw-memories",
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    YoizenclawMemoryProposalsPanelComponent,
  ],
  template: `
    <div class="memories-page">
      <section class="hero">
        <div class="hero__icon">
          <mat-icon>memory</mat-icon>
        </div>
        <div class="hero__copy">
          <span class="hero__eyebrow">YoizenClaw</span>
          <h1 class="hero__title">Memories</h1>
          <p class="hero__subtitle">
            Review and govern tenant memory proposals before they become shared runtime context.
          </p>
        </div>
      </section>

      <section class="info-banner">
        <mat-icon class="info-banner__icon">shield</mat-icon>
        <div class="info-banner__copy">
          <h3 class="info-banner__title">Human review required</h3>
          <p class="info-banner__text">
            Agents can propose tenant-wide memories, but they only become auto-readable after explicit approval.
          </p>
        </div>
      </section>

      <app-yoizenclaw-memory-proposals-panel />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100%;
      }

      .memories-page {
        display: flex;
        flex-direction: column;
        gap: 24px;
        padding: 32px;
      }

      /* ---- Hero ---- */
      .hero {
        display: flex;
        align-items: center;
        gap: 20px;
      }

      .hero__icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        width: 56px;
        height: 56px;
        border-radius: 16px;
        background: linear-gradient(
          135deg,
          rgba(26, 102, 255, 0.18),
          rgba(26, 102, 255, 0.06)
        );
        color: var(--primary, #1a66ff);
      }

      .hero__icon mat-icon {
        font-size: 28px;
        width: 28px;
        height: 28px;
      }

      .hero__eyebrow {
        display: block;
        color: var(--primary, #1a66ff);
        font-size: 0.7rem;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        margin-bottom: 4px;
      }

      .hero__title {
        margin: 0 0 6px;
        color: var(--text-primary, #fff);
        font-size: 1.75rem;
        font-weight: 700;
        letter-spacing: -0.02em;
        line-height: 1.15;
      }

      .hero__subtitle {
        margin: 0;
        color: var(--text2, #a0a0a0);
        font-size: 0.9rem;
        line-height: 1.6;
        max-width: 640px;
      }

      /* ---- Info Banner ---- */
      .info-banner {
        display: flex;
        align-items: flex-start;
        gap: 16px;
        padding: 20px 24px;
        border-radius: 12px;
        border: 1px solid rgba(26, 102, 255, 0.18);
        background: rgba(26, 102, 255, 0.06);
      }

      .info-banner__icon {
        flex-shrink: 0;
        color: var(--primary, #1a66ff);
        font-size: 22px;
        width: 22px;
        height: 22px;
        margin-top: 1px;
      }

      .info-banner__title {
        margin: 0 0 4px;
        font-size: 0.95rem;
        font-weight: 600;
        color: var(--primary, #1a66ff);
      }

      .info-banner__text {
        margin: 0;
        font-size: 0.85rem;
        line-height: 1.5;
        color: var(--text2, #a0a0a0);
      }
    `,
  ],
})
export class YoizenclawMemoriesComponent {}
