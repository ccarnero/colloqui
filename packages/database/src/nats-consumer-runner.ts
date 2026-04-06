import type { Consumer, JsMsg } from "nats";

export interface INatsConsumerRunnerOptions {
  /** Max messages per batch. @default 100 */
  maxMessages?: number;
  /** Idle expiry in ms before re-polling. @default 30_000 */
  expires?: number;
}

export interface INatsConsumerLogger {
  error(message: string): void;
}

/**
 * Encapsulates the JetStream pull-consumer lifecycle (start/stop)
 * and the for-await ack/nak loop used by every NATS-consuming service.
 *
 * @param consumer  JetStream `Consumer` (already resolved from durable name).
 * @param handler   Per-message callback; throw to nak the message.
 * @param logger    Must expose `.error()`; Nest `Logger` or Pino both work.
 * @param options   Optional batch-size / expiry overrides.
 */
export class NatsConsumerRunner {
  private consumeIterator: Awaited<
    ReturnType<Consumer["consume"]>
  > | null = null;

  constructor(
    private readonly consumer: Consumer,
    private readonly handler: (msg: JsMsg) => Promise<void>,
    private readonly logger: INatsConsumerLogger,
    private readonly options: INatsConsumerRunnerOptions = {},
  ) {}

  /** Begin consuming. Safe to call once in `onModuleInit`. */
  async start(): Promise<void> {
    this.consumeIterator = await this.consumer.consume({
      max_messages: this.options.maxMessages ?? 100,
      expires: this.options.expires ?? 30_000,
    });
    this.run();
  }

  /** Gracefully stop the iterator. Safe to call in `onModuleDestroy`. */
  async stop(): Promise<void> {
    if (this.consumeIterator) {
      this.consumeIterator.stop();
      this.consumeIterator = null;
    }
  }

  private async run(): Promise<void> {
    if (!this.consumeIterator) return;
    try {
      for await (const msg of this.consumeIterator) {
        try {
          await this.handler(msg);
          msg.ack();
        } catch (err) {
          this.logger.error(
            `Failed to process message: ${err instanceof Error ? err.message : String(err)}`,
          );
          msg.nak();
        }
      }
    } catch {
      // iterator stopped
    }
  }
}
