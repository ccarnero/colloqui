# `@yoizen/angular-shared`

Class: descriptive
Summary: The shared Angular auth layer for the consoles: JWT session state, HTTP interceptors, the route guard and the one-call bootstrap provider.

The shared auth layer for Yoizen's Angular consoles: JWT session state, HTTP
interceptors, a route guard, and a one-call bootstrap provider. A console app
supplies its own storage keys and API origin; everything else — token decoding,
expiry, tenant resolution, permission checks — lives here.

Unlike the other workspace packages, this one **is compiled**: `main`/`types`
point at `dist/` (`package.json:5-11`), so consumers need `bun run build`
before type resolution works.

Angular 21 and RxJS 7 are **peer** dependencies (`package.json:16-21`).

## Build

```bash
cd packages/angular-shared
bun run build            # node ./scripts/build-lib.mjs  (package.json:14)
```

Because Angular is a peer dependency, this package has no Angular in its own
`node_modules`. The build script symlinks the consumer's Angular packages in
and then runs `tsc` (`scripts/build-lib.mjs:12-18`). It guarantees three
properties, stated in its own header (`:20-27`): idempotent (re-running
replaces stale or broken links), path-portable (symlink targets are RELATIVE,
so `node_modules` survives being copied between hosts/containers/sandboxes),
and verbose (every action logged with a `[build-lib]` prefix; failures abort
with an actionable error rather than skipping silently).

## The `AUTH_CONTEXT` seam

Everything in this package depends on a three-method interface, not on a
concrete service (`IAuthContext` in `src/auth-context.ts`, bound through the
`AUTH_CONTEXT` injection token declared in the same file):

```ts
interface IAuthContext {
  token(): string | null;
  tenantId(): string | null;
  isAuthenticated(): boolean;
}
```

An app wires its own service in with
`{ provide: AUTH_CONTEXT, useExisting: AuthService }` — which is exactly what
`provideCoreApp` does with its `authServiceClass` option. That is what
lets the interceptors and guard stay app-agnostic.

## API

| Export | Source | Behaviour |
|---|---|---|
| `provideCoreApp({ routes, authServiceClass })` | `src/app-providers.ts:15-26` | One-call bootstrap: global error listeners, the `AUTH_CONTEXT` binding, `provideRouter(routes, withComponentInputBinding())`, `provideHttpClient(withInterceptors([authInterceptor, tenantInterceptor]))`, and async animations |
| `authInterceptor` | `src/auth.interceptor.ts:5-17` | Adds `Authorization: Bearer <token>` when a token exists; passes the request through untouched otherwise (`:9-16`) |
| `tenantInterceptor` | `src/tenant.interceptor.ts:5-17` | Adds `x-yoizen-tenant: <tenantId>` when one is resolvable; otherwise passes through |
| `authGuard` | `src/auth.guard.ts:5-14` | `true` when authenticated, else a `UrlTree` redirect to `/login` (`:13`) |
| `BaseAuthService` | `src/base-auth.service.ts:14` | Abstract session base — see below |
| `decodeJwtPayload`, `extractInitials`, `formatRole` | `src/auth-utils.ts:6`, `:20`, `:32` | Pure helpers |
| `SYSTEM_ROLE_TENANT_ADMIN` | `src/auth-constants.ts:2` | `"tenant_admin"` |
| `IJwtPayload`, `ITokenResponse`, `IUserProfile`, `LoginTenantMode` | `src/auth-types.ts` | Types |

`authInterceptor` and `tenantInterceptor` are also re-exported PascalCase as
`AuthInterceptor` / `TenantInterceptor` for consumers that prefer that style
(`src/index.ts:23-25`).

## `BaseAuthService`

`src/base-auth.service.ts:14` — an abstract class implementing `IAuthContext`
on Angular signals. The token is a `signal` (`:15`); everything else is a
`computed` derived from the decoded payload (`:55-58`).

### What a subclass must supply

