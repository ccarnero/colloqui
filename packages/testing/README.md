# `@yoizen/testing`

Shared **test doubles** for the platform's data layer: Mongo collections and
clients, and postgres.js `Sql` tagged-template mocks. It exists so unit tests
across services stop hand-rolling slightly different fakes of the same two
drivers.

Test-only by intent — nothing under any service's `src/` imports it; it appears
only in `devDependencies` and `test/**` files.

Workspace package, no build step: `main`/`types` both point at `src/index.ts`
(`package.json:5-8`). The whole surface is one 148-line file.

## Runner-agnostic by construction

The helpers never import `bun:test`. Instead each factory takes a `mock`
function as a parameter, typed loosely as
`type BunMock = (impl?) => unknown` (`src/index.ts:5-7`). Callers pass their own
runner's mock:

```ts
import { mock } from "bun:test";
import { createMockPostgresSql } from "@yoizen/testing";

const sql = createMockPostgresSql(mock, [{ id: "1" }]);
```

## API

`src/index.ts`

| Export | Signature | Behaviour |
|---|---|---|
| `MockMongoCollectionHandler` (`:9-12`) | `(operation, args) => unknown` | One handler per collection; receives the operation NAME and its arguments, so a single function can answer `findOne`, `insertOne`, `aggregate`, … |
| `IMockMongoCollection` (`:14-34`) | interface | The mocked surface: `findOne`, `find`, `insertOne`, `insertMany`, `updateOne`, `deleteOne`, `deleteMany`, `aggregate`. `find()` supports chained `.sort().toArray()`, `.sort().project().toArray()`, `.toArray()` and `.project().toArray()` (`:16-27`) |
| `createMockMongoCollection(handler, mock)` (`:39`) | → `IMockMongoCollection` | Every operation delegates to `handler` |
| `createMockMongoClient(collections, mock, databaseName = "yoizen")` (`:89`) | → `MongoClient` | Map of collection name → handler. An unmapped collection returns a handler that yields `null` rather than throwing (`:96-98`) — a typo'd collection name reads as "no rows", not as an error. Also fakes `startSession()` with a `withTransaction` that simply invokes the callback (`:101-108`), so transactional code runs without a real session |
| `createMockTenantDb(collections, mock)` (`:121`) | → `Db` | Thin wrapper over `createMockMongoClient(...).db("yoizen")` (`:125`) |
| `createQueuedSql(rowsQueue, mock)` (`:131`) | → `Sql` | postgres.js mock that DEQUEUES one row batch per tagged-template call, returning `[]` once the queue is drained (`:132-137`). Use when a test needs different results per query, in order. Also stubs `.json()` (identity) and `.unsafe()` (`:139-141`) |
| `createMockPostgresSql(mock, defaultRows = [])` (`:145`) | → `Sql` | Returns the SAME rows for every query (`:146-147`). Use when the query order is irrelevant. Note it does NOT stub `.json()` / `.unsafe()` — reach for `createQueuedSql` if the code under test calls those |

Two caveats worth knowing before choosing a helper:

- `createMockMongoClient`'s `db(name)` returns the same object for ANY name,
  including one that differs from `databaseName` (`:113-115`) — the parameter
  does not partition state, so a test asserting cross-database isolation will
  not catch a bug.
- `createQueuedSql` returns `[]` after exhaustion instead of failing, so a test
  that under-provisions the queue sees empty results rather than a loud error.

## Consumers

Today: `services/auth-service` and `services/tenant-service`
(`rg -l '@yoizen/testing' services`) — repository, service and controller unit
specs.

## Testing

The package has no tests of its own; it is exercised through its consumers:

```bash
cd services/auth-service && bun run test:unit
cd services/tenant-service && bun run test:unit
```
