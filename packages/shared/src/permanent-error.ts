/**
 * Thrown by JetStream consumer handlers to indicate that a message
 * is irrecoverably broken and must be terminated (not re-delivered).
 *
 * When a handler throws a `PermanentError`, the `NatsConsumerRunner`
 * will:
 *   1. `msg.term()` — remove the message from the consumer state.
 *   2. Republish the envelope into the per-tenant DLQ stream
 *      (`DLQ-<tenantId>`), extending the envelope with the `dlq_reason`,
 *      `dlq_stage` and `original_subject` metadata fields.
 *
 * Any other error (standard `Error`, timeout, transient I/O failure)
 * is treated as retryable and NAK'd so JetStream schedules a redelivery
 * with backoff.
 */
export class PermanentError extends Error {
  /**
   * Business/technical reason the message is unrecoverable. Copied
   * verbatim into the DLQ envelope so operators can sort by root cause.
   */
  readonly reason: string;

  /**
   * Stage of the pipeline where the failure was raised (e.g. `ingress`,
   * `egress`, `projection`). Lets Grafana alert per stage.
   */
  readonly stage: string;

  constructor(reason: string, stage: string, options?: ErrorOptions) {
    super(`[${stage}] ${reason}`, options);
    this.name = "PermanentError";
    this.reason = reason;
    this.stage = stage;
  }
}

export function isPermanentError(err: unknown): err is PermanentError {
  return err instanceof PermanentError;
}
