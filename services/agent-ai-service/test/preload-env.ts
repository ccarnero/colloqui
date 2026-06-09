// services/agent-ai-service/test/preload-env.ts
// Preload environment for agent-ai-service tests
// Loaded automatically via `bun test --preload ./test/preload-env.ts`

process.env.PLATFORM_ENVIRONMENT ??= "test";
process.env.STORAGE_ENGINE ??= "postgres";
process.env.POSTGRES_PASSWORD ??= "test-unit-secret";
process.env.JWT_SECRET ??= "test-secret-at-least-32-characters-long";
process.env.LEADER_ELECTION_POSTGRES_URL ??= "postgres://test:test@localhost:5432/test";
