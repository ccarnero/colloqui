// Route matcher for `GET /invocations/:invocationId` (the async invoke
// polling fallback, `manual-loops/connector-invoke-api.md` T05). Pure — no
// `Bun.serve`/`Request` types here so it's unit-testable without sockets;
// `src/http-main.ts` is the only I/O caller. Mirrors `match-invoke-route.ts`.

const GET_INVOCATION_ROUTE_PATTERN = /^\/invocations\/([^/]+)\/?$/;

export function matchGetInvocationRoute(pathname: string): string | null {
  const match = GET_INVOCATION_ROUTE_PATTERN.exec(pathname);
  if (!match) {
    return null;
  }
  return decodeURIComponent(match[1]!);
}
