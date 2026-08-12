import assert from "node:assert/strict";
import { test } from "node:test";
import { ConflictError, SdkError } from "../domain/errors.js";
import { CliError } from "./cli-error.js";
import { formatErrorDetail } from "./format-error-detail.js";

test("formatErrorDetail() renders apply_failed detail with the REAL unresolved_symbolic_ref message format (regression: apply used to swallow the server's error detail)", () => {
  // Fixture mirrors the true apply 409 body captured in the live repro:
  // `substitute-symbolic-refs.ts:230/285`'s message format, on the WORKFLOW
  // that references the missing connector — NOT the plan-only
  // `unresolvable_external_ref` precondition text (which never appears in
  // apply's 409 body — see `format-typed-error.ts`).
  const cause = new ConflictError("request failed: conflict", {
    details: {
      httpStatus: 409,
      body: {
        error: {
          kind: "apply_failed",
          manifestName: "http-fanout-telegram",
          applied: [
            { kind: "channel", name: "http-fanout-telegram", verdict: "noop" },
            { kind: "connector", name: "pokeapi", verdict: "noop" },
            {
              kind: "systemVariable",
              name: "http-fanout-telegram-chat-id",
              verdict: "noop",
            },
          ],
          pending: [],
          failure: {
            kind: "unresolved_symbolic_ref",
            resourceKind: "workflow",
            resourceName: "http-fanout-telegram",
            message:
              "workflow 'http-fanout-telegram' at definition.actions[0].catfacts[0].args.adapterId references unresolved connectorRef 'catfacts' — no real id available for it (never created/resolved, or a dependency-order gap)",
          },
          durationMs: 12,
        },
      },
    },
  });
  const cliError = new CliError(
    "manifests apply: apply request failed for 'http-fanout-telegram'",
    { cause }
  );

  const lines = formatErrorDetail(cliError);

  assert.match(lines.join("\n"), /unresolved_symbolic_ref/);
  assert.match(lines.join("\n"), /workflow\/http-fanout-telegram/);
  assert.match(
    lines.join("\n"),
    /references unresolved connectorRef 'catfacts'/
  );
  assert.match(lines.join("\n"), /applied=3 pending=0/);
  assert.match(lines.join("\n"), /manifests plan -f <file>/);
});

test("formatErrorDetail() renders a cycle_detected failure.kind body", () => {
  const cause = new ConflictError("request failed: conflict", {
    details: {
      httpStatus: 409,
      body: {
        error: {
          kind: "cycle_detected",
          cycle: ["connector:a", "agent:b", "connector:a"],
          message: "dependency cycle detected",
        },
      },
    },
  });
  const cliError = new CliError(
    "manifests apply: apply request failed for 'cyclic-manifest'",
    { cause }
  );

  const lines = formatErrorDetail(cliError);

  assert.match(
    lines.join("\n"),
    /cycle detected: connector:a -> agent:b -> connector:a/
  );
  assert.match(lines.join("\n"), /dependency cycle detected/);
});

test("formatErrorDetail() renders an undeploy_blocked 409 with EVERY dependent (manifest + resource pair), not just the message", () => {
  // Real shape of `UndeployBlockedError`
  // (`services/provisioning-service/src/modules/undeploy/domain/undeploy.interfaces.ts`),
  // decision 4's shared-resource guard.
  const cause = new ConflictError("request failed: conflict", {
    details: {
      httpStatus: 409,
      body: {
        error: {
          kind: "undeploy_blocked",
          manifestName: "telegram-transform-reply",
          dependents: [
            {
              manifestName: "http-fanout-telegram",
              resourceKind: "channel",
              resourceName: "telegram-transform-reply-bot",
            },
            {
              manifestName: "ai-agent-triage",
              resourceKind: "connector",
              resourceName: "openai",
            },
          ],
          message:
            "manifest 'telegram-transform-reply' cannot be undeployed: 2 resource(s) it owns are referenced as external by other stored manifests. Undeploy or edit those manifests first.",
        },
      },
    },
  });
  const cliError = new CliError(
    "manifests undeploy: undeploy request failed for 'telegram-transform-reply'",
    { cause }
  );

  const lines = formatErrorDetail(cliError).join("\n");

  assert.match(lines, /blocked by 2 dependent/);
  assert.match(
    lines,
    /http-fanout-telegram -> channel\/telegram-transform-reply-bot/
  );
  assert.match(lines, /ai-agent-triage -> connector\/openai/);
  assert.match(lines, /Undeploy or edit those manifests first/);
  assert.doesNotMatch(lines, /undefined/);
});

