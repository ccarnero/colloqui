import { spawn, type Subprocess } from 'bun';
import path from 'node:path';
import type { SynthesizeRequest } from './schemas';

type FrameStatus = 0 | 1 | 2;

interface Frame {
  status: FrameStatus;
  payload: Uint8Array;
}

/**
 * Minimal shape we actually use. Both @types/bun and @types/node disagree on
 * the `read()` signature for stdout readers, so we narrow to what works at
 * runtime and cast once on assignment.
 */
interface ByteReader {
  read(): Promise<{ value: Uint8Array | undefined; done: boolean }>;
}

const FRAME_HEADER_BYTES = 5;
const HERE = import.meta.dir;

export class PythonBridge {
  private proc: Subprocess<'pipe', 'pipe', 'inherit'> | null = null;
  private reader: ByteReader | null = null;
  private buf = new Uint8Array(0);
  private queue: Promise<unknown> = Promise.resolve();

  async start(): Promise<void> {
    const pythonBin =
      process.env.PYTHON_BIN ??
      path.resolve(HERE, '../python/.venv/bin/python');
    const workerScript = path.resolve(HERE, '../python/tts_worker.py');
    const workerCwd = path.resolve(HERE, '..');

    this.proc = spawn({
      cmd: [pythonBin, workerScript],
      cwd: workerCwd,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'inherit',
    });
    this.reader = this.proc.stdout.getReader() as unknown as ByteReader;

    const ready = await this.readFrame();
    if (ready.status !== 2) {
      throw new Error('Python worker failed to signal ready');
    }
  }

  synthesize(request: SynthesizeRequest): Promise<Uint8Array> {
    const next = this.queue.then(async () => {
      if (!this.proc?.stdin) {
        throw new Error('Python worker is not running');
      }
      const line = `${JSON.stringify(request)}\n`;
      this.proc.stdin.write(line);
      await this.proc.stdin.flush?.();

      const frame = await this.readFrame();
      if (frame.status === 0) {
        return frame.payload;
      }
      const message = new TextDecoder().decode(frame.payload);
      throw new Error(message);
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  async stop(): Promise<void> {
    try {
      this.proc?.stdin.end();
    } catch {
      /* ignore */
    }
    this.proc?.kill();
    await this.proc?.exited;
    this.proc = null;
    this.reader = null;
  }

  private async readFrame(): Promise<Frame> {
    const header = await this.readExact(FRAME_HEADER_BYTES);
    const status = header[0] as FrameStatus;
    const view = new DataView(
      header.buffer,
      header.byteOffset,
      FRAME_HEADER_BYTES
    );
    const length = view.getUint32(1, false);
    const payload =
      length === 0 ? new Uint8Array(0) : await this.readExact(length);
    return { status, payload };
  }

  private async readExact(n: number): Promise<Uint8Array> {
    if (!this.reader) {
      throw new Error('Python worker is not running');
    }
    while (this.buf.length < n) {
      const { value, done } = await this.reader.read();
      if (done || value === undefined) {
        throw new Error('Python worker exited unexpectedly');
      }
      const merged = new Uint8Array(this.buf.length + value.length);
      merged.set(this.buf);
      merged.set(value, this.buf.length);
      this.buf = merged;
    }
    const out = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    return out;
  }
}
