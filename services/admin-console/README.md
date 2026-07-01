# Admin Console

Tenant-scoped administration dashboard for the Yoizen platform. Built with Angular 21, standalone components, signals, Angular Material, and the Yoizen UI shell. Each authenticated user sees data for the tenant encoded in their JWT.

## Quick Start

```bash
npm install
ng serve
```

Open `http://localhost:4200/`. Unauthenticated users are redirected to `/login`.

## Authentication and tenant scope

The console authenticates via `POST /auth/login` (email + password). The JWT payload provides:

- `scope` — tenant scope, for example `tenant:<id>`
- `role` — `tenant_admin`, `tenant_editor`, or `tenant_viewer`
- `tenant_id` — tenant identifier
- `email` — user email

The client decodes the JWT to derive the user profile and tenant context. HTTP interceptors attach the bearer token and `x-yoizen-tenant` header to API requests. The app has no tenant switcher; tenant selection comes from the token.

## Current navigation model

The shell uses top header sections plus a left sub-nav, not the older role-filtered sidebar. Current top sections come from `src/app/layout/nav/nav.config.ts`:

| Top section | Landing | Sub-nav pages |
| --- | --- | --- |
| Overview | `/dashboard` | Dashboard, Analytics |
| Channels | `/channels` | WhatsApp, Telegram, HTTP |
| Connections | `/connections` | Overview, HTTP, MCP, Hosted services |
| AI | `/ai` | Agents, Playground, Memories, Skills, Knowledge Bases, System Variables |
| Processes | `/processes` | Workflows, Schedules |
| Settings | `/settings` | Users, Roles, API keys, Billing |

Route access is protected by `authGuard` at the shell level. Individual feature pages should not be documented as permission-gated unless the route actually has a guard.

## User management

Tenant admins can manage tenant users from **Settings › Users** (`/users`):

- View tenant users with email, display name, role, and creation date
- Create tenant users via the API gateway
- Deactivate tenant users

These operations use the API gateway auth tenant-user routes.

## Project Structure

```
src/
├── app/
│   ├── core/
│   │   ├── guards/           # authGuard route protection
│   │   ├── interceptors/     # auth + tenant headers
│   │   ├── models/
│   │   └── services/
│   ├── features/
│   │   ├── auth/             # Login
│   │   ├── overview/         # Dashboard, Analytics
│   │   ├── channels/         # Channel landing and channel account detail
│   │   ├── connections/      # Connections landing, MCP placeholder/page
│   │   ├── automation/       # Workflows, schedules, hosted services, AI feature pages
│   │   ├── processes/        # Processes landing and direct message trace route
│   │   ├── identity/         # Users, Roles, API keys
│   │   └── settings-hub/     # Settings landing hub
│   ├── layout/
│   │   ├── shell/            # Header + sub-nav + main outlet
│   │   ├── header/           # Top section tabs
│   │   ├── nav/              # NAV_SECTIONS source of truth
│   │   └── sub-nav/          # Left section sub-nav
│   └── shared/components/    # PageHeader, KPI, ActivityFeed, SubTabs, status primitives
├── environments/
├── styles.scss
└── main.ts
```

## Building

```bash
ng build
ng build --configuration=production
```

The production build is packaged into an nginx container via the Dockerfile.

## Environment Configuration

| File | `apiUrl` |
|------|----------|
| `environment.ts` (dev) | `http://api-gateway.platform-services-dev.192.168.49.2.sslip.io` |
| `environment.prod.ts` | `/api` |

## Component testing strategy

See **Angular consoles** under *Testing* in the repo root `AGENTS.md`. Use Angular `TestBed`, HTTP testing utilities for services, and focused component tests around routing, guards, interceptors, and metrics services before broad feature snapshots.
