#!/usr/bin/env node
/**
 * sdd-profile — switch the model tier of the SDD subagents (.claude/agents/sdd-*.md)
 * according to a named profile in .claude/sdd-profiles.json.
 *
 * Mirrors the team's .ywai/sdd-profiles.json idea, but for Claude Code: it rewrites
 * the `model:` line in each agent's YAML frontmatter (Claude Code reads the model
 * per-agent from that field).
 *
 * Usage:
 *   node scripts/sdd-profile.mjs list           # show available profiles
 *   node scripts/sdd-profile.mjs show           # show active profile + each agent's current model
 *   node scripts/sdd-profile.mjs use <profile>  # apply a profile (idempotent)
 *
 * Runs under Node or Bun. Pure functions, verbose, idempotent. Never throws silently.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROFILES_PATH = join(REPO_ROOT, ".claude", "sdd-profiles.json");
const AGENTS_DIR = join(REPO_ROOT, ".claude", "agents");

const log = (msg) => process.stdout.write(`[sdd-profile] ${msg}\n`);
const fail = (msg) => {
  process.stderr.write(`[sdd-profile] ERROR: ${msg}\n`);
  process.exit(1);
};

const readProfiles = () => {
  if (!existsSync(PROFILES_PATH)) fail(`missing ${PROFILES_PATH}`);
  try {
    return JSON.parse(readFileSync(PROFILES_PATH, "utf8"));
  } catch (e) {
    fail(`cannot parse sdd-profiles.json: ${e.message}`);
  }
};

const writeProfiles = (cfg) =>
  writeFileSync(PROFILES_PATH, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");

/** Agent files named sdd-*.md; the phase key is the filename without extension. */
const listAgentFiles = () =>
  existsSync(AGENTS_DIR)
    ? readdirSync(AGENTS_DIR)
        .filter((f) => f.startsWith("sdd-") && f.endsWith(".md"))
        .map((f) => ({ phase: f.replace(/\.md$/, ""), path: join(AGENTS_DIR, f) }))
    : [];

const currentModel = (text) => {
  const m = text.match(/^model:\s*(.+)\s*$/m);
  return m ? m[1].trim() : null;
};

/** Rewrite the `model:` frontmatter line. Returns the new text (or null if no field). */
const withModel = (text, model) =>
  /^model:\s*.+$/m.test(text)
    ? text.replace(/^model:\s*.+$/m, `model: ${model}`)
    : null;

const resolveModel = (profile, phase) =>
  profile.phases[phase] ?? profile.phases.default ?? "inherit";

const cmdList = (cfg) => {
  log(`active profile: ${cfg.active_profile}`);
  for (const [name, p] of Object.entries(cfg.profiles)) {
    log(`profile "${name}": ${JSON.stringify(p.phases)}`);
  }
};

const cmdShow = (cfg) => {
  log(`active profile: ${cfg.active_profile}`);
  const files = listAgentFiles();
  if (files.length === 0) log("(no .claude/agents/sdd-*.md found)");
  for (const { phase, path } of files) {
    log(`  ${phase}: model=${currentModel(readFileSync(path, "utf8")) ?? "(unset)"}`);
  }
};

const cmdUse = (cfg, profileName) => {
  const profile = cfg.profiles[profileName];
  if (!profile) fail(`unknown profile "${profileName}". Try: ${Object.keys(cfg.profiles).join(", ")}`);

  const files = listAgentFiles();
  if (files.length === 0) fail(`no agent files in ${AGENTS_DIR}`);

  let changed = 0;
  for (const { phase, path } of files) {
    const text = readFileSync(path, "utf8");
    const model = resolveModel(profile, phase);
    const next = withModel(text, model);
    if (next === null) {
      log(`  ${phase}: SKIP (no \`model:\` field in frontmatter)`);
      continue;
    }
    if (next === text) {
      log(`  ${phase}: already ${model}`);
      continue;
    }
    writeFileSync(path, next, "utf8");
    changed++;
    log(`  ${phase}: -> ${model}`);
  }

  cfg.active_profile = profileName;
  writeProfiles(cfg);
  log(`applied profile "${profileName}" (${changed} file(s) changed). active_profile saved.`);
};

const main = () => {
  const [cmd, arg] = process.argv.slice(2);
  const cfg = readProfiles();
  switch (cmd) {
    case "list":
      return cmdList(cfg);
    case "show":
      return cmdShow(cfg);
    case "use":
      if (!arg) fail("usage: sdd-profile.mjs use <profile>");
      return cmdUse(cfg, arg);
    default:
      log("usage: sdd-profile.mjs <list|show|use <profile>>");
      process.exit(cmd ? 1 : 0);
  }
};

main();
