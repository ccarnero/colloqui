# voice-wave-demo · python sidecar

Long-lived worker that runs Supertonic and streams WAV bytes back to the Bun parent over stdin/stdout. Not meant to be invoked directly — the parent service spawns it.

## Setup

```bash
uv sync
```

Creates `.venv/` with `supertonic`, `numpy`, and `soundfile`. The parent service defaults to `./python/.venv/bin/python` as the interpreter; override with `PYTHON_BIN` if you use a different toolchain.

## First run

On the very first synthesis request, `supertonic` downloads its ONNX model bundle (~260 MB) from Hugging Face and caches it under your user's HF cache directory (`~/.cache/huggingface/` on macOS/Linux). Subsequent runs are offline.

## CPU only

The Supertonic model runs on CPU — no GPU or special drivers required. A modern Mac (M-series or recent Intel) generates a short utterance in well under a second once the model is loaded.

## Wire protocol

See [`../AGENTS.md`](../AGENTS.md) — section **Bun ↔ Python wire protocol** — for the framed binary format used between this worker and the parent process.
