# Git Hooks

The hook surface of **this** repository (platform-cluster).

> **Rewritten 2026-08-03 (docs-truth-audit T08).** The previous version of this
> file described a `lefthook.yml` with `pre-commit` / `commit-msg` / `pre-push`
> stanzas, a `core.hooksPath` of `.lefthook`, and `lefthook install`
> troubleshooting. None of that has ever existed here. It was also textually
> corrupted — several fenced blocks were spliced mid-word (`cat
> lefthook.ymlxisting Hook`, `eyaml`, `# On Linux/lefthook is installed`), so
> parts of it were not even readable as instructions. It has been replaced with
> the checked reality.

## There is no commit-time enforcement

Nothing in this repo validates a commit message, blocks a commit on lint, or
blocks a push on tests. The commit conventions in
[COMMIT-MESSAGE-FORMAT.md](COMMIT-MESSAGE-FORMAT.md) are enforced by **review**
(the manual-loop's dual adversarial review), not by a hook.

Verify — all four produce nothing:

```bash
fd -H -g 'lefthook*' .        # no lefthook config
fd -H -g 'commitlint*' .      # no commitlint config
fd -H -g '.husky' .           # no husky
git config core.hooksPath     # empty → git uses the default .git/hooks
```

There is no `pre-commit`, `commit-msg`, `pre-push`, or `prepare-commit-msg`
hook. `ls -la .git/hooks | rg -v sample` lists exactly two files, both described
below.

## The two real git hooks: `post-merge` and `post-checkout`

Both exist only to keep the `codebase-memory-mcp` code graph fresh. Both are
short `/bin/sh` scripts that background `scripts/cbm-reindex.sh` and get out of
the way:

| Hook | Fires | Body |
|---|---|---|
| `post-merge` | after every `git pull` / `git merge` | `nohup "$REPO/scripts/cbm-reindex.sh" >"$REPO/.git/cbm-reindex.log" 2>&1 &` then `exit 0` |
| `post-checkout` | after a **branch** checkout only — guarded by `[ "${3:-0}" = "1" ] \|\| exit 0`, so file-only checkouts are skipped | same body |

Properties that matter:

- **They can never block you.** Both end in `exit 0`, and `scripts/cbm-reindex.sh`
  itself uses `set -uo pipefail` **without** `-e` and exits 0 on every path
  (missing binary, missing repo dir, failed index) — that script's header states
  this as a contract.
- **They are not versioned.** `.git/hooks/` lives inside the git directory, so
  nothing there can be tracked, and this repo sets no `core.hooksPath` and ships
  no template directory. `git ls-files | rg hook` matches only
  `scripts/claude-hook-lint-test.sh`, which is not a git hook at all. **A fresh
  clone has neither hook** — install them by hand; the recipe is in
  `cowork/codebase-memory-mcp-setup.md`, "First-time setup on a new machine".
- Output goes to `.git/cbm-reindex.log`.

## The Claude Code hook (not a git hook)

`.claude/settings.json` registers one `PostToolUse` entry with matcher
`Edit|Write|MultiEdit`, running `scripts/claude-hook-lint-test.sh` on the file
just edited. It fires on **tool use**, not on a git operation.

```bash
rg -n PostToolUse -A6 .claude/settings.json
```

What it does, per that script's own header:

1. **biome** — the real check. `biome.json` sits at the repo root.
2. **`vitest related`** — largely inert. `vitest` is a devDependency of
   `services/admin-console` **only**; every other package runs `bun test` or
   `tsx --test`, so for almost any edited `.ts` this step resolves no vitest
   project and its "FAILURES … not blocking" line means nothing. The script's
   header carries this caveat explicitly.
3. It **always exits 0** (four early `exit 0` paths plus the final one;
   `set -uo pipefail` without `-e`), so it can never block an edit.

## Running the checks yourself

Since no hook runs them for you, run them before committing:

```bash
npx biome check .                        # lint + format, whole repo
./scripts/checks/doc-code-guards.sh      # doc/code drift (G0 in every SPEC)
```

Then the suite of whatever you touched — a service's or package's own `test`
script, or `cd sdk && bun run build && bun test` for the SDK. The root
`package.json` declares **no `scripts` key at all** (`rg -n '"scripts"'
package.json` → no matches), so there is no repo-wide `npm test`.

## Related Skills

- **`git-commit`** — commit message format and the branching reality
- **`playwright`** — the browser E2E suite and how to run it
