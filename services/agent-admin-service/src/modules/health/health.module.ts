import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";

/**
 * Health module for health-check endpoints.
 *
 * Provides:
 * - GET /health — service and dependency status
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