test("formatErrorDetail() renders an undeploy_failed 409 (partial run) with the failing step and the resume hint", () => {
  const cause = new ConflictError("request failed: conflict", {
    details: {
      httpStatus: 409,
      body: {
        error: {
          kind: "undeploy_failed",
          manifestName: "http-fanout-telegram",
          resources: [{ kind: "workflow", name: "fanout", action: "deleted" }],
          secrets: [],
          pending: [
            { kind: "channel", name: "http-in" },
            { kind: "connector", name: "pokeapi" },
          ],
          failure: {
            kind: "downstream_error",
            resourceKind: "channel",
            resourceName: "http-in",
            message: "channel-service returned 500 deleting account 'http-in'",
          },
          manifestRecordDeleted: false,
          durationMs: 9,
        },
      },
    },
  });
  const cliError = new CliError(
    "manifests undeploy: undeploy request failed for 'http-fanout-telegram'",
    { cause }
  );

  const lines = formatErrorDetail(cliError).join("\n");

  assert.match(lines, /downstream_error on channel\/http-in/);
  assert.match(lines, /channel-service returned 500/);
  assert.match(lines, /processed=1 pending=2/);
  assert.match(lines, /re-run .*undeploy.* to resume/);
  assert.doesNotMatch(lines, /undefined/);
});

test("formatErrorDetail() renders a PUT validation errors[] body", () => {
  const cause = new SdkError("request failed with status 400", {
    code: "HTTP",
    details: {
      httpStatus: 400,
      body: {
        valid: false,
        errors: [
          {
            path: "spec.channels",
            message: "at least one inbound channel is required",
          },
        ],
      },
    },
  });
  const cliError = new CliError(
    "manifests apply: failed to store manifest 'x'",
    { cause }
  );

  const lines = formatErrorDetail(cliError);

  assert.match(
    lines.join("\n"),
    /spec.channels: at least one inbound channel is required/
  );
});

test("formatErrorDetail() falls back to the raw body when the shape is unknown", () => {
  const cause = new SdkError("request failed with status 500", {
    code: "HTTP",
    details: { httpStatus: 500, body: { unexpected: "shape", n: 1 } },
  });
  const cliError = new CliError(
    "manifests apply: apply request failed for 'x'",
    {
      cause,
    }
  );

  const lines = formatErrorDetail(cliError);

  assert.match(lines.join("\n"), /"unexpected":"shape"/);
});

test("formatErrorDetail() returns no lines when the error carries no response body (e.g. a network error)", () => {
  const cliError = new CliError(
    "manifests apply: apply request failed for 'x'",
    {
      cause: new Error("fetch failed"),
    }
  );

  assert.deepEqual(formatErrorDetail(cliError), []);
});

test("formatErrorDetail() renders the RESPONSE message verbatim — the server is trusted, so text inside details.body IS surfaced (never sourced from the request/secret values)", () => {
  // Honest phrasing of the safety property: the formatter reads ONLY
  // `SdkError.details.body`, which `transport.ts` populates exclusively from
  // the RESPONSE — it never has access to the request body (where secrets
  // would live, if apply carried any; it does not — secrets go via
  // `PUT /secrets/:name`). Whatever the trusted provisioning-service puts in
  // its response message IS printed. To make that explicit, the fixture
  // plants a would-be-leak marker INSIDE the server message and asserts it
  // DOES appear — documenting that server-supplied text is surfaced, and
  // that the formatter's guarantee is "response-only", not "redacts".
  const cause = new ConflictError("request failed: conflict", {
    details: {
      httpStatus: 409,
      body: {
        error: {
          kind: "apply_failed",
          applied: [],
          pending: [],
          failure: {
            kind: "secret_not_resolvable",
            resourceKind: "connector",
            resourceName: "openai",
            message:
              'secret "openai-api-key" could not be resolved (server said: sk-test-LEAKME123)',
          },
        },
      },
    },
  });
  const cliError = new CliError(
    "manifests apply: apply request failed for 'x'",
    { cause }
  );

  const lines = formatErrorDetail(cliError).join("\n");

  assert.match(lines, /secret_not_resolvable/);
  // The marker lives in the RESPONSE message, so it IS rendered — proving the
  // formatter surfaces server text rather than swallowing it, and that the
  // only anti-leak guarantee is "reads response, never request".
  assert.match(lines, /sk-test-LEAKME123/);
});

test("formatErrorDetail() reads ONLY details.body — an error whose details lacks a body yields no lines even if other fields are populated", () => {
  // The structural anti-leak guarantee: no source other than `details.body`
  // is ever read, so a request-shaped payload hung off any other field (or a
  // missing body) can never be rendered.
  const cause = new ConflictError("request failed: conflict", {
    details: { httpStatus: 409, requestBody: { secret: "sk-never-read" } },
  });
  const cliError = new CliError(
    "manifests apply: apply request failed for 'x'",
    { cause }
  );

  assert.deepEqual(formatErrorDetail(cliError), []);
});
