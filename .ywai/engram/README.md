# Engram Setup

This project uses the `engram-setup` base extension.

The setup requires the `engram` binary.

If `engram` is missing, the installer will attempt an automatic installation.

After `engram` is available, the installer attempts to auto-configure:

- OpenCode
- Codex
- Gemini CLI

Reference:
- https://github.com/Gentleman-Programming/engram

Recommended next step for OpenCode session tracking:

```bash
engram serve &
```

If automatic installation fails, install `engram` manually and rerun:

```bash
bash ywai/setup/lib/installer.sh install-type-extensions generic .
```
