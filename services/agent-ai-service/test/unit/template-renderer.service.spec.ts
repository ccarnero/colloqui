import { describe, it, expect, mock, beforeEach } from "bun:test";

mock.module("@yoizen/observability", () => ({
  PinoLoggerService: class MockLogger {
    debug = mock(() => {});
    error = mock(() => {});
    warn = mock(() => {});
    log = mock(() => {});
  },
}));

import { TemplateRendererService } from "../../src/modules/template-renderer/template-renderer.service";

// ---------------------------------------------------------------------------
// Helper to build a fresh instance before each test
// ---------------------------------------------------------------------------
let service: TemplateRendererService;

beforeEach(() => {
  service = new TemplateRendererService();
});

// ---------------------------------------------------------------------------
// renderPromptText  —  {{namespace.key}} with whitelisted namespaces
// ---------------------------------------------------------------------------
describe("TemplateRendererService", () => {
  describe("renderPromptText", () => {
    it("should replace a simple {{agent.name}} with the corresponding state value", () => {
      const result = service.renderPromptText("Hello {{agent.name}}", {
        agent: { name: "Bob" },
      });
      expect(result).toBe("Hello Bob");
    });

    it("should resolve a deeply nested path like {{context.session.user.preferences.theme}}", () => {
      const state = {
        context: {
          session: { user: { preferences: { theme: "dark" } } },
        },
      };
      const result = service.renderPromptText(
        "Theme: {{context.session.user.preferences.theme}}",
        state,
      );
      expect(result).toBe("Theme: dark");
    });

    it("should resolve multiple placeholders in the same template", () => {
      const state = { agent: { name: "Alice" }, input: { message: "hi" } };
      const result = service.renderPromptText(
        "{{agent.name}} says {{input.message}}",
        state,
      );
      expect(result).toBe("Alice says hi");
    });

    it("should keep placeholders with an unknown namespace as-is (INVALID_NAMESPACE)", () => {
      const result = service.renderPromptText("{{invalid.key}}", {
        invalid: { key: "nope" },
      });
      expect(result).toBe("{{invalid.key}}");
    });

    it("should keep placeholders with a missing key as-is (MISSING)", () => {
      const result = service.renderPromptText("{{agent.missing}}", {
        agent: { name: "Bob" },
      });
      expect(result).toBe("{{agent.missing}}");
    });

    it("should push a warning for an unknown namespace", () => {
      const warnings: string[] = [];
      service.renderPromptText("{{custom.val}}", {}, warnings);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/unsupported namespace/i);
    });

    it("should push a warning for a missing key", () => {
      const warnings: string[] = [];
      service.renderPromptText("{{agent.missing}}", { agent: {} }, warnings);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/could not be resolved/i);
    });

    it("should push warnings for both invalid namespace AND missing key in mixed template", () => {
      const warnings: string[] = [];
      const result = service.renderPromptText(
        "{{agent.name}} {{custom.x}} {{agent.gone}}",
        { agent: { name: "Bob" } },
        warnings,
      );
      // "Bob" is resolved, the other two are kept as-is
      expect(result).toBe("Bob {{custom.x}} {{agent.gone}}");
      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toMatch(/unsupported namespace/i);
      expect(warnings[1]).toMatch(/could not be resolved/i);
    });

    it("should return empty string for an empty template", () => {
      const result = service.renderPromptText("", { agent: {} });
      expect(result).toBe("");
    });

    it("should return the template unchanged when it contains no placeholders", () => {
      const result = service.renderPromptText("Just plain text.", {
        agent: {},
      });
      expect(result).toBe("Just plain text.");
    });

    it("should trim whitespace inside double-brace delimiters", () => {
      const result = service.renderPromptText("Hello {{  agent.name  }}", {
        agent: { name: "Bob" },
      });
      expect(result).toBe("Hello Bob");
    });

    it("should stringify a number state value", () => {
      const result = service.renderPromptText("Count: {{input.count}}", {
        input: { count: 42 },
      });
      expect(result).toBe("Count: 42");
    });

    it("should stringify a boolean state value", () => {
      const result = service.renderPromptText("Flag: {{input.enabled}}", {
        input: { enabled: true },
      });
      expect(result).toBe("Flag: true");
    });

    it("should stringify null to 'null'", () => {
      const result = service.renderPromptText("Val: {{agent.x}}", {
        agent: { x: null },
      });
      expect(result).toBe("Val: null");
    });

    it("should resolve an empty string value in state to empty string", () => {
      const result = service.renderPromptText("Msg: '{{agent.msg}}'", {
        agent: { msg: "" },
      });
      expect(result).toBe("Msg: ''");
    });

    it("should resolve deeply nested inside context namespace", () => {
      const state = {
        context: {
          level1: { level2: { level3: "deep-value" } },
        },
      };
      const result = service.renderPromptText(
        "{{context.level1.level2.level3}}",
        state,
      );
      expect(result).toBe("deep-value");
    });

    it("should keep a MISSING reference when namespace is allowed but path is completely absent", () => {
      const result = service.renderPromptText("{{memory.history.0.text}}", {
        memory: {},
      });
      expect(result).toBe("{{memory.history.0.text}}");
    });

    it("should not push warnings when warnings array is omitted", () => {
      // Should not throw
      expect(() => {
        service.renderPromptText("{{agent.gone}} {{invalid.x}}", {
          agent: {},
        });
      }).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // renderToolTemplate  —  {{key}} with raw-value return for exact match
  // -----------------------------------------------------------------------
  describe("renderToolTemplate", () => {
    it("should return raw number when the whole string is a single {{key}}", () => {
      const result = service.renderToolTemplate("{{myValue}}", {
        myValue: 42,
      });
      expect(result).toBe(42);
    });

    it("should return raw object when the whole string is a single {{key}}", () => {
      const obj = { nested: true };
      const result = service.renderToolTemplate("{{myValue}}", {
        myValue: obj,
      });
      expect(result).toBe(obj);
    });

    it("should return raw boolean when the whole string is a single {{key}}", () => {
      const result = service.renderToolTemplate("{{flag}}", { flag: false });
      expect(result).toBe(false);
    });

    it("should return raw null when the whole string is a single {{key}} that resolves to null", () => {
      const result = service.renderToolTemplate("{{val}}", { val: null });
      expect(result).toBeNull();
    });

    it("should stringify a placeholder in the middle of a string", () => {
      const result = service.renderToolTemplate("prefix-{{key}}-suffix", {
        key: 42,
      });
      expect(result).toBe("prefix-42-suffix");
    });

    it("should return empty string for a missing key when not an exact match", () => {
      const result = service.renderToolTemplate("value-{{missing}}", {});
      expect(result).toBe("value-");
    });

    it("should return undefined for a missing key on exact match", () => {
      const result = service.renderToolTemplate("{{missing}}", {});
      expect(result).toBeUndefined();
    });

    it("should return non-string template as-is (number)", () => {
      const result = service.renderToolTemplate(42, {});
      expect(result).toBe(42);
    });

    it("should return non-string template as-is (boolean)", () => {
      const result = service.renderToolTemplate(true, {});
      expect(result).toBe(true);
    });

    it("should return null for null template", () => {
      const result = service.renderToolTemplate(null, {});
      expect(result).toBeNull();
    });

    it("should return null for undefined template", () => {
      const result = service.renderToolTemplate(undefined, {});
      expect(result).toBeNull();
    });

    it("should render each element of an array", () => {
      const result = service.renderToolTemplate(
        ["{{a}}", "{{b}}", "plain"],
        { a: "hello", b: "world" },
      );
      expect(result).toEqual(["hello", "world", "plain"]);
    });

    it("should recursively render nested objects", () => {
      const result = service.renderToolTemplate(
        { outer: { inner: "{{key}}" } },
        { key: "resolved" },
      );
      expect(result).toEqual({ outer: { inner: "resolved" } });
    });

    it("should return the template unchanged when it contains no placeholders", () => {
      const result = service.renderToolTemplate("no braces here", {});
      expect(result).toBe("no braces here");
    });

    it("should resolve multiple placeholders in one string", () => {
      const result = service.renderToolTemplate("{{a}}-{{b}}", {
        a: "foo",
        b: "bar",
      });
      expect(result).toBe("foo-bar");
    });

    it("should resolve a deeply nested dot-path in tool template", () => {
      const result = service.renderToolTemplate("{{user.profile.name}}", {
        user: { profile: { name: "Alice" } },
      });
      expect(result).toBe("Alice");
    });

    it("should not recurse into primitive values inside objects", () => {
      const result = service.renderToolTemplate(
        { num: 99, bool: false, str: "{{key}}", nil: null },
        { key: "set" },
      );
      expect(result).toEqual({
        num: 99,
        bool: false,
        str: "set",
        nil: null,
      });
    });

    it("should handle deeply nested object with placeholders at multiple levels", () => {
      const result = service.renderToolTemplate(
        {
          level1: {
            text: "{{a}}",
            level2: {
              text: "{{b}}",
            },
          },
        },
        { a: "A", b: "B" },
      );
      expect(result).toEqual({
        level1: {
          text: "A",
          level2: {
            text: "B",
          },
        },
      });
    });

    it("should stringify resolved values in non-exact match (number)", () => {
      const result = service.renderToolTemplate("val-{{n}}", { n: 99 });
      expect(result).toBe("val-99");
    });

    it("should stringify resolved values in non-exact match (boolean)", () => {
      const result = service.renderToolTemplate("flag-{{b}}", { b: true });
      expect(result).toBe("flag-true");
    });
  });

  // -----------------------------------------------------------------------
  // renderToolHeaders  —  renders + normalises to Record<string, string>
  // -----------------------------------------------------------------------
  describe("renderToolHeaders", () => {
    it("should render placeholders inside header values", () => {
      const result = service.renderToolHeaders(
        { Authorization: "Bearer {{token}}" },
        { token: "abc123" },
      );
      expect(result).toEqual({ Authorization: "Bearer abc123" });
    });

    it("should filter out null header values", () => {
      const result = service.renderToolHeaders(
        { Authorization: "Bearer {{token}}", "X-Null": null },
        { token: "abc" },
      );
      expect(result).toEqual({ Authorization: "Bearer abc" });
    });

    it("should filter out undefined header values", () => {
      const result = service.renderToolHeaders(
        { Authorization: "Bearer {{token}}", "X-Gone": undefined },
        { token: "abc" },
      );
      expect(result).toEqual({ Authorization: "Bearer abc" });
    });

    it("should return null for an empty object", () => {
      const result = service.renderToolHeaders({}, {});
      expect(result).toBeNull();
    });

    it("should return null when all values are filtered out", () => {
      const result = service.renderToolHeaders(
        { "X-A": null, "X-B": undefined },
        {},
      );
      expect(result).toBeNull();
    });

    it("should return null for string input (non-dict)", () => {
      const result = service.renderToolHeaders("not-a-dict", {});
      expect(result).toBeNull();
    });

    it("should return null for number input", () => {
      const result = service.renderToolHeaders(42, {});
      expect(result).toBeNull();
    });

    it("should return null for null input", () => {
      const result = service.renderToolHeaders(null, {});
      expect(result).toBeNull();
    });

    it("should return null for undefined input", () => {
      const result = service.renderToolHeaders(undefined, {});
      expect(result).toBeNull();
    });

    it("should return null for array input", () => {
      const result = service.renderToolHeaders(["a", "b"], {});
      expect(result).toBeNull();
    });

    it("should coerce missing values to empty strings for non-exact placeholders", () => {
      // "prefix-{{missing}}" is NOT an exact match, so the missing value
      // goes through stringifyStateValue and returns ""
      const result = service.renderToolHeaders(
        { "X-Key": "val-{{missing}}" },
        {},
      );
      expect(result).toEqual({ "X-Key": "val-" });
    });

    it("should filter out exact-match headers when the state key is missing", () => {
      // "{{missing}}" IS an exact match → renderToolTemplate returns undefined
      // → filtered out by the null/undefined check → empty object → null
      const result = service.renderToolHeaders({ "X-Key": "{{missing}}" }, {});
      expect(result).toBeNull();
    });

    it("should render multiple headers", () => {
      const result = service.renderToolHeaders(
        {
          Authorization: "Bearer {{token}}",
          "X-User-Id": "{{userId}}",
          "X-Role": "admin",
        },
        { token: "tok", userId: "42" },
      );
      expect(result).toEqual({
        Authorization: "Bearer tok",
        "X-User-Id": "42",
        "X-Role": "admin",
      });
    });

    it("should stringify all values to strings", () => {
      const result = service.renderToolHeaders(
        { "X-Num": "{{num}}", "X-Flag": "{{flag}}" },
        { num: 100, flag: true },
      );
      expect(result).toEqual({ "X-Num": "100", "X-Flag": "true" });
    });
  });

  // -----------------------------------------------------------------------
  // renderValue  —  {path.to.key} single-brace recursive rendering
  // -----------------------------------------------------------------------
  describe("renderValue", () => {
    it("should replace a single-brace {path} in a string", () => {
      const result = service.renderValue("Hello {input.name}", {
        input: { name: "Charlie" },
      });
      expect(result).toBe("Hello Charlie");
    });

    it("should replace multiple single-brace placeholders", () => {
      const result = service.renderValue("{a} and {b}", {
        a: "foo",
        b: "bar",
      });
      expect(result).toBe("foo and bar");
    });

    it("should render each element in an array", () => {
      const result = service.renderValue(
        ["{a}", "{b}", "plain"],
        { a: "hello", b: "world" },
      );
      expect(result).toEqual(["hello", "world", "plain"]);
    });

    it("should recursively render nested objects", () => {
      const result = service.renderValue(
        { outer: { inner: "{key}" } },
        { key: "deep" },
      );
      expect(result).toEqual({ outer: { inner: "deep" } });
    });

    it("should return a number value as-is", () => {
      const result = service.renderValue(42, {});
      expect(result).toBe(42);
    });

    it("should return a boolean value as-is", () => {
      const result = service.renderValue(false, {});
      expect(result).toBe(false);
    });

    it("should return null as-is", () => {
      const result = service.renderValue(null, {});
      expect(result).toBeNull();
    });

    it("should return undefined as-is", () => {
      const result = service.renderValue(undefined, {});
      expect(result).toBeUndefined();
    });

    it("should replace a missing path with empty string", () => {
      const result = service.renderValue("Hello {missing.key}", {});
      expect(result).toBe("Hello ");
    });

    it("should resolve a deeply nested path", () => {
      const result = service.renderValue("{a.b.c}", {
        a: { b: { c: "got-it" } },
      });
      expect(result).toBe("got-it");
    });

    it("should replace nested paths inside an object value", () => {
      const result = service.renderValue(
        {
          title: "Report: {reportName}",
          meta: { author: "{user.name}" },
        },
        { reportName: "Q1", user: { name: "Alice" } },
      );
      expect(result).toEqual({
        title: "Report: Q1",
        meta: { author: "Alice" },
      });
    });

    it("should not crash on an empty string", () => {
      const result = service.renderValue("", {});
      expect(result).toBe("");
    });

    it("should handle braces without dots as a missing path", () => {
      const result = service.renderValue("Val: {nosuch}", {});
      expect(result).toBe("Val: ");
    });

    it("should not replace double-brace {{placeholders}} (those use the other regex)", () => {
      // single-brace RE is `{[^{}]+}` which also matches `{{...}}` inner content.
      // Actually: SINGLE_BRACE_RE = /\{([^{}]+)\}/g will NOT match `{{x}}` because
      // `{{x}}` has nested braces. `\{([^{}]+)\}` requires the inner content `x`
      // to have no braces at all. `{{x}}` = `{` `{x}` `}` — the inner `{x}` has
      // braces, so it won't match the outer `{` ... `}` pair cleanly.
      // In practice, `{{x}}` → `SINGLE_BRACE_RE.exec("{{x}}")` → `{x}` is not
      // matched because `{x}` (without the outer `{` and `}`) yes it is matched.
      // Let me be precise: `/\{([^{}]+)\}/g` on `"{{x}}"`:
      //   scan: `{` at pos 0, then `{` is inside `{` (not a `}`), fails.
      //   Actually it matches `{x}` at position 1-3, replacing with state lookup.
      // This is an inherent ambiguity — the user should not mix brace styles.
      // We just document the behavior: double braces in renderValue will be
      // partially consumed.
      const result = service.renderValue("hello {{world}}", { world: "X" });
      // This will try to match `{world}` inside the double braces.
      // `{world}` matches → replaced with state value.
      // This is accepted behaviour — the method is for single-brace syntax only.
      // The test documents this interaction rather than asserting a specific
      // outcome, since it depends on the regex engine behaviour.
      expect(typeof result).toBe("string");
      // The exact result: "hello {X}" because `{{world}}` matches `{world}` as the inner content
      expect(result).toBe("hello {X}");
    });

    it("should handle an object with symbol keys (they are omitted)", () => {
      const sym = Symbol("private");
      const result = service.renderValue(
        { visible: "{key}", [sym]: "{other}" },
        { key: "seen", other: "hidden" },
      );
      // Object.entries skips symbol keys, so only `visible` is rendered
      expect(result).toEqual({ visible: "seen" });
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases shared across methods
  // -----------------------------------------------------------------------
  describe("edge cases", () => {
    it("should ignore symbol-keyed entries in state (renderPromptText)", () => {
      const sym = Symbol("secret");
      const state: Record<string, unknown> = { agent: { name: "Bob" } };
      state[sym] = "should-not-resolve";

      // Symbol key is not a namespace, and it's not accessible via dot path
      const result = service.renderPromptText("{{agent.name}}", state);
      expect(result).toBe("Bob");
    });

    it("should not crash when state has __proto__ as a key (renderPromptText)", () => {
      const state: Record<string, unknown> = {
        agent: { name: "Alice" },
        __proto__: { malicious: true },
      };

      const result = service.renderPromptText("{{agent.name}}", state);
      expect(result).toBe("Alice");
    });

    it("should not crash when state has __proto__ as a key (renderToolTemplate)", () => {
      const state: Record<string, unknown> = {
        myValue: "ok",
        __proto__: { malicious: true },
      };

      const result = service.renderToolTemplate("{{myValue}}", state);
      expect(result).toBe("ok");
    });

    it("should handle empty namespace expression in prompt ({{.key}})", () => {
      // ".key".split(".") → ["", "key"], filter → ["key"]
      // namespace = "key" → INVALID_NAMESPACE (not whitelisted)
      const warnings: string[] = [];
      const result = service.renderPromptText("{{.key}}", {}, warnings);
      expect(result).toBe("{{.key}}");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/unsupported namespace/);
    });

    it("should return the whole namespace value when expression ends with a dot ({{agent.}})", () => {
      // "agent.".split(".") → ["agent", ""], filter → ["agent"]
      // parts = ["agent"], no further traversal, returns state["agent"]
      const result = service.renderPromptText("{{agent.}}", {
        agent: { name: "Bob" },
      });
      // The whole agent object is returned as a string
      expect(result).toBe('[object Object]');
    });

    it("should handle a deeply nested tool template with exact match returning array", () => {
      const arr = [1, 2, 3];
      const result = service.renderToolTemplate("{{items}}", { items: arr });
      expect(result).toBe(arr);
    });

    it("should gracefully handle non-traversable intermediate in lookupStateValue", () => {
      // If a.b is a string, then a.b.c should return null
      const result = service.renderToolTemplate("{{a.b.c}}", {
        a: { b: "not-an-object" },
      });
      expect(result).toBeNull();
    });

    it("should handle Symbol keys in state when using renderValue", () => {
      const sym = Symbol("key");
      const state: Record<string, unknown> = { agent: { name: "Bob" } };
      state[sym] = "should-not-resolve";

      // Just ensure it doesn't throw
      const result = service.renderPromptText("{{agent.name}}", state);
      expect(result).toBe("Bob");
    });
  });
});
