import { test, expect, type Page, type Locator } from "@playwright/test";

/**
 * Sales Agent Setup — Full E2E flow
 *
 * Creates the complete "Sales Assistant Agent" pipeline in the admin-console:
 *   1. Knowledge Base  →  2. Skills (×3)  →  3. Connectors (×3)  →  4. Agent + Publish
 *
 * Credentials:  yclawd@demo.io / admin123  (tenant: acme)
 * Base URL:     http://localhost:4200
 *
 * Each test is idempotent — it checks whether the entity already exists
 * before creating it so the suite can be re-run safely.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:4200";
const EMAIL = process.env.E2E_EMAIL ?? "yclawd@demo.io";
const PASSWORD = process.env.E2E_PASSWORD ?? "admin123";
const TENANT = process.env.E2E_TENANT ?? "acme";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Fill an Angular Material <input matInput> that is inside a
 * <mat-form-field>.  The input itself may not be the direct child —
 * we search inside the field for the native <input> or <textarea>.
 */
async function fillMatInput(
  page: Page,
  label: string,
  value: string,
): Promise<void> {
  // Find the mat-form-field that contains a mat-label with the target text,
  // then target the native input/textarea inside it.
  const field = page.locator("mat-form-field").filter({ hasText: label }).first();
  const input = field.locator("input, textarea").first();
  // Click on the field to focus, then fill the input
  await field.click();
  await input.fill(value);
}

/**
 * Select an option from an Angular Material <mat-select>.
 * This clicks the mat-select trigger to open the overlay, then clicks the
 * matching mat-option in the overlay panel (which is appended to the body).
 */
async function selectMatOption(
  page: Page,
  label: string,
  optionText: string,
): Promise<void> {
  // The mat-form-field wrapping the mat-select
  const field = page.locator("mat-form-field").filter({ hasText: label }).first();
  const selectTrigger = field.locator("mat-select").first();
  await selectTrigger.click();

  // Options render in a CDK overlay at the body level
  const option = page.locator("mat-option").filter({ hasText: optionText }).first();
  await expect(option).toBeVisible({ timeout: 5_000 });
  await option.click();
}

/**
 * Fill a chip-input (tags).  For each tag, types the text and presses Enter.
 */
async function fillChips(page: Page, label: string, tags: string[]): Promise<void> {
  const field = page.locator("mat-form-field").filter({ hasText: label }).first();
  const input = field.locator("input").first();
  for (const tag of tags) {
    await input.fill(tag);
    await input.press("Enter");
  }
}

/**
 * Wait for the Angular SPA to finish initial render by checking for the
 * sidebar/shell component.
 */
async function waitForAppReady(page: Page): Promise<void> {
  // The shell renders a sidebar or the login card — either is fine.
  await page.waitForSelector(
    'app-shell, app-login, .login-container, [class*="sidebar"]',
    { timeout: 15_000 },
  );
}

/**
 * Close any open Angular Material dialog by pressing Escape or clicking
 * the backdrop.
 */
async function closeDialogIfOpen(page: Page): Promise<void> {
  const backdrop = page.locator(".cdk-overlay-backdrop");
  if (await backdrop.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await backdrop.waitFor({ state: "detached", timeout: 5_000 }).catch(() => {});
  }
}

/**
 * Helper: check if a mat-snack-bar with success text appeared.
 */
async function expectSnackBar(page: Page, text: string): Promise<void> {
  const snack = page.locator("mat-snack-bar-container, .mat-mdc-snack-bar-container");
  await expect(snack).toContainText(text, { timeout: 10_000 });
}

// ─── Login ───────────────────────────────────────────────────────────────────

