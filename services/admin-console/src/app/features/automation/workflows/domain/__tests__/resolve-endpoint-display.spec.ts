import { resolveEndpointDisplay } from "../resolve-endpoint-display";

describe("resolveEndpointDisplay", () => {
  const endpoints = [
    {
      id: "ep-1",
      label: "Search contacts (filtered)",
      method: "POST",
      path: "/crm/v3/objects/contacts/search",
    },
  ];

  it("returns null when nothing is configured at all (the genuine empty state)", () => {
    expect(
      resolveEndpointDisplay({
        endpointId: "",
        method: "",
        url: "",
        endpoints,
        endpointsLoaded: true,
      })
    ).toBeNull();
  });

  it("matches by endpointId when present in the loaded list", () => {
    expect(
      resolveEndpointDisplay({
        endpointId: "ep-1",
        method: "POST",
        url: "/crm/v3/objects/contacts/search",
        endpoints,
        endpointsLoaded: true,
      })
    ).toEqual({
      text: "Search contacts (filtered) (POST /crm/v3/objects/contacts/search)",
      unavailable: false,
    });
  });

  it("marks an endpointId unavailable once loaded and still unmatched", () => {
    expect(
      resolveEndpointDisplay({
        endpointId: "ep-removed",
        method: "DELETE",
        url: "/old",
        endpoints,
        endpointsLoaded: true,
      })
    ).toEqual({ text: "DELETE /old", unavailable: true });
  });

  // Live-data regression (dev cluster, crm-support-telegram's
  // searchContact action): endpointId is absent entirely — only
  // {adapterId, method, url} are persisted. This is the confirmed real
  // root cause of the "Endpoint shows its placeholder" bug, distinct from
  // async loading or a stale id.
  it("matches by (method, path) when endpointId is absent but method+url are configured", () => {
    expect(
      resolveEndpointDisplay({
        endpointId: undefined,
        method: "POST",
        url: "/crm/v3/objects/contacts/search",
        endpoints,
        endpointsLoaded: true,
      })
    ).toEqual({
      text: "Search contacts (filtered) (POST /crm/v3/objects/contacts/search)",
      unavailable: false,
    });
  });

  it("falls back to the raw method+url (never unavailable) when no endpointId and no shape match exists", () => {
    expect(
      resolveEndpointDisplay({
        endpointId: "",
        method: "GET",
        url: "/unknown/path",
        endpoints,
        endpointsLoaded: true,
      })
    ).toEqual({ text: "GET /unknown/path", unavailable: false });
  });

  it("renders the raw method+url while options have not loaded yet, without the unavailable mark", () => {
    expect(
      resolveEndpointDisplay({
        endpointId: "ep-2",
        method: "POST",
        url: "/crm/v3/objects/contacts/search",
        endpoints: [],
        endpointsLoaded: false,
      })
    ).toEqual({
      text: "POST /crm/v3/objects/contacts/search",
      unavailable: false,
    });
  });
});
