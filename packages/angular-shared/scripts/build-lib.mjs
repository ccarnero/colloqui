import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [
  join(root, "../../services/admin-console/node_modules"),
  join(root, "../../services/messaging-console/node_modules"),
];

const hostNodeModules = candidates.find((p) =>
  existsSync(join(p, "@angular", "core")),
);

if (!hostNodeModules) {
  console.error(
    "build-lib: install dependencies in admin-console or messaging-console first.",
  );
  process.exit(1);
}

mkdirSync(join(root, "node_modules"), { recursive: true });

for (const pkg of ["@angular", "rxjs"]) {
  const src = join(hostNodeModules, pkg);
  const dest = join(root, "node_modules", pkg);
  try { rmSync(dest, { recursive: true, force: true }); } catch { /* ignore */ }
  if (existsSync(src)) symlinkSync(src, dest, "dir");
}

const tsc = join(hostNodeModules, ".bin", "tsc");
const result = spawnSync(
  tsc,
  ["-p", "tsconfig.lib.json"],
  { cwd: root, stdio: "inherit" },
);
process.exit(result.status ?? 1);
