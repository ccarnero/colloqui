# AGENTS.md - Voice Wave Demo

## Project Overview

Voice Wave Demo is a **host-only sandbox** that pairs the [`supertonic`](https://github.com/supertone-inc/supertonic) Python TTS engine with a tiny browser UI to visualise the resulting audio as an animated waveform. A Bun + Fastify process serves the static frontend and exposes `POST /synthesize`; it talks to a long-lived Python sidecar over stdin/stdout using a small length-prefixed binary protocol. The browser decodes the WAV bytes, wires them through an `AudioBufferSourceNode → AnalyserNode → destination` graph, and drives a canvas redraw with `requestAnimationFrame`.

It is intentionally not part of the cluster. No Dockerfile, no Helm chart, no entry in `infrastructure/` or `knative/`. The whole point is to iterate locally on Supertonic without paying the cost of a containerised stack.

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun 1.x |
| Framework | Fastify 4 (plain, no NestJS — the surface area is tiny) |
| Language | TypeScript 5 (strict) |
| Static serving | `@fastify/static` |
| Validation | Zod 3 |
| TTS engine | `supertonic` (pypi), ONNX Runtime under the hood |
| Audio I/O (Python) | `soundfile`, `numpy` |
| Python tooling | `uv` (venv + lockfile) |
| Frontend | Vanilla HTML + JS modules + Web Audio API |

## Repository Structure

```
demos/voice-wave-demo/
├── package.json
├── tsconfig.json
├── README.md
├── AGENTS.md                # this file
├── src/
│   ├── server.ts            # Fastify entrypoint, routes, graceful shutdown
│   ├── pythonBridge.ts      # spawns + serialises requests to the Python sidecar
│   └── schemas.ts           # Zod request schema + voice preset list
├── public/
│   ├── index.html           # form + canvas
│   ├── app.js               # fetch → decodeAudioData → AnalyserNode → canvas rAF
│   └── styles.css
└── python/
    ├── pyproject.toml       # uv-managed; deps: supertonic, numpy, soundfile
    ├── tts_worker.py        # daemon: stdin JSON-line → supertonic → stdout WAV frame
    └── README.md            # uv sync; first run downloads ~260 MB
```

## Key Files

| File | Purpose |
|------|---------|
| `src/server.ts` | Fastify boot, registers `@fastify/static`, exposes `GET /health` and `POST /synthesize`. Boots the Python bridge before listening; calls `bridge.stop()` on `SIGINT` / `SIGTERM`. |
| `src/pythonBridge.ts` | Spawns the Python sidecar with `Bun.spawn`, serialises requests through a single-slot promise queue, decodes length-prefixed framed responses, and re-emits the worker's stderr unchanged. |
| `src/schemas.ts` | Single source of truth for the request contract (`SynthesizeRequest`). Voice presets and ranges match the Supertonic HF Space UI. |
| `public/index.html` | Form (text + voice + language + steps + speed) plus a `<canvas>` for the waveform. |
| `public/app.js` | Posts JSON, decodes the returned WAV via `AudioContext.decodeAudioData`, builds `AudioBufferSourceNode → AnalyserNode → destination`, drives the canvas with `getByteTimeDomainData` inside a `requestAnimationFrame` loop. Mute toggle routes through a zeroed `GainNode` so the waveform still animates without audible playback. |
| `python/tts_worker.py` | Long-lived daemon. Loads `supertonic.TTS(auto_download=True)` once, emits a ready frame on stdout, then loops reading JSON lines and writing framed WAV (or framed error). |

## Bun ↔ Python wire protocol

The Bun parent and the Python sidecar exchange framed messages over stdin/stdout.

- **stdin (Bun → Python)**: one JSON object per line, newline-terminated.
  ```json
  {"text":"...","voice":"M3","language":"en","totalSteps":8,"speed":1.0}
  ```
- **stdout (Python → Bun)**: framed binary responses, one per request. Each frame is:
  - 1 byte: `status` (`0` = ok, `1` = error, `2` = ready)
  - 4 bytes: big-endian `uint32` payload length
  - N bytes: payload
    - `status=0` → raw WAV bytes
    - `status=1` → UTF-8 error message
    - `status=2` → empty (`length=0`); emitted exactly once after model load so the bridge knows the worker is ready
- **stderr**: human-readable diagnostics from Python. The Bun parent inherits stderr, so logs from both sides appear in the same terminal.

Concurrency: the bridge serialises requests through a single promise chain. One synthesise at a time. This is acceptable for a sandbox; pool/queue is left as a follow-up.

## Why no Dockerfile / no chart

This service exists to iterate locally on Supertonic without the deploy stack getting in the way. If you find yourself reaching for `Dockerfile`, `infrastructure/overlays/...`, or a `knative/services/base/voice-wave-demo.yaml`, stop — the goal is to keep this strictly host-only. If the demo ever graduates into a real platform feature, give it a new name and a fresh layout that matches the conventions of the other services in `services/`.

## Local development tips

- The first `POST /synthesize` after starting the worker still pays the model-load cost only on a cold disk (no model files yet). Subsequent worker restarts are fast because the model files are cached.
- The `mute` checkbox on the UI routes the audio through a zeroed `GainNode` so the canvas still animates without playback — useful when you want to inspect the waveform without bothering anyone.
- `totalSteps` and `speed` are forwarded as kwargs to `tts.synthesize(...)`; if the installed Supertonic build doesn't accept them, the worker quietly retries without those kwargs (see the `try/except TypeError` in `tts_worker.py`).
