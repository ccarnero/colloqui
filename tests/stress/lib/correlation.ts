/**
 * Correlation ID generator with O(1) per-VU id generation.
 *
 * k6 exposes `__VU` (current VU id) and `__ITER` (per-VU iteration counter).
 * Combining them with a process-start nonce gives globally unique ids without
 * needing crypto/UUID imports (which are not available in k6 by default for
 * v4-style ids without `k6/crypto`).
 */

interface ExecGlobals {
    readonly __VU?: number;
    readonly __ITER?: number;
  }
  
  const NONCE = (() => {
    const now = Date.now().toString(36);
    const rnd = Math.floor(Math.random() * 0xffff_ffff).toString(36);
    return `${now}-${rnd}`;
  })();
  
  function readVu(): number {
    return (globalThis as ExecGlobals).__VU ?? 0;
  }
  
  function readIter(): number {
    return (globalThis as ExecGlobals).__ITER ?? 0;
  }
  
  export function nextCorrelationId(prefix = "stress"): string {
    return `${prefix}-${NONCE}-${readVu()}-${readIter()}`;
  }
  
  export interface CorrelationEnvelope {
    readonly correlation_id: string;
    readonly sent_at: number;
    readonly stage: string;
  }
  
  export function buildCorrelationEnvelope(
    stage: string,
    prefix = "stress"
  ): CorrelationEnvelope {
    return Object.freeze({
      correlation_id: nextCorrelationId(prefix),
      sent_at: Date.now(),
      stage,
    });
  }
  