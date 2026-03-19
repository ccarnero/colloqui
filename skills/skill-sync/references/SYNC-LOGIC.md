# How sync.sh Works

The `sync.sh` script keeps skill metadata aligned with every `AGENTS.md` file in the repo.

## Sync Process

1. **Scan**: Finds every `SKILL.md` under `skills/`.
2. **Extract**: Uses `awk`/`sed` to pull `name`, `description`, and `auto_invoke` from the YAML frontmatter.
3. **Normalize**: Converts CRLF to LF so parsing remains stable on Windows.
4. **Update**: Targets the HTML-comment anchors inside each `AGENTS.md` and regenerates the "Auto-invoke Capabilities" tables.

## Supported AGENTS.md Files

The script updates these paths based on each skill's `scope`:

- **`root`**: `/AGENTS.md` (project root)

- **Custom scopes**: Auto-detected by searching subdirectories
  - The script searches for `AGENTS.md` files in subdirectories matching the scope name (case-insensitive)
  - Example: `scope: backend` → finds `/Backend/AGENTS.md`, `/backend/AGENTS.md`, etc.
  - Example: `scope: api` → finds `/API/AGENTS.md`, `/WebApi/AGENTS.md`, etc.

## Troubleshooting

When a skill entry is missing:
1. Confirm the frontmatter is well-formed YAML.
2. Ensure `metadata.scope` includes the desired target.
3. Verify `sync.sh` is executable (`chmod +x`).
