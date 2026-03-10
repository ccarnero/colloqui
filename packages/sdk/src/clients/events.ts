import type { ProcessedEvent } from '@yoizen/shared';
import type { HttpTransport } from '../transport';
import type { PublishEventParams, PublishEventResult } from '../types';

export class EventsClient {
  constructor(private readonly transport: HttpTransport) {}

  async publish(params: PublishEventParams): Promise<PublishEventResult> {
    return this.transport.post<PublishEventResult>('/events', params);
  }

  async getResult(id: string): Promise<ProcessedEvent | null> {
    try {
      return await this.transport.get<ProcessedEvent>(`/results/${encodeURIComponent(id)}`);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 404) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Opens an SSE connection to `/events/stream` and yields parsed events.
   * Caller should use `for await...of` and can `break` to close the stream.
   *
   * @param types Optional comma-separated event types to filter on.
   */
  async *stream(types?: string[]): AsyncIterableIterator<ProcessedEvent> {
    const query: Record<string, string | undefined> = {};
    if (types && types.length > 0) {
      query.types = types.join(',');
    }

    const res = await this.transport.raw('/events/stream', query);

    if (!res.ok || !res.body) {
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop()!;

        for (const part of parts) {
          const event = parseSseEvent(part);
          if (event) yield event;
        }
      }

      if (buffer.trim()) {
        const event = parseSseEvent(buffer);
        if (event) yield event;
      }
    } finally {
      reader.releaseLock();
    }
  }
}

function parseSseEvent(raw: string): ProcessedEvent | null {
  let data = '';

  for (const line of raw.split('\n')) {
    if (line.startsWith('data:')) {
      data += line.slice(5).trimStart();
    }
  }

  if (!data) return null;

  try {
    return JSON.parse(data) as ProcessedEvent;
  } catch {
    return null;
  }
}
