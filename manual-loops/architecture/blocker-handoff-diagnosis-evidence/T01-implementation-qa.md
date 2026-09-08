# T01 implementation and QA evidence

Implementation: native fp-dev, run 01a0822a-ac72-7102-9608-7f1099e5bb24,
observed gpt-5.6-sol medium in actual turn telemetry. The role self-report could
not identify the exact model; the principal verified the session record.

Changed only DOCS/guides/manual-loop.md, replacing step 7's second bullet with
the exact approved text. Original first/final bullets and all other bytes remain
unchanged against the preserved dirty baseline. No gates, commits, retries,
fallbacks, scope expansion or test changes by the implementer.

Baseline SHA-256: b414819b107867506442e6e46205b46ba5d14916250978b56bb1aff0452c9d66

Result SHA-256: 009b949a88a2205d9c7f39b3cdf7735738eec6da3e21a7035e19671c0615258b

Postimplementation QA: native fp-qa, run 01a08228-815f-7351-81a7-cc78f1e234ff,
observed gpt-5.6-sol medium. READY for mechanical gates. Inspection confirms
exactly one prescribed replacement against the frozen baseline; original first
and final bullets remain identical. Heading/10-line limit, plain-language/no-ID
requirements, handoff-before-evidence order, all legacy evidence fields,
non-causal labeling, and analysis-only/no-budget/no-reopen boundaries pass.
Maximum four attempts and same-error-twice rule are unchanged; Reporting is
untouched. No QA edits, gates, retries, fallbacks or skipped checks. No new tests
are appropriate for this exact prose-only task or allowed by its write scope.

Full git diffs retain unrelated preexisting changes as baseline context;
T01-task.diff identifies the only implementation delta being certified.
