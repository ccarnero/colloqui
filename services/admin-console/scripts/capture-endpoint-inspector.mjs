#!/usr/bin/env node
// One-off G6 capture for the retention-endpoint-fix loop: logs in, opens the
// crm-support-telegram builder, clicks the searchContact HTTP connector
// node, and screenshots the inspector panel.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const log = (msg) => console.log(`[capture-endpoint-inspector] ${msg}`);

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
  const WORKFLOW_ID = process.env.WORKFLOW_ID ?? "7DXJQ18-pcbk56XCMtdRt";

  await mkdir(OUT_DIR, { recursive: true });

  const chromium = await loadChromium();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      log(`[browser-error] ${msg.text()}`);
    }
  });

  log(`navigating to ${BASE_URL}/login`);
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.fill("input[type=email]", ADMIN_EMAIL);
  await page.fill("input[type=password]", ADMIN_PASSWORD);
  await page.click("button[mat-flat-button]");
  await page.waitForURL(/dashboard|overview/, { timeout: 60_000 });
  log("login succeeded");

  const builderUrl = `${BASE_URL}/workflows/${WORKFLOW_ID}/builder`;
  log(`navigating to ${builderUrl}`);
  await page.goto(builderUrl, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(3_000);

  log("looking for the searchContact node card");
  const node = page.locator("text=searchContact").first();
  await node.waitFor({ state: "visible", timeout: 15_000 });
  await node.click({ force: true });
  await page.waitForTimeout(1_500);

  const inspectorPath = path.join(OUT_DIR, "http-inspector.png");
  log(`capturing screenshot: ${inspectorPath}`);
  await page.screenshot({ path: inspectorPath, fullPage: true });

  await browser.close();
  log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