Four abstract members (`:36-43`): `apiBaseUrl`, `tokenStorageKey`,
`refreshStorageKey`, and `loginTenantMode`. The last one exists because the
consoles differ on the wire: the admin console sends the tenant in the login
BODY while messaging sends the `x-yoizen-tenant` header (`:42`).

A subclass must also call `restoreTokenFromStorage()` from its own constructor
AFTER `super()` — the base constructor cannot do it, because the abstract
storage keys are not available that early (`:27-33`).

Two optional hooks default to no-ops: `onAfterSetTokens` (e.g. schedule a
proactive refresh, `:45-48`) and `onBeforeLogout` (e.g. clear refresh timers,
`:50-53`).

### Derived state

| Signal | Rule |
|---|---|
| `isAuthenticated()` | Payload present AND `exp * 1000 > Date.now()` — expiry is enforced client-side, not just presence (`:60-64`) |
| `tenantId()` | `payload.tenant_id` when present, else parsed out of a `scope` of the form `tenant:<id>` (`:66-73`) |
| `userRole()` | `payload.role`, defaulting to `"viewer"` (`:75-78`) |
| `permissions()` | `Set` of `payload.permissions` (`:80-84`) |
| `isAdmin()` | Role is `tenant_admin` **or** permissions contain the `"*"` wildcard (`:86-90`) |
| `userProfile()` | `{ id, name, email, initials, role }`, with `email` falling back to `"unknown"` and role passed through `formatRole` (`:92-102`) |
| `hasPermission(p)` | Short-circuits `true` for admins, else a `Set` membership test (`:104-107`) |

Session tokens are persisted to `localStorage` under the subclass's keys and
cleared on logout (`:151-152`, `:179-182`).

### Session methods

The base class is not read-only state — it also owns the HTTP session, so a
subclass inherits these without writing them:

All six live in `src/base-auth.service.ts`.

| Method | Behaviour |
|---|---|
| `login(email, password, tenantId?)` | Fire-and-forget wrapper: subscribes to `postLogin` and calls `completeLogin` on success, but its `error` arm is an empty block — the failure is swallowed, so a UI that needs it must subscribe to `postLogin` itself |
| `postLogin(...)` (protected) | `POST {apiBaseUrl}/auth/login`; sends `tenant_id` in the BODY when `loginTenantMode === "body"`, otherwise as the `x-yoizen-tenant` HEADER — this is the only thing `loginTenantMode` controls |
| `completeLogin(res)` (protected) | `setTokens(res.access_token, res.refresh_token)` then `router.navigate(["/"])` |
| `logout()` | Calls the `onBeforeLogout` hook, removes both storage keys, resets the token signal to `null`, navigates to `/login` |
| `refreshToken()` | `POST {apiBaseUrl}/auth/refresh` with `{ refresh_token }`; **any** failure — no stored refresh token, or a rejected response — falls through to `logout()` |
| `setTokens(access, refresh?)` (protected) | Persists (refresh only when present), updates the signal, then calls the `onAfterSetTokens` hook |

## Consumers

`services/admin-console` is the only consumer, but it uses more of the surface
than a single wiring file — `rg -l '@yoizen/angular-shared' services` returns
`package.json` plus seven sources and three specs:
`src/app/app.config.ts`, `src/test-providers.ts`,
`src/app/core/services/auth.service.ts` (the `BaseAuthService` subclass),
`src/app/core/services/structured-kb.service.ts`,
`src/app/core/guards/auth.guard.ts`,
`src/app/core/interceptors/auth.interceptor.ts`,
`src/app/core/interceptors/tenant.interceptor.ts`, and the matching
`auth.guard.spec.ts` / `auth.interceptor.spec.ts` / `tenant.interceptor.spec.ts`.

## Testing

The package ships no tests of its own. Its behaviour is covered by the
consuming console's specs, e.g.
`services/admin-console/src/app/core/guards/auth.guard.spec.ts`.
