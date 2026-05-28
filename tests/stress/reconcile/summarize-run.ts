import { readFile, writeFile } from "node:fs/promises";

import {
  buildRunSummary,
  formatRunSummaryCsvRow,
  runSummaryCsvHeader,
} from "../lib/run-summary";

type CliOptions = {
  label: string;
  targetRate: number;
  duration: string;
  k6SummaryPath: string;
  reconcileCsvPath: string;
  outputPath: string | null;
};

function parseCli(): CliOptions {
  const args = process.argv.slice(2);
  const opts = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const next = args[index + 1];
    if (!token?.startsWith("--") || !next?.length || next.startsWith("--")) {
      continue;
    }
    opts.set(token.slice(2), next);
    index += 1;
  }

  const label = requiredOption(opts, "label");
  const targetRate = Number(requiredOption(opts, "rate"));
  if (!Number.isFinite(targetRate)) {
    throw new Error("--rate must be numeric.");
  }

  return {
    label,
    targetRate,
    duration: requiredOption(opts, "duration"),
    k6SummaryPath: requiredOption(opts, "k6-summary"),
    reconcileCsvPath: requiredOption(opts, "reconcile-csv"),
    outputPath: opts.get("output") ?? null,
  };
}

async function main() {
  const options = parseCli();
  const [k6SummaryRaw, reconcileCsv] = await Promise.all([
    readFile(options.k6SummaryPath, "utf8"),
    readFile(options.reconcileCsvPath, "utf8"),
  ]);

  const summary = buildRunSummary({
    label: options.label,
    targetRate: options.targetRate,
    duration: options.duration,
    k6Summary: JSON.parse(k6SummaryRaw),
    reconcileCsv,
  });
  const csv = `${runSummaryCsvHeader}\n${formatRunSummaryCsvRow(summary)}\n`;

  if (options.outputPath) {
    await writeFile(options.outputPath, csv);
  } else {
    process.stdout.write(csv);
  }
}

function requiredOption(opts: Map<string, string>, key: string): string {
  const value = opts.get(key);
  if (!value) {
    throw new Error(`Missing required --${key} <value>.`);
  }
  return value;
}

await main();
