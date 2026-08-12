import "../../setup-env";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { TENANT_HEADER } from "@yoizen/shared";
import { createChannelsDeleter } from "../../../src/modules/undeploy/infrastructure/channels-deleter";

function accountsResponse(
  accounts: readonly { id: string; name: string; externalId?: string }[]
): Response {
  return new Response(JSON.stringify(accounts), { status: 200 });
}

// FIXTURES MIRROR THE WRITER, NOT A GUESS: every "owned" account below is in
// a state `apply/infrastructure/channels-writer.ts:186` can actually produce
// — it POSTs `{ name: channel.name, externalId: `manifest:${channel.name}` }`,
// so a writer-created account ALWAYS satisfies
// `externalId === "manifest:" + name`. The manifest's own metadata.name never
// appears in the marker.
describe("createChannelsDeleter — apply-provenance marker", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("matches the account stamped externalId='manifest:<channel name>' by channels-writer", async () => {
    let calledUrl = "";
    let calledHeaders: HeadersInit | undefined;
    globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
      calledUrl = String(url);
      calledHeaders = init?.headers;
      return accountsResponse([
        { id: "acc-1", name: "tg-in", externalId: "manifest:tg-in" },
      ]);
    }) as unknown as typeof fetch;

    const result = await createChannelsDeleter(
      "http://channel-service.local"
    ).findOwnedId("acme", "tg-in", "demo");

    expect(calledUrl).toBe("http://channel-service.local/channels/accounts");
    expect((calledHeaders as Record<string, string>)[TENANT_HEADER]).toBe(
      "acme"
    );
    expect(result).toEqual({ ok: true, value: "acc-1" });
  });

  // REGRESSION PIN (reviewer B, 2026-08-12): the deleter first matched
  // `manifest:<MANIFEST metadata.name>`, which the writer never stamps. Every
  // manifest whose name differs from its channel's name — the normal case,
  // e.g. the crm demo — then found NOTHING: the run "succeeded", the stored
  // manifest and its checksums were dropped, and the channel account stayed
  // LIVE and orphaned while its secret binding was deleted underneath it.
  it("finds the account when the MANIFEST name differs from the channel name (crm demo shape)", async () => {
    globalThis.fetch = mock(async () =>
      accountsResponse([
        {
          id: "acc-crm",
          name: "crm-support-telegram-bot",
          externalId: "manifest:crm-support-telegram-bot",
        },
      ])
    ) as unknown as typeof fetch;

    const result = await createChannelsDeleter(
      "http://channel-service.local"
    ).findOwnedId(
      "acme",
      "crm-support-telegram-bot",
      // manifest metadata.name — deliberately NOT the channel's name
      "crm-support-telegram"
    );

    expect(result).toEqual({ ok: true, value: "acc-crm" });
  });

  it("REFUSES a same-named account whose marker names a DIFFERENT resource", async () => {
    globalThis.fetch = mock(async () =>
      accountsResponse([
        { id: "acc-9", name: "tg-in", externalId: "manifest:other-channel" },
      ])
    ) as unknown as typeof fetch;

    const result = await createChannelsDeleter(
      "http://channel-service.local"
    ).findOwnedId("acme", "tg-in", "demo");

    expect(result).toEqual({ ok: true, value: null });
  });

  it("REFUSES to delete a same-named account with no marker at all (adopted, not created)", async () => {
    globalThis.fetch = mock(async () =>
      accountsResponse([{ id: "acc-7", name: "tg-in" }])
    ) as unknown as typeof fetch;

    const result = await createChannelsDeleter(
      "http://channel-service.local"
    ).findOwnedId("acme", "tg-in", "demo");

    expect(result).toEqual({ ok: true, value: null });
  });

  it("picks the apply-created account when several share the name", async () => {
    globalThis.fetch = mock(async () =>
      accountsResponse([
        { id: "acc-1", name: "tg-in", externalId: "imported-by-hand" },
        { id: "acc-2", name: "tg-in", externalId: "manifest:tg-in" },
        { id: "acc-3", name: "unrelated", externalId: "manifest:unrelated" },
      ])
    ) as unknown as typeof fetch;

    const result = await createChannelsDeleter(
      "http://channel-service.local"
    ).findOwnedId("acme", "tg-in", "demo");

    expect(result).toEqual({ ok: true, value: "acc-2" });
  });

  it("returns null when no account carries the name at all", async () => {
    globalThis.fetch = mock(async () =>
      accountsResponse([])
    ) as unknown as typeof fetch;

    const result = await createChannelsDeleter(
      "http://channel-service.local"
    ).findOwnedId("acme", "tg-in", "demo");

    expect(result).toEqual({ ok: true, value: null });
  });

  it("surfaces a failing list as lookup_failed instead of deleting blindly", async () => {
    globalThis.fetch = mock(
      async () => new Response("boom", { status: 500 })
    ) as unknown as typeof fetch;

    const result = await createChannelsDeleter(
      "http://channel-service.local"
    ).findOwnedId("acme", "tg-in", "demo");

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toMatchObject({
      kind: "lookup_failed",
      resourceKind: "channel",
      resourceName: "tg-in",
    });
  });

  it("deletes by the account id through channel-service's DELETE route", async () => {
    let calledUrl = "";
    let calledMethod = "";
    globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
      calledUrl = String(url);
      calledMethod = String(init?.method);
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const result = await createChannelsDeleter(
      "http://channel-service.local"
    ).deleteById("acme", "acc-1", "tg-in");

    expect(calledMethod).toBe("DELETE");
    expect(calledUrl).toBe(
      "http://channel-service.local/channels/accounts/acc-1"
    );
    expect(result).toEqual({ ok: true, value: { deleted: true } });
  });
});
