import { Injectable, Logger } from "@nestjs/common";

/**
 * Merges tool execution results back into the runtime state.
 *
 * After each tool execution, subsequent tools and LLM calls need to see
 * the result. This service serializes the result and merges it into the
 * shared state dictionary, with a special guard for the "message" key:
 * a string message is never overwritten by a non-string value.
 *
 * Port of Python ToolExecutor._merge_state / _serialize.
 */
@Injectable()
export class StateMergerService {
  private readonly logger = new Logger(StateMergerService.name);

  /**
   * Merge a tool result into the mutable state dictionary.
   *
   * If the serialized result is a plain object, each entry is merged
   * individually. Non-object results are ignored (the state is unchanged).
   *
   * Special case: when the key is `"message"` and the existing value is a
   * string but the new value is not, the entry is **skipped** — preserving
   * a human-readable message that a previous tool step set.
   */
  mergeState(state: Record<string, unknown>, result: unknown): void {
    const serialized = this.serialize(result);

    if (!isPlainObject(serialized)) return;

    for (const [key, value] of Object.entries(serialized)) {
      const existing = state[key];

      if (key === "message" && typeof existing === "string" && typeof value !== "string") {
        this.logger.debug(
          `Skipping merge of key "message": existing is string but new value is ${typeof value}`,
        );
        continue;
      }

      state[key] = value;
    }
  }

  /**
   * Serialize a value into a mergeable form.
   *
   * - Objects with a `toJSON()` method are resolved via that method.
   * - Plain objects and all other primitives are returned as-is.
   */
  private serialize(value: unknown): unknown {
    if (
      value !== null &&
      typeof value === "object" &&
      typeof (value as { toJSON?: unknown }).toJSON === "function"
    ) {
      return (value as { toJSON: () => unknown }).toJSON();
    }

    return value;
  }
}

/**
 * Check whether a value is a plain, non-null object (not an array, Date, etc.).
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;

  // Arrays are not plain objects for merging purposes
  if (Array.isArray(value)) return false;

  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}
