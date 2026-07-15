/**
 * telegram-transform-reply sample driver — SDK-powered replacement for the
 * old curl+jq `run.sh` body (see sdk/GROWTH-PLAN.md P3.1).
 *
 * The original `run.sh` was a thin gate in front of `setup.sh`: it required a
 * REAL `TELEGRAM_BOT_TOKEN` (unlike `setup.sh` alone, which tolerates a
 * missing token by falling back to a placeholder) and then execed
 * `./setup.sh` to do the actual provisioning (account + workflow + webhook +
 * optional simulate-inbound drive). This file preserves that exact contract:
 * it enforces the stricter precondition, then delegates to `setup.ts`'s
 * exported `main()` for everything else — same env vars, same idempotency,
 * same optional `SIMULATE_INBOUND` end-to-end drive.
 */
import { main as runSetup } from "./setup.js";

async function main(): Promise<void> {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error("[run] TELEGRAM_BOT_TOKEN is required (from @BotFather).");
    console.error("[run]   cp .env.example .env   # then edit it");
    process.exit(1);
  }

  console.log("[run] provisioning telegram account + workflow...");
  // setup.ts reads TG_* (exported by resolve-env.sh) + TELEGRAM_BOT_TOKEN, and
  // the optional TG_PUBLIC_URL / SIMULATE_INBOUND / TELEGRAM_TEST_CHAT_ID from
  // .env/env.
  await runSetup();
}

main().catch((err) => {
  console.error("[run] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
