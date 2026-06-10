# Voice Wave Demo

> **HOST-ONLY sandbox.** This service runs on your local machine only — there is no Dockerfile, no Helm chart, and it is not deployed to Kubernetes. Everything happens on your Mac.

Local Supertonic text-to-speech playground with a browser waveform visualisation. A Bun + Fastify server serves a tiny static UI and exposes `POST /synthesize`, which forwards the request to a long-lived Python sidecar that runs the [`supertonic`](https://github.com/supertone-inc/supertonic) ONNX engine and streams the resulting WAV back. The browser decodes the audio, feeds it through an `AnalyserNode`, and renders the waveform on a canvas while it plays.

## Quick Start

```bash
# One-time setup (creates the Python venv and installs Bun deps)
cd demos/voice-wave-demo/python
uv sync                  # installs supertonic + numpy + soundfile
cd ..
bun install

# Run
bun run dev              # http://localhost:3000
```

First request triggers a one-off ~260 MB ONNX model download from Hugging Face. After that the model lives on disk and everything works offline.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Static UI (served from `public/`) |
| `POST` | `/synthesize` | Generate speech from JSON, returns `audio/wav` |
| `GET` | `/health` | Liveness probe (`{ ok: true }`) |

## `POST /synthesize`

Request body (JSON):

| Field | Type | Default | Range / Values |
|-------|------|---------|----------------|
| `text` | string | — (required) | min 10 chars |
| `voice` | string | `"M3"` | `M1..M5`, `F1..F5` (Alex, James, Robert, Sam, Daniel, Sarah, Lily, Jessica, Olivia, Emily) |
| `language` | string | `"en"` | 2–3 letter ISO code (`en`, `ko`, `ja`, `es`, ...) |
| `totalSteps` | int | `8` | 2..16 |
| `speed` | number | `1.0` | 0.8..1.3 (step 0.05) |

Response:

- `200 OK` with `Content-Type: audio/wav` and the raw WAV bytes in the body.
- `400 Bad Request` with `{ error }` on validation failure.
- `500 Internal Server Error` with `{ error }` if the Python sidecar fails.

Example:

```bash
curl -X POST http://localhost:3000/synthesize \
  -H 'content-type: application/json' \
  -d '{"text":"hello world this is a test","voice":"M3","language":"en","totalSteps":8,"speed":1.0}' \
  --output out.wav
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `HOST` | `0.0.0.0` | Bind address |
| `PYTHON_BIN` | `./python/.venv/bin/python` | Override the Python interpreter used for the sidecar |

## Testing

```bash
# End-to-end smoke (requires the server running)
curl http://localhost:3000/health
curl -X POST http://localhost:3000/synthesize \
  -H 'content-type: application/json' \
  -d '{"text":"this is a smoke test","voice":"M3","language":"en","totalSteps":8,"speed":1.0}' \
  --output /tmp/out.wav
afplay /tmp/out.wav    # macOS playback to confirm audio is real
```

In the browser, open `http://localhost:3000`, type at least 10 characters, click **Generate**, and confirm the canvas animates the waveform until the audio ends.

## Runs 100% locally

Everything happens on your Mac. There is exactly **one** network call in the entire lifecycle:

- The very first `POST /synthesize` of your life triggers `supertonic.TTS(auto_download=True)` to fetch the ONNX model bundle (~260 MB) from Hugging Face. It is cached under `~/.cache/huggingface/`.

After that one fetch:

- No telemetry, no cloud inference, no analytics.
- Subsequent process restarts reuse the cached model — zero network access.
- You can disconnect WiFi and the service keeps working.
- The browser hits `localhost:3000`. Bun talks to the Python sidecar over stdio. The model runs on CPU on your machine. The audio bytes never leave your loopback interface.

## Is the audio quality the same as the Supertonic HF Space?

Yes — at default settings. Both this service and the Space at <https://huggingface.co/spaces/Supertone/supertonic-3> use the **same ONNX model weights** from Hugging Face. They differ only in which ONNX Runtime binding loads them:

| | Supertonic HF Space | This service |
|---|---|---|
| Where ONNX runs | Browser tab (`onnxruntime-web`, WASM) | Python sidecar (`onnxruntime`, native) |
| Model weights | `Supertone/supertonic-3` | `Supertone/supertonic-3` (same) |
| Voice quality | Identical | Identical |
| CPU speed | Slower (WASM in browser) | Faster (native CPU) |
| Exposed knobs | `totalSteps`, `speed` driven directly to the ONNX sessions | Forwarded to `supertonic.synthesize(...)`. If the pypi wrapper doesn't accept them, the worker silently falls back to the 3-arg form (`text`, `voice_style`, `lang`). |

So: voice timbre, pronunciation, and prosody match the Space. The only practical difference is that `totalSteps` and `speed` are best-effort — they work if the installed `supertonic` build accepts them as kwargs, and quietly no-op if it doesn't. We'll know which it is the moment `uv sync` finishes and we make the first call.

## Architecture

See [AGENTS.md](AGENTS.md) for module layout, the Bun ↔ Python wire protocol, and the rationale for the sandbox-only stance.
