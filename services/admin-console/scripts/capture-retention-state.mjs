#!/usr/bin/env node
// One-off G6 capture for the retention-endpoint-fix loop, Fix 1 (honest
// "output no longer retained" state). The workflow-service backend fix
// (GoneException/RUN_HISTORY_EXPIRED mapping) is code-complete and
// unit-tested but NOT deployed to the dev cluster in this session (that
// requires a separate image build+redeploy step, out of scope here) — so
// hitting a real expired run against the LIVE cluster still returns the
// pre-fix raw 500. To honestly verify the FRONTEND rendering path without
// a live backend deploy, this script intercepts the one
// GET /workflows/:id/executions/:executionId network call and returns the
// exact 410 body workflow-service's getExecutionStatus now produces,
// simulating the post-deploy state. This is explicitly a network-mocked
// verification of the frontend code path, not an end-to-end live capture.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const log = (msg) => console.log(`[capture-retention-state] ${msg}`);

async function loadChromium() {
  try {
    const mod = await import("playwright-core");
    return mod.chromium;
  } catch {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const storePath = path.resolve(
      __dirname,
      "../../../node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs",
    );
    const mod = await import(storePath);
    return mod.chromium;
  }
}

async function main() {
  const BASE_URL = process.env.BASE_URL ?? "http://localhost:4298";
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  const OUT_DIR = process.env.OUT_DIR;
  const DEFINITION_ID = process.env.DEFINITION_ID ?? "7DXJQ18-pcbk56XCMtdRt";
  const RUN_ID = process.env.RUN_ID ?? "XFifoDLTn_p_PbI4LlHB_";

  await mkdir(OUT_DIR, { recursive: true });

  const chromium = await loadChromium();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      log(`[browser-error] ${msg.text()}`);
    }
  });

  // Intercept exactly the execution-detail call and return the 410 body
  // workflow-service's getExecutionStatus (GoneException mapping) now
  // produces for a retention-expired run.
  await page.route(`**/api/workflows/${DEFINITION_ID}/executions/${RUN_ID}`, (route) => {
    log(`intercepting ${route.request().url()} -> mocked 410 RUN_HISTORY_EXPIRED`);
    route.fulfill({
      status: 410,
      contentType: "application/json",
      body: JSON.stringify({
        statusCode: 410,
        error: "Gone",
        code: "RUN_HISTORY_EXPIRED",
        message: `Execution history for '${RUN_ID}' is no longer retained by Temporal`,
        executionId: RUN_ID,
        temporalWorkflowId: `acme:crm-support-telegram:sha256:mocked:${DEFINITION_ID}`,
      }),
    });
  });

  log(`navigating to ${BASE_URL}/login`);
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.fill("input[type=email]", ADMIN_EMAIL);
  await page.fill("input[type=password]", ADMIN_PASSWORD);
  await page.click("button[mat-flat-button]");
  await page.waitForURL(/dashboard|overview/, { timeout: 60_000 });
  log("login succeeded");

  const runUrl = `${BASE_URL}/workflows/${DEFINITION_ID}/runs/${RUN_ID}`;
  log(`navigating to ${runUrl}`);
  await page.goto(runUrl, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(2_000);

  const outPath = path.join(OUT_DIR, "retention-state.png");
  log(`capturing screenshot: ${outPath}`);
  await page.screenshot({ path: outPath, fullPage: true });

  await browser.close();
  log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
