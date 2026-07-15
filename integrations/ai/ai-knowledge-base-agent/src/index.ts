/**
 * ai-knowledge-base-agent sample driver — SDK-powered replacement for the old
 * curl+jq `run.sh` body (see sdk/GROWTH-PLAN.md P3.1).
 *
 * The original `run.sh` was `exec ./setup.sh` — provisioning and driving the
 * KB-backed question were never split into separate scripts for this sample
 * (unlike `http-bridge`), because the whole point of the sample is the
 * end-to-end pipeline: create KB -> upload doc -> wait for embeddings ->
 * attach to a published agent -> ask a question only the document can
 * answer. This file preserves that behavior exactly by re-running the same
 * `main()` from `./setup.ts` (idempotent: RECREATE=0 by default reuses
 * existing resources), after printing the same lead-in line the old
 * `run.sh` printed.
 */
import { main } from "./setup.js";

console.log(
  "[run] provisioning knowledge base + AI agent, then asking a KB-backed question..."
);

main().catch((e) => {
  console.error("[run] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
