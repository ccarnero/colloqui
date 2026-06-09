// services/agent-scheduler-service/test/preload-env.ts
// Preload environment for agent-scheduler-service tests
// Loaded automatically via `bun test --preload ./test/preload-env.ts`

process.env.PLATFORM_ENVIRONMENT ??= "test";
process.env.LEADER_ELECTION_POSTGRES_URL ??= "postgres://test:test@localhost:5432/test";
