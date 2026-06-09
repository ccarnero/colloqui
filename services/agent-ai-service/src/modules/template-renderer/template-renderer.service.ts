import { Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";

/**
 * State object passed to template rendering methods.
 * Keys are namespace names (agent, context, input, memory, skill, etc.)
 * and values can be nested objects for dot-path traversal.
 */
export type TemplateState = Record<string, unknown>;

/**
 * Sentinel values used internally to distinguish "not found" from
 * a legitimate `null` or `undefined` in the state tree.
 */
const MISSING = Symbol("missing");
const INVALID_NAMESPACE = Symbol("invalid_namespace");

const PROMPT_PLACEHOLDER_RE = /\{\{\s*([^{}]+)\s*\}\}/g;
const SINGLE_BRACE_RE = /\{([^{}]+)\}/g;
const TOOL_EXACT_RE = /^\{\{\s*([^{}]+)\s*\}\}$/;

const PROMPT_ALLOWED_NAMESPACES = new Set([
  "agent",
  "context",
  "input",
  "memory",
  "skill",
  "variables",
]);

@Injectable()
export class TemplateRendererService {
  private readonly logger = new PinoLoggerService(
    TemplateRendererService.name,
  );

  // ── Public API ────────────────────────────────────────────────────

  /**
   * Render `{{namespace.key.nested}}` placeholders in authored prompts.
   * Only whitelisted namespaces are allowed (agent, context, input, memory, skill).
   * Unresolvable references are kept as-is and optionally collected as warnings.
   */
  renderPromptText(
    template: string,
    state: TemplateState,
    warnings?: string[],
  ): string {
    return template.replace(PROMPT_PLACEHOLDER_RE, (match, expr: string) => {
      const expression = expr.trim();
      const value = this.lookupPromptStateValue(expression, state);

      if (value === MISSING) {
        warnings?.push(
          `Prompt reference '{{${expression}}}' could not be resolved.`,
        );
        return match;
      }

      if (value === INVALID_NAMESPACE) {
        warnings?.push(
          `Prompt reference '{{${expression}}}' uses an unsupported namespace.`,
        );
        return match;
      }

      return typeof value === "string" ? value : String(value);
    });
  }

  /**
   * Render `{{key}}` placeholders in tool configs.
   * When the entire string IS a single placeholder, returns the raw value
   * (preserving objects, arrays, numbers, etc.). Otherwise stringifies.
   */
  renderToolTemplate(
    template: unknown,
    state: TemplateState,
  ): unknown {
    if (template === null || template === undefined) {
      return null;
    }

    if (typeof template === "string") {
      return this.renderToolTemplateString(template, state);
    }

    if (Array.isArray(template)) {
      return template.map((item) => this.renderToolTemplate(item, state));
    }

    if (typeof template === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(template)) {
        result[key] = this.renderToolTemplate(value, state);
      }
      return result;
    }

    return template;
  }

  /**
   * Render tool headers, normalizing the result to `Record<string, string>`.
   * Returns `null` when headers are empty or not a dict.
   */
  renderToolHeaders(
    headers: unknown,
    state: TemplateState,
  ): Record<string, string> | null {
    const rendered = this.renderToolTemplate(headers, state);

    if (typeof rendered !== "object" || rendered === null || Array.isArray(rendered)) {
      return null;
    }

    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(rendered as Record<string, unknown>)) {
      if (value === null || value === undefined) {
        continue;
      }
      normalized[String(key)] = String(value);
    }

    return Object.keys(normalized).length > 0 ? normalized : null;
  }

  /**
   * Recursively render `{path.to.key}` single-brace placeholders in
   * strings, arrays, and dicts. Preserves non-string leaf types.
   */
  renderValue(value: unknown, state: TemplateState): unknown {
    if (typeof value === "string") {
      return value.replace(SINGLE_BRACE_RE, (_match, expr: string) =>
        this.stringifyStateValue(expr, state),
      );
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.renderValue(item, state));
    }

    if (value !== null && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        result[k] = this.renderValue(v, state);
      }
      return result;
    }

    return value;
  }

  // ── Private helpers ───────────────────────────────────────────────

  private renderToolTemplateString(
    template: string,
    state: TemplateState,
  ): unknown {
    // If the entire string is a single {{key}}, return the raw value (preserving type).
    const exactMatch = TOOL_EXACT_RE.exec(template);
    if (exactMatch) {
      return this.lookupStateValue(exactMatch[1].trim(), state);
    }

    // Otherwise, replace all placeholders with their stringified values.
    return template.replace(PROMPT_PLACEHOLDER_RE, (_match, expr: string) =>
      this.stringifyStateValue(expr, state),
    );
  }

  private stringifyStateValue(
    expression: string,
    state: TemplateState,
  ): string {
    const value = this.lookupStateValue(expression.trim(), state);
    if (value === null || value === undefined) {
      return "";
    }
    return typeof value === "string" ? value : String(value);
  }

  /**
   * Dot-path traversal: `"a.b.c"` → `state["a"]["b"]["c"]`.
   * Returns `null` when any intermediate segment is not traversable.
   */
  private lookupStateValue(
    expression: string,
    state: TemplateState,
  ): unknown {
    const parts = expression.split(".");
    let current: unknown = state;

    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== "object" || Array.isArray(current)) {
        return null;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  /**
   * Like lookupStateValue but gated by allowed namespaces for prompts.
   * Returns sentinel symbols so the caller can distinguish "missing" from
   * "disallowed namespace" and produce appropriate warnings.
   */
  private lookupPromptStateValue(
    expression: string,
    state: TemplateState,
  ): unknown | typeof MISSING | typeof INVALID_NAMESPACE {
    const parts = expression.split(".").filter((p) => p.length > 0);
    if (parts.length === 0) {
      return MISSING;
    }

    const namespace = parts[0];
    if (!PROMPT_ALLOWED_NAMESPACES.has(namespace)) {
      return INVALID_NAMESPACE;
    }

    let current: unknown = state[namespace];
    for (const part of parts.slice(1)) {
      if (current === null || current === undefined || typeof current !== "object" || Array.isArray(current)) {
        return MISSING;
      }
      current = (current as Record<string, unknown>)[part];
    }

    if (current === undefined) {
      return MISSING;
    }

    return current;
  }
}
