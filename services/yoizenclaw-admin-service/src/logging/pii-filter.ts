export const PROHIBITED_FIELDS: ReadonlyArray<string> = [
  "password",
  "secret",
  "token",
  "api_key",
  "credential_value",
  "private_key",
  "value",
];

export const SENSITIVE_FIELDS: ReadonlyArray<string> = [
  "email",
  "phone",
  "ssn",
  "credit_card",
];

const REDACTED = "[REDACTED]";

function hasOwnProperty(
  obj: Record<string, unknown>,
  key: string,
): obj is Record<string, unknown> & { [k in typeof key]: unknown } {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function filterPii(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(obj)) {
    const lowerKey = key.toLowerCase();
    const isProhibited = PROHIBITED_FIELDS.some(
      (field) => lowerKey === field || lowerKey.endsWith(`_${field}`),
    );

    if (isProhibited) {
      result[key] = REDACTED;
      continue;
    }

    const value = obj[key];

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      result[key] = filterPii(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}

export function filterLogContext(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(obj)) {
    const lowerKey = key.toLowerCase();
    const isProhibited = PROHIBITED_FIELDS.some(
      (field) => lowerKey === field || lowerKey.endsWith(`_${field}`),
    );

    if (isProhibited) {
      result[key] = REDACTED;
      continue;
    }

    result[key] = obj[key];
  }

  return result;
}

export function safeStringify(obj: unknown): string {
  const seen = new WeakSet<object>();

  function serialize(value: unknown): unknown {
    if (value === null || typeof value !== "object") {
      if (typeof value === "bigint") {
        return String(value);
      }
      if (typeof value === "undefined") {
        return null;
      }
      return value;
    }

    if (typeof value === "function") {
      return "[Function]";
    }

    if (seen.has(value as object)) {
      return "[Circular]";
    }

    seen.add(value as object);

    if (Array.isArray(value)) {
      return value.map((item) => serialize(item));
    }

    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      result[key] = serialize(record[key]);
    }
    return result;
  }

  try {
    return JSON.stringify(serialize(obj));
  } catch {
    return '{"error":"[safeStringify failed]"}';
  }
}
