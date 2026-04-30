import { describe, it, expect } from "bun:test";

/**
 * Smoke: ensures the Nest root module can be imported (no side effects on NATS/Redis).
 */
describe("channel-service AppModule", () => {
  it("imports without throwing", async () => {
    const { AppModule } = await import("../../src/app.module");
    expect(AppModule).toBeDefined();
  });
});
