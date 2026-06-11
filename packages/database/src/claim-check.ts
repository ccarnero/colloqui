import { createHash } from "node:crypto";
import type { JsMsg, ObjectStore } from "nats";
import { isCompliantEnvelope } from "@yoizen/shared";
import type { EventEnvelope } from "@yoizen/shared";

// ---------------------------------------------------------------------------
// Fast pre-check
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the raw bytes look like a claim-check envelope.
 * Uses a byte-level substring search for the ASCII marker produced by
 * `JSON.stringify` / `canonicalJson` (no spaces). Avoids double-parsing
 * on the >99% inline path.
 */
export function looksLikeClaimCheck(raw: Uint8Array): boolean {
  return Buffer.from(raw).includes('"payload_inline":false');
}

// ---------------------------------------------------------------------------
// Ref parsing
// ---------------------------------------------------------------------------

const REF_PATTERN = /^nats:\/\/objstore\/([^/]+)\/(.+)$/;

export interface ClaimCheckRef {
  bucket: string;
  key: string;
}

/**
 * Parses a `nats://objstore/<bucket>/<key>` URI. Returns `null` when
 * the URI does not match the expected shape.
 */
export function parseClaimCheckRef(ref: string): ClaimCheckRef | null {
  const m = REF_PATTERN.exec(ref);
  if (!m) return null;
  return { bucket: m[1]!, key: m[2]! };
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export type ClaimCheckErrorCode =
  | "ref_missing"
  | "ref_malformed"
  | "blob_not_found"
  | "checksum_mismatch";

/**
 * Thrown by `resolveClaimCheckEnvelope` when resolution fails.
 * Extends `Error` (NOT `PermanentError`) so resolution failures take
 * the nak/backoff path — the message is retried with exponential backoff
 * and eventually lands in the DLQ after MAX_DELIVER (doc §3.4).
 */
export class ClaimCheckResolveError extends Error {
  public readonly code: ClaimCheckErrorCode;

  constructor(message: string, code: ClaimCheckErrorCode) {
    super(message);
    this.name = "ClaimCheckResolveError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolves a claim-check envelope by fetching the stored payload from the
 * NATS Object Store, verifying its checksum, and returning an inflated
 * envelope with `payload_inline: true`.
 *
 * Invariant: the producer stored exactly `Buffer.from(canonicalJson(payload))`
 * bytes. We verify `sha256(rawFetchedBytes) === envelope.data.payload_checksum`
 * (hash the RAW bytes — never re-canonicalize) then `JSON.parse` to inflate.
 *
 * Throws `ClaimCheckResolveError` on any resolution failure so the runner
 * takes the nak/backoff path (not a permanent term).
 */
export async function resolveClaimCheckEnvelope(
  envelope: EventEnvelope,
  getStore: (bucket: string) => Promise<ObjectStore>,
): Promise<EventEnvelope> {
  const { data } = envelope;

  if (!data.payload_ref) {
    throw new ClaimCheckResolveError(
      `Envelope ${envelope.id} has payload_inline:false but no payload_ref`,
      "ref_missing",
    );
  }

  const parsed = parseClaimCheckRef(data.payload_ref);
  if (!parsed) {
    throw new ClaimCheckResolveError(
      `Malformed payload_ref: ${data.payload_ref}`,
      "ref_malformed",
    );
  }

  const store = await getStore(parsed.bucket);
  const rawBytes = await store.getBlob(parsed.key);

  if (!rawBytes) {
    throw new ClaimCheckResolveError(
      `Blob not found: ${data.payload_ref}`,
      "blob_not_found",
    );
  }

  // Verify checksum over the RAW fetched bytes — never re-canonicalize.
  const actualChecksum =
    "sha256:" + createHash("sha256").update(rawBytes).digest("hex");
  if (actualChecksum !== data.payload_checksum) {
    throw new ClaimCheckResolveError(
      `Checksum mismatch for ${data.payload_ref}: expected ${data.payload_checksum}, got ${actualChecksum}`,
      "checksum_mismatch",
    );
  }

  const payload = JSON.parse(Buffer.from(rawBytes).toString("utf8")) as Record<
    string,
    unknown
  >;

  return {
    ...envelope,
    data: {
      ...data,
      payload_inline: true,
      payload_ref: null,
      payload,
    },
  };
}

// ---------------------------------------------------------------------------
// Proxy wrapper
// ---------------------------------------------------------------------------

/**
 * Returns a `JsMsg` proxy that overrides `data` with `newData` while
 * delegating every other property — including functions — to the underlying
 * message. Function properties are bound to `target` so `ack/nak/term`
 * retain their internal `this` context.
 *
 * CRITICAL: a `{ ...msg }` spread loses the JsMsg prototype and private
 * fields, silently breaking `ack/nak`. This Proxy avoids that pitfall.
 */
export function withInflatedData(msg: JsMsg, newData: Uint8Array): JsMsg {
  return new Proxy(msg, {
    get(target, prop, receiver) {
      if (prop === "data") return newData;
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function") {
        return value.bind(target);
      }
      return value;
    },
  });
}

// ---------------------------------------------------------------------------
// Middleware helper: checks if the envelope is a valid claim-check
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the object is a compliant envelope with
 * `payload_inline === false` — i.e. a genuine claim-check message that
 * should be resolved.
 */
export function isClaimCheckEnvelope(
  value: unknown,
): value is EventEnvelope & { data: { payload_inline: false } } {
  return (
    isCompliantEnvelope(value) &&
    (value as EventEnvelope).data.payload_inline === false
  );
}
