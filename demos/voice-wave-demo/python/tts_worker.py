"""Supertonic TTS worker — long-lived sidecar for the voice-wave-demo service.

Wire protocol with the Bun parent process:

* stdin: one JSON object per line, terminated by `\n`. Schema:
    {"text": str, "voice": str, "language": str,
     "totalSteps": int, "speed": float}
* stdout: framed binary response per request:
    1 byte status (0 = ok, 1 = error) | 4 bytes BE uint32 length | N bytes payload
    - ok    -> payload is the raw WAV bytes
    - error -> payload is a UTF-8 error message
* stderr: human-readable diagnostics. The parent waits for the line
  `READY` on stderr before sending the first request.
"""

from __future__ import annotations

import io
import json
import struct
import sys
import tempfile
import traceback
from pathlib import Path
from typing import Any

import soundfile as sf
from supertonic import TTS


def _log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def _write_frame(status: int, payload: bytes) -> None:
    header = bytes([status]) + struct.pack(">I", len(payload))
    sys.stdout.buffer.write(header)
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()


def _wav_bytes(tts: TTS, wav: Any) -> bytes:
    """Encode the TTS output array into WAV bytes.

    Tries soundfile + a known sample rate attribute first; falls back to
    `tts.save_audio` writing to a temp file (slower but always works).
    """
    sample_rate = getattr(tts, "sample_rate", None) or getattr(tts, "sr", None)
    if sample_rate is not None:
        arr = wav.squeeze()
        buf = io.BytesIO()
        sf.write(buf, arr, int(sample_rate), format="WAV")
        return buf.getvalue()

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
        tmp_path = Path(tf.name)
    try:
        tts.save_audio(wav, str(tmp_path))
        return tmp_path.read_bytes()
    finally:
        tmp_path.unlink(missing_ok=True)


def _synthesize(tts: TTS, request: dict[str, Any]) -> bytes:
    text: str = request["text"]
    voice: str = request["voice"]
    language: str = request["language"]
    total_steps: int = int(request["totalSteps"])
    speed: float = float(request["speed"])

    style = tts.get_voice_style(voice_name=voice)

    # The pypi wrapper publicly accepts (text, voice_style, lang). totalSteps
    # and speed are exposed by the browser ONNX demo; if the wrapper grows
    # support for them later, pass them through. Otherwise drop them quietly.
    base_kwargs: dict[str, Any] = {
        "text": text,
        "voice_style": style,
        "lang": language,
    }
    extra_kwargs: dict[str, Any] = {
        "total_steps": total_steps,
        "speed": speed,
    }

    try:
        result = tts.synthesize(**base_kwargs, **extra_kwargs)
    except TypeError:
        result = tts.synthesize(**base_kwargs)

    wav = result[0] if isinstance(result, tuple) else result
    return _wav_bytes(tts, wav)


def main() -> None:
    _log("loading supertonic model (first run downloads ~260MB)...")
    tts = TTS(auto_download=True)
    _log("READY")

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            wav_bytes = _synthesize(tts, request)
            _write_frame(0, wav_bytes)
        except Exception as exc:  # noqa: BLE001 — surface every failure
            traceback.print_exc(file=sys.stderr)
            message = f"{type(exc).__name__}: {exc}"
            _write_frame(1, message.encode("utf-8"))


if __name__ == "__main__":
    main()
