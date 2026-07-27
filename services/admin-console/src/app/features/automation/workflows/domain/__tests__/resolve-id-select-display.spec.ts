import { resolveIdSelectDisplay } from "../resolve-id-select-display";

describe("resolveIdSelectDisplay", () => {
  const options = [
    {
      id: "ep-1",
      label: "Search contacts (POST /crm/v3/objects/contacts/search)",
    },
  ];

  it("returns null when no value is configured (the genuine empty state — placeholder is correct here)", () => {
    expect(
      resolveIdSelectDisplay({ value: "", options, optionsLoaded: true })
    ).toBeNull();
    expect(
      resolveIdSelectDisplay({ value: undefined, options, optionsLoaded: true })
    ).toBeNull();
  });

  it("renders the matched option's label when the value is found in a loaded list", () => {
    expect(
      resolveIdSelectDisplay({ value: "ep-1", options, optionsLoaded: true })
    ).toEqual({
      text: "Search contacts (POST /crm/v3/objects/contacts/search)",
      unavailable: false,
    });
  });

  it("renders the stored value (via fallbackText) WITHOUT the unavailable mark while options have not finished loading yet", () => {
    expect(
      resolveIdSelectDisplay({
        value: "ep-2",
        options: [],
        optionsLoaded: false,
        fallbackText: "POST /crm/v3/objects/contacts/search",
      })
    ).toEqual({
      text: "POST /crm/v3/objects/contacts/search",
      unavailable: false,
    });
  });

  it("marks the value unavailable once options HAVE loaded and still do not contain it (stale/removed reference)", () => {
    expect(
      resolveIdSelectDisplay({
        value: "ep-stale",
        options,
        optionsLoaded: true,
        fallbackText: "POST /crm/v3/objects/contacts/search",
      })
    ).toEqual({
      text: "POST /crm/v3/objects/contacts/search",
      unavailable: true,
    });
  });

  it("falls back to the raw id when no fallbackText is supplied for a stale reference", () => {
    expect(
      resolveIdSelectDisplay({
        value: "svc-stale",
        options: [],
        optionsLoaded: true,
      })
    ).toEqual({ text: "svc-stale", unavailable: true });
  });
});
