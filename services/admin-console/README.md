# Admin Console

Tenant-scoped administration dashboard for the Yoizen platform. Built with Angular 21 and Angular Material. Each logged-in user sees only their tenant's resources, with sidebar sections filtered by role.

## Quick Start

```bash
npm install
ng serve
```

Open `http://localhost:4200/`. The app redirects unauthenticated users to `/login`.

## Authentication

The admin console authenticates via `POST /auth/login` (email + password). On successful login, the API returns a JWT containing:

- `scope` -- `tenant:<id>` identifying which tenant the user belongs to
- `role` -- one of `tenant_admin`, `tenant_editor`, or `tenant_viewer`
- `tenant_id` -- the tenant identifier
- `email` -- the user's email

The JWT is decoded client-side (base64 payload parse) to derive the user profile, tenant context, and role. The `x-yoizen-tenant` header is automatically set on every API request via an HTTP interceptor using the tenant ID from the JWT.

## Tenant-Scoped Design

This is **not** a multi-tenant platform admin tool. It is scoped to a single tenant determined by the logged-in user's JWT:

- No tenant selector or tenant switching UI
- Tenant ID derived from JWT, not user selection
- All API calls automatically include `x-yoizen-tenant` header
- Auth guard protects all routes (redirects to `/login` if unauthenticated)
- Tenant details are fetched on shell init from `GET /tenants/:name`

## Role-Based Access

Sidebar sections are filtered based on the user's role:

| Section | tenant_admin | tenant_editor | tenant_viewer |
|---------|:---:|:---:|:---:|
| Overview (Dashboard, Analytics) | Yes | Yes | Yes |
| Identity & Access (Users, Roles, Groups, SSO, MFA, API Keys) | Yes | No | No |
| Automation (Workflows, Webhooks, Scheduler, Rules) | Yes | Yes | No |
| Data & Integrations | Yes | Yes | Yes |
| Security & Compliance | Yes | No | No |
| Notifications | Yes | Yes | No |

The **Platform** section (Feature Flags, Environments, System Health) is hidden for all tenant users -- it is for platform administrators only.

## User Management

Tenant admins (`tenant_admin` role) can manage users for their tenant from the **Identity & Access > Users** page:

- View all tenant users with email, display name, role, and creation date
- Create new tenant users via a dialog (email, password, display name, role)
- Deactivate tenant users

These operations go through `GET/POST/DELETE /auth/tenant-users` on the API gateway.

## Project Structure

```
src/
├── app/
│   ├── core/
│   │   ├── guards/           # authGuard (route protection)
│   │   ├── interceptors/     # authInterceptor (Bearer token), tenantInterceptor (x-yoizen-tenant)
│   │   ├── models/           # IUser, ITenant, IActivity
│   │   └── services/         # AuthService, TenantService, ThemeService, NotificationService
│   ├── features/
│   │   ├── auth/             # Login page (email + password)
│   │   ├── overview/         # Dashboard, Analytics
│   │   ├── identity/         # Users, Roles, Groups, SSO, MFA, API Keys
│   │   ├── automation/       # Workflows, Webhooks, Scheduler, Rules
│   │   ├── data-integrations/# Data Sources, Network Sources, Export, Schema Manager
│   │   ├── security/         # Audit Log, Security Center, Compliance, IP Allowlist, Data Retention
│   │   ├── notifications/    # Notification Rules, Email Templates
│   │   └── tenant-management/# Billing, Quotas, Customization
│   ├── layout/
│   │   ├── shell/            # Main layout (header + sidebar + content + right panel)
│   │   ├── header/           # Logo, tenant badge, notifications, theme toggle, user menu
│   │   ├── sidebar/          # Role-filtered navigation sections
│   │   └── right-panel/      # Tenant health, quota usage, recent activity
│   └── shared/
│       └── components/       # DataTable, StatusBadge, MetricCard, Sparkline, ProgressBar, HttpAdapterDialog
├── environments/             # environment.ts, environment.prod.ts
├── styles.scss               # Global styles and CSS variables
└── main.ts                   # Angular bootstrap
```

## Building

```bash
ng build                          # Development build
ng build --configuration=production  # Production build (output in dist/)
```

The production build is packaged into an nginx container via the Dockerfile.

## Environment Configuration

| File | `apiUrl` |
|------|----------|
| `environment.ts` (dev) | `http://api-gateway.platform-services-dev.192.168.49.2.sslip.io` |
| `environment.prod.ts` | `/api` |

## Component testing strategy

See **Angular consoles** under *Testing* in the repo root `AGENTS.md`. Summary: use Angular `TestBed`, `HttpClientTestingModule` for API calls, stub heavy Material/dialog children, and prioritize auth, interceptors, and services before large feature components.
