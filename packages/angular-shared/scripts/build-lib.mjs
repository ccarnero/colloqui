import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Build script for @yoizen/angular-shared.
 *
 * angular-shared declares Angular as a peerDependency, so it has no
 * Angular in its own node_modules. To compile (and to keep editor type
 * resolution happy) we symlink the consumer's Angular packages into our
 * local node_modules, then run tsc.
 *
 * Properties this script guarantees:
 *   1. Idempotent — safe to run multiple times in any order. Re-running
 *      replaces stale or broken links cleanly.
 *   2. Path-portable — symlink targets are relative to the symlink's
 *      directory, so node_modules survives being copied between hosts,
 *      containers, or sandboxes.
 *   3. Verbose — every action is logged with a [build-lib] prefix.
 *      Failures abort with a clear, actionable error (no silent skips).
 */

const TAG = "[build-lib]";
const log = (msg) => console.log(`${TAG} ${msg}`);
const warn = (msg) => console.warn(`${TAG} ! ${msg}`);
const fail = (msg) => {
  console.error(`${TAG} ✗ ${msg}`);
  process.exit(1);
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sharedNodeModules = join(root, "node_modules");

/**
 * Consumers known to install Angular. We pick the first one that has a
 * resolvable @angular/core. Order matters only when more than one is
 * installed; the chosen consumer dictates Angular versions visible to
 * the lib build.
 */
const CONSUMER_CANDIDATES = [
  join(root, "../../services/admin-console/node_modules"),
];

const hostNodeModules = CONSUMER_CANDIDATES.find((p) =>
  existsSync(join(p, "@angular", "core")),
);

if (!hostNodeModules) {
  fail(
    "no consumer with @angular installed was found.\n" +
      "  Run `npm install` in services/admin-console first, " +
      "then re-run this build.",
  );
}

log(`linking peer deps from ${hostNodeModules}`);
mkdirSync(sharedNodeModules, { recursive: true });

/**
 * Packages we need at compile time. Add here if angular-shared starts
 * importing from another peer package.
 */
const PEER_PACKAGES = ["@angular", "rxjs"];

for (const pkg of PEER_PACKAGES) {
  const linkPath = join(sharedNodeModules, pkg);
  const targetAbs = join(hostNodeModules, pkg);

  if (!existsSync(targetAbs)) {
    warn(`${pkg} not found in consumer; skipping`);
    continue;
  }

  // Idempotent removal of any prior entry — symlink (broken or live),
  // real directory, or file. We *don't* swallow failures: if we can't
  // remove the existing entry, the symlink would fail anyway and the
  // user deserves a clear error.
  if (existsForLstat(linkPath)) {
    try {
      rmSync(linkPath, { recursive: true, force: true });
      log(`removed existing ${pkg}`);
    } catch (err) {
      fail(
        `could not remove existing ${linkPath}: ${err.message}\n` +
          "  This usually means the path is on a read-only mount or " +
          "owned by another user. Remove it manually and re-run.",
      );
    }
  }

  // Relative target: from the symlink's *directory* to the absolute
  // target, computed at build time on this machine. Encoded into the
  // symlink as a relative path so the link works after node_modules is
  // copied to a different filesystem layout (Docker image, teammate's
  // clone, sandbox, etc).
  const relTarget = relative(dirname(linkPath), targetAbs);
  try {
    symlinkSync(relTarget, linkPath, "dir");
    log(`linked ${pkg} → ${relTarget}`);
  } catch (err) {
    fail(`failed to symlink ${pkg}: ${err.message}`);
  }
}

const tsc = join(hostNodeModules, ".bin", "tsc");
if (!existsSync(tsc)) {
  fail(
    `tsc not found at ${tsc}.\n` +
      "  Reinstall consumer dependencies (npm install in the consumer).",
  );
}

log("compiling angular-shared with tsc");
const result = spawnSync(tsc, ["-p", "tsconfig.lib.json"], {
  cwd: root,
  stdio: "inherit",
});

if (result.status === 0) {
  log("done");
} else {
  fail(`tsc exited with status ${result.status}`);
}

/**
 * lstatSync throws if the path doesn't exist; this wrapper turns the
 * absence into a boolean so the calling code stays readable.
 */
function existsForLstat(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}
