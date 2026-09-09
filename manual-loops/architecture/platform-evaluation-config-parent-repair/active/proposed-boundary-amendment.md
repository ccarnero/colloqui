# Proposed boundary amendment — awaiting human approval

The exact two-line implementation remains approved and unchanged. This amendment
only permits recovery from T01 attempt 1/4 procedural validation failure.

After approval, verify each file below against its recorded SHA256 and require
that its UUID directory contains only that regular non-symlink file. Retire only
those four files and their empty UUID directories. Then remove the following
baseline-absent parent directories only if empty, in this order:

1. `manual-loops/architecture/end-to-end-evaluation/evidence/t02/playwright`
2. `manual-loops/architecture/end-to-end-evaluation/evidence/t02`
3. `manual-loops/architecture/end-to-end-evaluation/evidence`

If any ownership, hash, link or emptiness check fails, preserve state and stop.
Do not remove the containing end-to-end-evaluation directory or its summary.
Do not restore retired evidence. Preserve all 3817 other baseline entries.

Exact permitted file retirement:

- `manual-loops/architecture/end-to-end-evaluation/evidence/t02/playwright/0b7a3e40-cb8e-42fc-9309-37e993958126/sentinel.txt` — SHA256 `94247b98f949454288031953a5fd7018f271e212e1d77e1b11d869001bf2eb31`
- `manual-loops/architecture/end-to-end-evaluation/evidence/t02/playwright/36c9fb27-96f2-454f-acf9-504108c313aa/sentinel.txt` — SHA256 `59be9051e36eb1e79d011bada8221fdf68af6f8f997f2bcd9d9dee5440f3d126`
- `manual-loops/architecture/end-to-end-evaluation/evidence/t02/playwright/d8e7b7ee-b5c3-4ab0-beee-c29384a98407/sentinel.txt` — SHA256 `59be9051e36eb1e79d011bada8221fdf68af6f8f997f2bcd9d9dee5440f3d126`
- `manual-loops/architecture/end-to-end-evaluation/evidence/t02/playwright/e2730e0f-4650-4921-bcaa-e9db2d66fe2a/sentinel.txt` — SHA256 `94247b98f949454288031953a5fd7018f271e212e1d77e1b11d869001bf2eb31`

This is a named exception to "No cold-state cleanup before gates" and "Keep
generated sentinels through review" for the verified failed first attempt only.
It is not terminal-task retirement and does not reset any budget.

Authorize fresh validation attempt 2/4 of unchanged test SHA256
`9a9fd4a7694c7505ecbdc7b29806e177bb0d9a7990624d2bb26984ab52e8aa48`.
Keep G0–G3 bodies and acceptance unchanged. Preserve the first-attempt procedural
failure as a compact record; separate fresh output paths before dispatch, freeze
the amended SPEC/commands/source, and recheck QA. Use the same native Luna-low
role with exclusive dispatch marker, immediately persisted per-gate full output,
and retained process identity until completion. No replay on missing output.
Then require QA and two independent parallel native Astra-high final reviews.

No code/configuration/model-policy/install/build/runtime/cluster/Git changes.
Predecessor R01 remains exhausted1/1. Attempt1/4 remains failed; attempt2/4
will only be consumed at authorized fresh dispatch. This proposal is not approval.
