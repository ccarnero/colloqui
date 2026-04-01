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

const angularSrc = join(hostNodeModules, "@angular");
const angularDest = join(root, "node_modules", "@angular");
mkdirSync(join(root, "node_modules"), { recursive: true });
try {
  rmSync(angularDest, { recursive: true, force: true });
} catch {
  /* ignore */
}
symlinkSync(angularSrc, angularDest, "dir");

const tsc = join(hostNodeModules, ".bin", "tsc");
const result = spawnSync(
  tsc,
  ["-p", "tsconfig.lib.json"],
  { cwd: root, stdio: "inherit" },
);
process.exit(result.status ?? 1);