async function login(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/login`);
  await waitForAppReady(page);

  // Fill credentials — the login form uses mat-form-field with mat-label
  await fillMatInput(page, "Email", EMAIL);
  await fillMatInput(page, "Password", PASSWORD);

  // The tenant field may appear if the backend requires it after a failed
  // first attempt.  If visible, fill it.
  const tenantField = page.locator("mat-form-field").filter({ hasText: "Tenant ID" });
  if (await tenantField.isVisible().catch(() => false)) {
    await fillMatInput(page, "Tenant ID", TENANT);
  }

  // Click Sign In
  await page.getByRole("button", { name: /sign in/i }).click();

  // Wait for navigation to dashboard
  await page.waitForURL("**/dashboard", { timeout: 20_000 });
  await waitForAppReady(page);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe("Sales Agent Setup", () => {
  test.beforeEach(async ({ page }) => {
    // Increase default timeout for the whole describe block
    test.setTimeout(180_000);
    await login(page);
  });

  // ── Step 1: Knowledge Base ─────────────────────────────────────────────

  test("create knowledge base — oncity-product-catalog", async ({ page }) => {
    await page.goto(`${BASE_URL}/ai/knowledge-bases`);
    await page.waitForLoadState("networkidle");

    // Check if KB already exists (idempotent)
    const existingCard = page.locator("mat-card, .card, [class*='card']").filter({
      hasText: "oncity-product-catalog",
    });
    if (await existingCard.isVisible().catch(() => false)) {
      test.info().annotations.push({
        type: "info",
        description: "Knowledge base already exists — skipping creation",
      });
      return;
    }

    // Click "New KB" button
    await page.getByRole("button", { name: /new kb/i }).click();

    // Wait for the dialog to appear
    const dialog = page.locator("mat-dialog-container, .mat-mdc-dialog-container");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Fill the form
    await fillMatInput(page, "Name", "oncity-product-catalog");
    await fillMatInput(
      page,
      "Description",
      "Catálogo de productos de OnCity.com",
    );
    await fillMatInput(page, "Project", "sales-automation");
    await fillMatInput(page, "Category", "product-catalog");

    // Click Create
    await page.getByRole("button", { name: /^create$/i }).click();

    // Verify — snack bar or the card appearing in the grid
    await page.waitForTimeout(1_000);
    const newCard = page.locator("mat-card, .card, [class*='card']").filter({
      hasText: "oncity-product-catalog",
    });
    await expect(newCard).toBeVisible({ timeout: 10_000 });
  });

  // ── Step 2: Skills (×3) ───────────────────────────────────────────────

  test("create skills — oncity-product-search, price-comparison, sales-recommender", async ({
    page,
  }) => {
    const skills = [
      {
        name: "oncity-product-search",
        description: "Busca productos en OnCity.com",
        triggerCommands: "/search, /buscar",
        systemPrompt:
          "You are a product search specialist. Help users find products on OnCity.com using the search-products tool. Return relevant product matches with name, price, and availability.",
      },
      {
        name: "oncity-price-comparison",
        description: "Compara precios de productos",
        triggerCommands: "/compare, /precios",
        systemPrompt:
          "You are a price comparison specialist. Compare product prices across categories on OnCity.com. Present results in a clear table format with best-value recommendations.",
      },
      {
        name: "oncity-sales-recommender",
        description: "Genera recomendaciones personalizadas",
        triggerCommands: "/recommend, /suggest",
        systemPrompt:
          "You are a sales recommendation engine. Analyze user preferences and browsing history to suggest personalized product recommendations from OnCity.com catalog.",
      },
    ];

    await page.goto(`${BASE_URL}/ai/skills`);
    await page.waitForLoadState("networkidle");

    for (const skill of skills) {
      // Check if skill already exists (idempotent)
      const existingCard = page.locator("mat-card, .card, [class*='card']").filter({
        hasText: skill.name,
      });
      if (await existingCard.isVisible().catch(() => false)) {
        test.info().annotations.push({
          type: "info",
          description: `Skill "${skill.name}" already exists — skipping`,
        });
        continue;
      }

      // Click "New Skill"
      await page.getByRole("button", { name: /new skill/i }).click();

      // Wait for dialog
      const dialog = page.locator("mat-dialog-container, .mat-mdc-dialog-container");
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      // Fill form fields
      await fillMatInput(page, "Name", skill.name);
      await fillMatInput(page, "Description", skill.description);
      await fillMatInput(
        page,
        "Trigger Commands",
        skill.triggerCommands,
      );
      await fillMatInput(page, "System Prompt", skill.systemPrompt);

      // Click Save — the dialog close button
      await page
        .locator("mat-dialog-actions")
        .getByRole("button", { name: /save/i })
        .click();

      // Wait for dialog to close
      await dialog.waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(1_000);

      // Verify card appeared
      const newCard = page.locator(".skill-card").filter({ hasText: skill.name });
      await expect(newCard).toBeVisible({ timeout: 10_000 });
    }
  });

  // ── Step 3: Connectors (×3) ───────────────────────────────────────────

  test("create connectors — oncity-api, openai-llm, deepseek-llm", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/connections/http`);
    await page.waitForLoadState("networkidle");

    // ── 3a. oncity-api connector (no auth) ─────────────────────────────

    const oncityRow = page.locator("tr.mat-row, tr[mat-row]").filter({
      hasText: "oncity-api",
    });
    if (!(await oncityRow.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: /add connector/i }).click();

      const dialog = page.locator(
        "mat-dialog-container, .mat-mdc-dialog-container, app-http-adapter-dialog",
      ).first();
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      // Scope (if selector is shown)
      const scopeSelect = dialog.locator("mat-select").filter({ hasText: /scope|internal|external/i });
      if (await scopeSelect.isVisible().catch(() => false)) {
        await scopeSelect.click();
        await page.locator("mat-option").filter({ hasText: /external/i }).first().click();
      }

      // Name & Base URL
      const nameInput = dialog.locator('mat-form-field').filter({ hasText: 'Name' }).locator('input').first();
      await nameInput.fill("oncity-api");

      const baseUrlInput = dialog.locator('mat-form-field').filter({ hasText: 'Base URL' }).locator('input').first();
      await baseUrlInput.fill("https://www.oncity.com");

      // Tags: ecommerce, products, tv
      await fillChips(dialog, "Tags", ["ecommerce", "products", "tv"]);

      // Auth type: none (default) — no action needed

      // Add endpoint 1: search-products
      const endpointsSection = dialog.locator(".section-card").filter({
        hasText: "Endpoints",
      });
      await endpointsSection
        .getByRole("button", { name: /add/i })
        .click();

      // First endpoint row
      const ep1 = endpointsSection.locator(".endpoint-card, [formGroupName]").first();
      const ep1Method = ep1.locator("mat-select").first();
      await ep1Method.click();
      await page.locator("mat-option").filter({ hasText: "GET" }).first().click();

      const ep1Path = ep1.locator('mat-form-field').filter({ hasText: 'Path' }).locator('input').first();
      await ep1Path.fill("/{query}?_q={query}&map=ft");

      const ep1Label = ep1.locator('mat-form-field').filter({ hasText: 'Label' }).locator('input').first();
      await ep1Label.fill("search-products");

      // Add endpoint 2: get-product-details
      await endpointsSection
        .getByRole("button", { name: /add/i })
        .click();

      const ep2 = endpointsSection.locator(".endpoint-card, [formGroupName]").nth(1);
      const ep2Method = ep2.locator("mat-select").first();
      await ep2Method.click();
      await page.locator("mat-option").filter({ hasText: "GET" }).first().click();

      const ep2Path = ep2.locator('mat-form-field').filter({ hasText: 'Path' }).locator('input').first();
      await ep2Path.fill("/products/{product_id}");

      const ep2Label = ep2.locator('mat-form-field').filter({ hasText: 'Label' }).locator('input').first();
      await ep2Label.fill("get-product-details");

      // Submit
      await dialog
        .getByRole("button", { name: /^create$/i })
        .click();

      await dialog.waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(1_500);

      // Verify row
      const newRow = page.locator("tr.mat-row, tr[mat-row]").filter({ hasText: "oncity-api" });
      await expect(newRow).toBeVisible({ timeout: 10_000 });
    }

    // ── 3b. openai-llm connector (API Key auth) ────────────────────────

    const openaiRow = page.locator("tr.mat-row, tr[mat-row]").filter({
      hasText: "openai-llm",
    });
    if (!(await openaiRow.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: /add connector/i }).click();

      const dialog = page.locator(
        "mat-dialog-container, .mat-mdc-dialog-container, app-http-adapter-dialog",
      ).first();
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      const nameInput = dialog.locator('mat-form-field').filter({ hasText: 'Name' }).locator('input').first();
      await nameInput.fill("openai-llm");

      const baseUrlInput = dialog.locator('mat-form-field').filter({ hasText: 'Base URL' }).locator('input').first();
      await baseUrlInput.fill("https://api.openai.com");

      await fillChips(dialog, "Tags", ["llm", "openai"]);

      // Auth type → api-key
      const authTypeSelect = dialog
        .locator("app-adapter-auth-config, .section-card")
        .filter({ hasText: /auth/i })
        .locator("mat-select")
        .first();
      if (await authTypeSelect.isVisible().catch(() => false)) {
        await authTypeSelect.click();
        await page.locator("mat-option").filter({ hasText: /api.?key/i }).first().click();
        // Fill the API key field that appears
        const apiKeyField = dialog.locator('mat-form-field').filter({ hasText: /key|token/i }).locator('input').first();
        if (await apiKeyField.isVisible().catch(() => false)) {
          await apiKeyField.fill("sk-placeholder-replace-with-real-key");
        }
      }

      // Add endpoint: chat-completions
      const endpointsSection = dialog.locator(".section-card").filter({
        hasText: "Endpoints",
      });
      await endpointsSection.getByRole("button", { name: /add/i }).click();

      const ep = endpointsSection.locator(".endpoint-card, [formGroupName]").first();
      const epMethod = ep.locator("mat-select").first();
      await epMethod.click();
      await page.locator("mat-option").filter({ hasText: "POST" }).first().click();

      const epPath = ep.locator('mat-form-field').filter({ hasText: 'Path' }).locator('input').first();
      await epPath.fill("/v1/chat/completions");

      const epLabel = ep.locator('mat-form-field').filter({ hasText: 'Label' }).locator('input').first();
      await epLabel.fill("chat-completions");

      await dialog.getByRole("button", { name: /^create$/i }).click();
      await dialog.waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(1_500);

      const openaiNewRow = page.locator("tr.mat-row, tr[mat-row]").filter({ hasText: "openai-llm" });
      await expect(openaiNewRow).toBeVisible({ timeout: 10_000 });
    }

    // ── 3c. deepseek-llm connector (API Key auth) ──────────────────────

    const deepseekRow = page.locator("tr.mat-row, tr[mat-row]").filter({
      hasText: "deepseek-llm",
    });
    if (!(await deepseekRow.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: /add connector/i }).click();

      const dialog = page.locator(
        "mat-dialog-container, .mat-mdc-dialog-container, app-http-adapter-dialog",
      ).first();
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      const nameInput = dialog.locator('mat-form-field').filter({ hasText: 'Name' }).locator('input').first();
      await nameInput.fill("deepseek-llm");

      const baseUrlInput = dialog.locator('mat-form-field').filter({ hasText: 'Base URL' }).locator('input').first();
      await baseUrlInput.fill("https://api.deepseek.com");

      await fillChips(dialog, "Tags", ["llm", "deepseek"]);

      // Auth type → api-key
      const authTypeSelect = dialog
        .locator("app-adapter-auth-config, .section-card")
        .filter({ hasText: /auth/i })
        .locator("mat-select")
        .first();
      if (await authTypeSelect.isVisible().catch(() => false)) {
        await authTypeSelect.click();
        await page.locator("mat-option").filter({ hasText: /api.?key/i }).first().click();
        const apiKeyField = dialog.locator('mat-form-field').filter({ hasText: /key|token/i }).locator('input').first();
        if (await apiKeyField.isVisible().catch(() => false)) {
          await apiKeyField.fill("sk-placeholder-replace-with-real-key");
        }
      }

      // Add endpoint: chat-completions
      const endpointsSection = dialog.locator(".section-card").filter({
        hasText: "Endpoints",
      });
      await endpointsSection.getByRole("button", { name: /add/i }).click();

      const ep = endpointsSection.locator(".endpoint-card, [formGroupName]").first();
      const epMethod = ep.locator("mat-select").first();
      await epMethod.click();
      await page.locator("mat-option").filter({ hasText: "POST" }).first().click();

      const epPath = ep.locator('mat-form-field').filter({ hasText: 'Path' }).locator('input').first();
      await epPath.fill("/v1/chat/completions");

      const epLabel = ep.locator('mat-form-field').filter({ hasText: 'Label' }).locator('input').first();
      await epLabel.fill("chat-completions");

      await dialog.getByRole("button", { name: /^create$/i }).click();
      await dialog.waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(1_500);

      const deepseekNewRow = page.locator("tr.mat-row, tr[mat-row]").filter({ hasText: "deepseek-llm" });
      await expect(deepseekNewRow).toBeVisible({ timeout: 10_000 });
    }
  });

  // ── Step 4: Agent — Create, configure, and publish ─────────────────────

  test("create and publish Sales Assistant Agent", async ({ page }) => {
    // Navigate to the agent editor (new agent)
    await page.goto(`${BASE_URL}/ai/agents/new`);
    await page.waitForLoadState("networkidle");

    // Wait for the editor to load — the IDE layout should be visible
    const ideLayout = page.locator(".ide-layout, app-ai");
    await expect(ideLayout).toBeVisible({ timeout: 15_000 });

    // ── 4a. Apply a template if the template selector is visible ────────

    // The template selector is in the left nav.  Click "Sales Assistant"
    // template button if available, otherwise continue with blank.
    const templateBtn = page
      .locator("app-ai-editor-nav, .ide-nav")
      .locator("button, .template-item")
      .filter({ hasText: /sales assistant/i })
      .first();
    if (await templateBtn.isVisible().catch(() => false)) {
      await templateBtn.click();
      // Confirm template application if a dialog appears
      const confirmBtn = page.getByRole("button", { name: /apply|confirm|ok/i });
      if (await confirmBtn.isVisible().catch(() => false)) {
        await confirmBtn.click();
      }
      await page.waitForTimeout(1_000);
    }

    // ── 4b. Set agent name and description (General section) ────────────

    // The general config section should be the default view.
    // Click on the "General" nav item to ensure we're there.
    const generalNav = page
      .locator("app-ai-editor-nav, .ide-nav")
      .locator("button, .nav-item, a")
      .filter({ hasText: /general/i })
      .first();
    if (await generalNav.isVisible().catch(() => false)) {
      await generalNav.click();
      await page.waitForTimeout(500);
    }

    // Fill agent name
    const nameField = page
      .locator('mat-form-field')
      .filter({ hasText: /agent name/i })
      .locator("input")
      .first();
    if (await nameField.isVisible().catch(() => false)) {
      await nameField.fill("Sales Assistant Agent");
    }

    // Fill description
    const descField = page
      .locator('mat-form-field')
      .filter({ hasText: /description/i })
      .locator("input")
      .first();
    if (await descField.isVisible().catch(() => false)) {
      await descField.fill(
        "AI-powered sales assistant for OnCity.com product recommendations",
      );
    }

    // Select LLM connector — openai-llm
    const connectorSelect = page
      .locator('mat-form-field')
      .filter({ hasText: /llm connector/i })
      .locator("mat-select")
      .first();
    if (await connectorSelect.isVisible().catch(() => false)) {
      await connectorSelect.click();
      const opt = page.locator("mat-option").filter({ hasText: /openai-llm/i }).first();
      if (await opt.isVisible().catch(() => false)) {
        await opt.click();
      } else {
        // Close the overlay if the option isn't there
        await page.keyboard.press("Escape");
      }
      await page.waitForTimeout(500);
    }

    // Select LLM provider — openai
    const providerSelect = page
      .locator('mat-form-field')
      .filter({ hasText: /llm provider/i })
      .locator("mat-select")
      .first();
    if (await providerSelect.isVisible().catch(() => false)) {
      await providerSelect.click();
      await page.locator("mat-option").filter({ hasText: /openai/i }).first().click();
      await page.waitForTimeout(500);
    }

    // ── 4c. Add skills from catalog ─────────────────────────────────────

    // Navigate to the Skills section in the editor nav
    const skillsNav = page
      .locator("app-ai-editor-nav, .ide-nav")
      .locator("button, .nav-item, a")
      .filter({ hasText: /skills/i })
      .first();
    if (await skillsNav.isVisible().catch(() => false)) {
      await skillsNav.click();
      await page.waitForTimeout(500);
    }

    // Click "Add Skill from Catalog" (the catalog button, not the inline one)
    const addFromCatalogBtn = page
      .getByRole("button", { name: /from catalog|add.*catalog/i })
      .first();
    if (await addFromCatalogBtn.isVisible().catch(() => false)) {
      await addFromCatalogBtn.click();

      // Wait for the skill picker dialog
      const pickerDialog = page.locator(
        "mat-dialog-container, .mat-mdc-dialog-container, app-skill-picker-dialog",
      );
      await expect(pickerDialog).toBeVisible({ timeout: 5_000 });

      // Select all 3 skills via their checkboxes
      const skillNames = [
        "oncity-product-search",
        "oncity-price-comparison",
        "oncity-sales-recommender",
      ];
      for (const name of skillNames) {
        const row = pickerDialog.locator(".skill-row, label").filter({
          hasText: name,
        });
        if (await row.isVisible().catch(() => false)) {
          const checkbox = row.locator("mat-checkbox, input[type=checkbox]").first();
          await checkbox.click();
        }
      }

      // Click "Add Selected"
      await pickerDialog
        .getByRole("button", { name: /add selected/i })
        .click();

      await pickerDialog
        .waitFor({ state: "detached", timeout: 10_000 })
        .catch(() => {});
      await page.waitForTimeout(1_000);
    }

    // ── 4d. Add tool with adapter ───────────────────────────────────────

    // Navigate to the Tools section
    const toolsNav = page
      .locator("app-ai-editor-nav, .ide-nav")
      .locator("button, .nav-item, a")
      .filter({ hasText: /tools/i })
      .first();
    if (await toolsNav.isVisible().catch(() => false)) {
      await toolsNav.click();
      await page.waitForTimeout(500);
    }

    // Click "Add Tool" button
    const addToolBtn = page
      .locator("app-ai-editor-nav, .ide-nav")
      .getByRole("button", { name: /add tool|\+ tool|new tool/i })
      .first();
    if (await addToolBtn.isVisible().catch(() => false)) {
      await addToolBtn.click();
      await page.waitForTimeout(1_000);
    }

    // Fill tool name
    const toolNameField = page
      .locator('mat-form-field')
      .filter({ hasText: /tool name/i })
      .locator("input")
      .first();
    if (await toolNameField.isVisible().catch(() => false)) {
      await toolNameField.fill("search-products");
    }

    // Fill tool description
    const toolDescField = page
      .locator('mat-form-field')
      .filter({ hasText: /description/i })
      .locator("input")
      .first();
    // There might be multiple description fields — target the one in the tool form
    const toolForm = page.locator("app-ai-editor-tool-form, .focus-card").last();
    const toolDesc = toolForm
      .locator('mat-form-field')
      .filter({ hasText: /description/i })
      .locator("input")
      .first();
    if (await toolDesc.isVisible().catch(() => false)) {
      await toolDesc.fill("Search products on OnCity.com");
    }

    // Switch source type to "Adapter"
    const adapterToggle = page
      .locator(".toggle-btn, button")
      .filter({ hasText: /adapter/i })
      .first();
    if (await adapterToggle.isVisible().catch(() => false)) {
      await adapterToggle.click();
      await page.waitForTimeout(1_000);
    }

    // Select the adapter from the dropdown (oncity-api → search-products)
    // The adapter form uses mat-select for Adapter and Endpoint
    const adapterSelectField = page
      .locator("app-tool-adapter-form, .adapter-form")
      .locator("mat-form-field")
      .filter({ hasText: /^adapter$/i })
      .locator("mat-select")
      .first();
    if (await adapterSelectField.isVisible().catch(() => false)) {
      await adapterSelectField.click();

      // Wait for options to load
      await page.waitForTimeout(1_000);

      // Use page.evaluate to click the oncity-api option since
      // mat-option text may include extra info (e.g. status)
      const optionClicked = await page.evaluate(() => {
        const options = document.querySelectorAll("mat-option");
        for (const opt of options) {
          if (opt.textContent?.includes("oncity-api")) {
            (opt as HTMLElement).click();
            return true;
          }
        }
        return false;
      });

      if (!optionClicked) {
        // Fallback: try Playwright locator
        const adapterOption = page
          .locator("mat-option")
          .filter({ hasText: /oncity-api/i })
          .first();
        if (await adapterOption.isVisible().catch(() => false)) {
          await adapterOption.click();
        }
      }

      await page.waitForTimeout(1_000);

      // Now select the endpoint (search-products)
      const endpointSelectField = page
        .locator("app-tool-adapter-form, .adapter-form")
        .locator("mat-form-field")
        .filter({ hasText: /endpoint/i })
        .locator("mat-select")
        .first();
      if (await endpointSelectField.isVisible().catch(() => false)) {
        await endpointSelectField.click();
        await page.waitForTimeout(500);

        // Use page.evaluate for the endpoint option
        await page.evaluate(() => {
          const options = document.querySelectorAll("mat-option");
          for (const opt of options) {
            if (opt.textContent?.includes("search-products")) {
              (opt as HTMLElement).click();
              return true;
            }
          }
          return false;
        });

        await page.waitForTimeout(500);
      }
    }

    // ── 4e. Fill System Prompt ──────────────────────────────────────────

    // Navigate to the "Instruction" or "System Prompt" section
    const instructionNav = page
      .locator("app-ai-editor-nav, .ide-nav")
      .locator("button, .nav-item, a")
      .filter({ hasText: /instruction|prompt|system/i })
      .first();
    if (await instructionNav.isVisible().catch(() => false)) {
      await instructionNav.click();
      await page.waitForTimeout(500);
    }

    // The system prompt uses a Monaco editor — use page.evaluate to set its value
    const monacoEditor = page.locator(
      ".monaco-editor, .view-lines, ngx-monaco-editor",
    );
    if (await monacoEditor.isVisible().catch(() => false)) {
      await page.evaluate(() => {
        // Access Monaco editor instance from the global monaco object
        const editors = (window as any).monaco?.editor?.getEditors?.();
        if (editors && editors.length > 0) {
          const editor = editors[0];
          editor.setValue(`You are a professional sales assistant for OnCity.com, an e-commerce store specializing in electronics, TVs, and home entertainment.

Your role:
- Help customers find the perfect products for their needs
- Use the search-products tool to query the OnCity catalog
- Provide personalized recommendations based on customer preferences
- Compare prices and features across product categories
- Highlight deals, promotions, and best-value options

Guidelines:
- Always be friendly, professional, and helpful
- Ask clarifying questions to understand customer needs
- Present product information clearly with price, availability, and key features
- When comparing products, use tables for clarity
- Suggest complementary products and accessories
- If a product is unavailable, suggest similar alternatives`);
        }
      });
    }

    // ── 4f. Save the agent ──────────────────────────────────────────────

    // Click the Save button in the top bar
    const saveBtn = page
      .locator("app-ai-top-bar, .top-bar")
      .getByRole("button", { name: /save/i })
      .first();
    if (await saveBtn.isVisible().catch(() => false)) {
      await saveBtn.click();

      // Wait for save to complete — check for success message or URL change
      await page.waitForTimeout(3_000);

      // After save, the URL should change to /ai/agents/:id/configure
      const url = page.url();
      expect(url).toMatch(/\/ai\/agents\/[\w-]+/);
    }

    // ── 4g. Publish the agent ───────────────────────────────────────────

    // Extract agent ID from the current URL
    const currentUrl = page.url();
    const agentIdMatch = currentUrl.match(/\/ai\/agents\/([\w-]+)/);

    if (agentIdMatch) {
      const agentId = agentIdMatch[1];

      // Navigate to the agent's settings page
      await page.goto(`${BASE_URL}/ai/agents/${agentId}/settings`);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1_000);

      // Click Publish button
      const publishBtn = page.getByRole("button", { name: /publish/i });
      if (await publishBtn.isVisible().catch(() => false)) {
        await publishBtn.click();

        // Wait for the status to change to "published"
        await page.waitForTimeout(3_000);

        // Verify the published status indicator
        const publishedStatus = page.locator(".status-published, .status-pill").filter({
          hasText: /published/i,
        });
        await expect(publishedStatus).toBeVisible({ timeout: 15_000 });
      }
    }
  });
});
