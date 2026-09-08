# T04 attempt2 implementation

Only move unchanged13-line annotation after T01 closing fence. New file SHA-256
cbafcedaf9c5caf67c1e883b2d0921e4f36be69e192474d495950179a5396bec.
Annotation content hash unchanged from attempt1:
d4284e4160b1eaaafac7dbb8852b90b54c0980d2c35f722c35fe7fe01c2c1424.
Diff from fbf7cfe6 is solely the13-line insertion after closing fence; all command
and other original bytes preserved. Branch1 and all truthful wording unchanged.
Native Sol/medium identities: T04-attempt2-preflight-provenance.json.
No tests apply, gates/Accept/commit, scope deviation, fallback or blocker.
One pre-gate QA correction, preserving attempt1 wrong-placement/evidence records.

Correct found/retained predecessor T01 Accept (extracted only within T01):

```sh
grep -n "For humans" DOCS/guides/manual-loop.md && \
grep -n "non-causal" DOCS/guides/manual-loop.md && \
grep -n "creates no budget" DOCS/guides/manual-loop.md && \
grep -c "Max 4 implementation attempts per task" DOCS/guides/manual-loop.md
```

Mechanical order: standard3gates, above required predecessor Accept, then T04own
Accept. Exact multiline command retained without flattening.
