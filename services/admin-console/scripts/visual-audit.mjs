#!/usr/bin/env node
// Visual parity audit harness (SPEC T01, console-redesign-polish.md):
// logs into the admin console with real credentials, visits a list of
// target paths, screenshots each, and records DOM markers (data-theme,
// primitive counts) for reviewers to diff against the binding mocks.
//
// Env interface:
//   BASE_URL      - default "http://localhost:4298"
//   ADMIN_EMAIL   - required
//   ADMIN_PASSWORD- required
//   TARGET_PATHS  - comma-separated list of paths, default "/dashboard"
//   OUT_DIR       - required, screenshots + audit.json land here
//
// playwright-core resolution: the workspace does not depend on
// playwright-core directly (only pnpm's store has it, pulled in
// transitively). We first try a normal `import("playwright-core")` in case
// it is ever hoisted/added as a real dependency, and fall back to the known
// pnpm store path relative to this script. This avoids adding a new
// dependency just for a manual audit tool.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const log = (msg) => console.log(`[visual-audit] ${msg}`);

async function loadChromium() {
  try {
    const mod = await import("playwright-core");
    log("resolved playwright-core via normal module resolution");
    return mod.chromium;
  } catch {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const storePath = path.resolve(
      __dirname,
      "../../../node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs",
    );
    log(`falling back to pnpm store path: ${storePath}`);
    const mod = await import(storePath);
    return mod.chromium;
  }
}

function sanitizePathToFilename(targetPath) {
  return targetPath.replace(/^\//, "").replace(/[/:]/g, "-") || "root";
}

async function main() {
  const BASE_URL = process.env.BASE_URL ?? "http://localhost:4298";
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  const TARGET_PATHS = (process.env.TARGET_PATHS ?? "/dashboard")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const OUT_DIR = process.env.OUT_DIR;

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    log("FATAL: ADMIN_EMAIL and ADMIN_PASSWORD env vars are required");
    process.exit(1);
  }
  if (!OUT_DIR) {
    log("FATAL: OUT_DIR env var is required");
    process.exit(1);
  }

  log(`base URL: ${BASE_URL}`);
  log(`target paths: ${TARGET_PATHS.join(", ")}`);
  log(`out dir: ${OUT_DIR}`);
  await mkdir(OUT_DIR, { recursive: true });

  const chromium = await loadChromium();
  log("launching chromium (headless, 1600x1000)");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      log(`[browser-error] ${msg.text()}`);
    }
  });

  try {
    log(`navigating to ${BASE_URL}/login`);
    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle", timeout: 60_000 });

    log("filling login form");
    await page.fill("input[type=email]", ADMIN_EMAIL);
    await page.fill("input[type=password]", ADMIN_PASSWORD);
    await page.click("button[mat-flat-button]");

    log("waiting for post-login redirect");
    await page.waitForURL(/dashboard|overview/, { timeout: 60_000 });
    log("login succeeded");
  } catch (err) {
    log(`FATAL: login failed — ${err.message}`);
    await browser.close();
    process.exit(1);
  }

  const markers = [];
  let anyFailed = false;

  for (const targetPath of TARGET_PATHS) {
    const url = `${BASE_URL}${targetPath}`;
    try {
      log(`navigating to ${url}`);
      await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });

      log("waiting 3s for view to settle");
      await page.waitForTimeout(3_000);

      const marker = await page.evaluate(() => ({
        path: window.location.pathname,
        dataTheme: document.documentElement.getAttribute("data-theme"),
        counts: {
          "app-kpi-card": document.querySelectorAll("app-kpi-card").length,
          "app-sparkline": document.querySelectorAll("app-sparkline").length,
          "app-inventory-table": document.querySelectorAll("app-inventory-table").length,
          "app-activity-feed": document.querySelectorAll("app-activity-feed").length,
          "app-needs-attention-panel": document.querySelectorAll("app-needs-attention-panel").length,
          "app-usage-chart": document.querySelectorAll("app-usage-chart").length,
        },
      }));
      marker.path = targetPath;
      markers.push(marker);

      const filename = `${sanitizePathToFilename(targetPath)}.png`;
      const screenshotPath = path.join(OUT_DIR, filename);
      log(`capturing screenshot: ${screenshotPath}`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
    } catch (err) {
      log(`ERROR: failed to audit ${targetPath} — ${err.message}`);
      anyFailed = true;
    }
  }

  const auditJsonPath = path.join(OUT_DIR, "audit.json");
  log(`writing DOM markers to ${auditJsonPath}`);
  await writeFile(auditJsonPath, JSON.stringify(markers, null, 2), "utf8");

  await browser.close();

  if (anyFailed) {
    log("FATAL: one or more paths failed to load — see errors above");
    process.exit(1);
  }
  log("audit complete");
}

main().catch((err) => {
  log(`FATAL: unhandled error — ${err.stack ?? err.message}`);
  process.exit(1);
});
