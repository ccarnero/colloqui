#!/usr/bin/env node
/**
 * check-di-imports.mjs — guards against the Biome useImportType / NestJS DI trap.
 *
 * Biome's format-on-save converts value imports to `import type` when it sees
 * no value usage. With emitDecoratorMetadata, a NestJS constructor-injected
 * class imported as `import type` is elided at runtime: design:paramtypes
 * resolves to Object/Function and Nest fails on boot with "can't resolve
 * dependencies of X (?)" — invisible to tsc. This bit the platform three
 * times on 2026-07-07/08 alone (SKBIngestionWorkerService, two audit-service
 * controllers, SKBQueryHistoryService).
 *
 * Flags constructor params typed with a type-only import when:
 *   - the class is Nest-instantiated (@Injectable()/@Controller() directly above), and
 *   - the constructor is public (protected/private = manual super() base class), and
 *   - the param is not token-injected via @Inject(...).
 *
 * Usage:
 *   node scripts/checks/check-di-imports.mjs         # git-modified files; exits 1 on findings
 *   node scripts/checks/check-di-imports.mjs --all   # whole repo; warnings only, exit 0
 *     (factory-constructed @Injectable classes are legit false positives in --all mode)
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const all = process.argv.includes("--all");
const listCmd = all
  ? "git ls-files 'services/*/src/**/*.ts' 'packages/*/src/**/*.ts'"
  : "git status --short | awk '{print $2}'";
const files = execSync(listCmd, { encoding: "utf8" })
  .split("\n")
  .map((l) => l.trim())
  .filter((f) => /^(services|packages)\/.*\/src\/.*\.ts$/.test(f))
  .filter((f) => !f.endsWith(".d.ts") && !f.includes("__tests__"));

let findings = 0;
for (const f of files) {
  let src;
  try {
    src = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  const typeImports = new Set();
  for (const m of src.matchAll(/import type \{([^}]*)\}/g)) {
    for (const name of m[1].split(",")) {
      const n = name.trim().split(/\s+as\s+/).pop();
      if (n) typeImports.add(n);
    }
  }
  if (!typeImports.size) continue;

  // Class blocks that Nest instantiates: decorator directly above the class.
  const classRe = /@(Injectable|Controller)\s*\([^)]*\)\s*\n\s*export\s+(?:abstract\s+)?class\s+\w+[^{]*\{/g;
  for (const cm of src.matchAll(classRe)) {
    const rest = src.slice(cm.index + cm[0].length);
    const ctorMatch = rest.match(/(public\s+|protected\s+|private\s+)?constructor\s*\(([^)]*)\)/s);
    if (!ctorMatch) continue;
    const visibility = (ctorMatch[1] ?? "public").trim();
    if (visibility === "protected" || visibility === "private") continue;
    for (const p of ctorMatch[2].split(",")) {
      if (p.includes("@Inject")) continue;
      for (const t of typeImports) {
        if (new RegExp(`:\\s*${t}\\b`).test(p)) {
          console.error(`DI-TYPE-IMPORT: ${f} -> constructor param typed '${t}' is imported type-only`);
          findings++;
        }
      }
    }
  }
}

if (findings && !all) {
  console.error(`\n${findings} constructor-injected class(es) imported as 'import type' — NestJS DI will fail at runtime.`);
  console.error("Fix: value import + '// biome-ignore lint/style/useImportType' (see repo convention).");
  process.exit(1);
}
console.log(
  findings
    ? `di-imports guard: ${findings} warning(s) in --all mode (verify factory-constructed classes manually)`
    : `di-imports guard: CLEAN (${files.length} files scanned${all ? ", full repo" : ", git-modified only"})`
);
