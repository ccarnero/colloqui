/**
 * http-connectors sample driver — SDK-powered replacement for the old
 * `run.sh` body.
 *
 * This sample has no "call" step of its own (unlike http-bridge): running it
 * just (re)provisions the connectors, same as `./setup.sh`. This mirrors the
 * old bash `run.sh`, which only printed a one-line banner and then `exec`ed
 * `./setup.sh` — see ../run.sh.
 */
import { provisionConnectors } from "./setup.js";

console.log("[run] provisioning HTTP connectors...");

provisionConnectors().catch((e) => {
  console.error("[run] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
