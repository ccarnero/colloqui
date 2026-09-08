# Revision 3 execution preflight — 2026-09-08

Revision 3 was compared with /tmp/certification-qa-findings-r2.md, AGENTS.md and DOCS/guides/codex-manual-loop.md. The runner constraint is substantively equivalent to the proposed replacement: Luna low at the economical coding tier, below implementation/QA, with native callability and cost checks and no higher-cost fallback. No contract replacement was necessary. The four prior SPEC defects are resolved. The human approved revision 3 and both branches of T04; approval persists.

Native script-runner probe /root/runner_r3 made no tool calls and returned readiness. preflight-provenance.json records its observed gpt-5.6-luna / low turn and QA provenance. Configuration alone is not the observation.

Cost basis checked 2026-09-08: `codex login status` exited 0 and reported `Logged in using ChatGPT`. It also reported `WARNING: proceeding, even though we could not create PATH aliases: Operation not permitted (os error 1)`; this non-causal warning did not prevent status verification. No login, billing, purchase, provider or API change was made. The official account-tool pricing page https://learn.chatgpt.com/docs/pricing was opened and its Token rates table inspected: Luna input/cached/output = 5/0.5/30 credits per million; Sol = 100/10/500. These establish the lower configured cost under the explicitly approved exception, not actual total consumption or a dollar bill. The same basis is recorded in codex-manual-loop-repair.md, Final runner selection. Public API prices were not used.

Baseline: baseline-manifest.json hashes 3815 preexisting files at HEAD 820221a951686cea91589ae3d8ac73ae2178156e; baseline-status.txt and both baseline diffs preserve ownership. The initially untracked certification SPEC is approved task scope; all other baseline work remains preserved. Evidence artifacts created by the principal are execution records under manual-loop step 6, not changes to task requirements.

No cluster gates, dev-mode validation, service builds or frozen installs apply: the approved queue writes Markdown only and declares these exclusions. No skipped iteration debt is claimed. FP architecture skill is applied under repository precedence; no runtime FP changes are in scope. Engram is not exposed as a callable tool; durable records remain in this SPEC/evidence.

Execution exceptions so far: broad evidence search and initial combined document/web output were truncated; targeted reads recovered relevant records and pricing table. No gate retries or model fallbacks occurred.

Implementation preflight interruption: fp-dev initially reported the old strict-below-both runner wording. Principal reread current Constraints directly, confirmed the R3 exception remained present, and sent the exact current location back to fp-dev for reconciliation. No contract edit or gate retry was authorized by that exchange.

Resolved: fp-dev reread the current SPEC, reported SHA-256 7f957111cf683cb50992475a2e1b0a65f6dd996780b0b8756fd15553e16be6b3 and the correct exception at lines 116-125, withdrew the false blocker, and attributed it to interleaved/truncated old /tmp findings in its first combined read. This was a pre-implementation reading correction, not an implementation retry.

Before gates, the coordinator snapshot initially listed non-file/dangling-symlink entries as new because baseline hashing covers readable files only. The new-file comparison was aligned to the same file predicate and recaptured. Original baseline hashes were unchanged. Preservation claims cover the 3815 recorded readable files; non-file entries are not claimed as hash-verified. This evidence preparation correction consumed no implementation attempt or gate retry.
