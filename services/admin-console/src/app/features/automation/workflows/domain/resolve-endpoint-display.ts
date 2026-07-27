export interface IEndpointCandidate {
  readonly id: string;
  readonly label: string;
  readonly method: string;
  readonly path: string;
}

export interface IEndpointSelectDisplay {
  readonly text: string;
  readonly unavailable: boolean;
}

/**
 * Resolves what the HTTP connector node's Endpoint select closed control
 * should show, independent of Angular Material's own option-matching (same
 * "never blank over real config" contract as resolveIdSelectDisplay, plus
 * one extra identity shape this select alone needs to handle).
 *
 * Two historical identity shapes exist on saved workflow actions, both
 * confirmed against live data (dev cluster, crm-support-telegram's
 * searchContact action):
 *  1. endpointId set — matched against the adapter's current endpoint list
 *     by id (the shape the picker writes going forward via
 *     onEndpointChange).
 *  2. endpointId ABSENT, method+url set directly on the action alongside
 *     adapterId — confirmed live: the persisted action args are exactly
 *     {adapterId, method, url}, with no endpointId field at all. This is
 *     the "stored identity differs (id vs method+path)" case, matched
 *     against the same endpoint list by (method, path) on a best-effort
 *     basis, falling back to the raw method+url when no endpoint shares
 *     that shape. Never marked unavailable in this branch: the
 *     configuration IS present, it is simply not identified by id.
 *
 * Returns null only when there is truly nothing configured (no endpointId
 * AND no method/url), the sole legitimate case for the placeholder.
 */
export function resolveEndpointDisplay(params: {
  readonly endpointId: unknown;
  readonly method: unknown;
  readonly url: unknown;
  readonly endpoints: readonly IEndpointCandidate[];
  readonly endpointsLoaded: boolean;
}): IEndpointSelectDisplay | null {
  const { endpointId, method, url, endpoints, endpointsLoaded } = params;

  const hasMethodUrl =
    typeof method === "string" &&
    method.trim().length > 0 &&
    typeof url === "string" &&
    url.trim().length > 0;
  const methodUrlText = hasMethodUrl ? [method, url].join(" ") : null;

  if (typeof endpointId === "string" && endpointId.trim().length > 0) {
    const match = endpoints.find((ep) => ep.id === endpointId);
    if (match) {
      return {
        text: [match.label, " (", match.method, " ", match.path, ")"].join(""),
        unavailable: false,
      };
    }
    return {
      text: methodUrlText ?? endpointId,
      unavailable: endpointsLoaded,
    };
  }

  if (!hasMethodUrl) {
    return null;
  }

  const matchByShape = endpoints.find(
    (ep) => ep.method === method && ep.path === url
  );
  if (matchByShape) {
    return {
      text: [
        matchByShape.label,
        " (",
        matchByShape.method,
        " ",
        matchByShape.path,
        ")",
      ].join(""),
      unavailable: false,
    };
  }
  return { text: methodUrlText as string, unavailable: false };
}
