# Code Review Checklist

The reviewer must verify **each** of these points before approving the PR.
Any violation of points marked as 🛑 **BLOCKING** requires immediate changes.

## 0. 📋 Process & Documentation (🛑 BLOCKING)
*Before reviewing code, verify the "Spec-First" compliance using SDD Orchestrator (SDD).*
- [ ] **Spec Exists**:
    - **Features**: A proposal and tasks artifact exist (via `/sdd:new` + `/sdd:ff` or equivalent).
    - **Bugfixes**: PR description includes "Bugfix Rationale".
- [ ] **Alignment**: The implemented code matches the plan defined in the tasks artifact.
- [ ] **PR Link**: The PR description includes a link to the relevant Spec/Ticket.

## 1. 🏗 Architecture & Structure (🛑 BLOCKING)
- [ ] **Clean Architecture**: Domain does not import Infrastructure (e.g., Entities do not import TypeORM or HTTP modules).
- [ ] **Single Responsibility**: The service/class does one thing well.
- [ ] **Size Limits**:
    - [ ] No file exceeds **500 lines**.
    - [ ] No function exceeds **80 lines**.
    - [ ] Constructor injections ≤ 5.
- [ ] **Location**: Code is in the correct folder (`dto`, `services`, `controllers`).

## 2. 🛡 Security & Performance (🛑 BLOCKING)
- [ ] **NO Hardcoded Secrets**: No keys, tokens, or passwords in the code.
- [ ] **Sanitization**: DTOs have validators (`@IsString()`, etc.) and `whitelist: true`.
- [ ] **Async/Await**: No "Callback Hell" or detached promises.
- [ ] **DB Queries**:
    - [ ] Pagination is used for lists.
    - [ ] DB Indices are respected.
    - [ ] No obvious N+1 queries in loops.

## 3. 🧹 Clean Code & Standards
- [ ] **Naming**: Variables/Functions in `camelCase`, Classes in `PascalCase`. Descriptive names (No `const data`, `var x`).
- [ ] **Language**: Code and comments in **English**. Docs/Specs may be in Spanish (if team policy allows).
- [ ] **Logs**: Structured Logger (Pino) is used, not `console.log`.
- [ ] **Error Handling**: Proper `HttpException` (404, 400) thrown instead of generic 500 errors.

## 4. 🧪 Testing
- [ ] **Unit Tests**: New business logic is covered (per-service `bun test`).
- [ ] **Integration**: If an endpoint changed, manually verify via the local bootstrapped cluster. A Playwright E2E suite exists at `e2e/` (config: `playwright.config.ts`, run with `npx playwright test`) — extend it when UI flows change.
- [ ] **Coverage**: Overall project coverage does not decrease significantly.

## 5. 📝 Maintainability
- [ ] **Dead Code**: No commented-out code or unused imports.
- [ ] **TODOs**: If a `TODO` exists, it must have an associated Jira/GitHub ticket ID.

---
*If this PR is an urgent Hotfix that violates a rule, it must bear the `waiver-approved` label and a linked technical debt ticket.*
