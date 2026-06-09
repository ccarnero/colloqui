import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import postgres from "postgres";
import type { Sql } from "@yoizen/database";

const ADVISORY_LOCK_ID = 32767;

@Injectable()
export class LeaderElectionService implements OnModuleDestroy {
  private readonly logger = new PinoLoggerService(LeaderElectionService.name);
  private isLeader = false;
  private platformSql: Sql | null = null;
  private renewalInterval: ReturnType<typeof setInterval> | null = null;

  async tryAcquireLeadership(
    postgresUrl: string | undefined,
  ): Promise<boolean> {
    if (!postgresUrl) {
      this.logger.warn(
        "No leader election postgres URL provided — skipping leader election",
      );
      return false;
    }

    try {
      if (!this.platformSql) {
        this.platformSql = postgres(postgresUrl) as unknown as Sql;
      }

      const result = await this.platformSql`
        SELECT pg_try_advisory_lock(${ADVISORY_LOCK_ID}) AS acquired
      `;

      const acquired = result[0]?.acquired === true;

      if (acquired) {
        this.isLeader = true;
        this.logger.log("Acquired platform-level leader lock (advisory)");
        this.startRenewal();
      } else {
        this.isLeader = false;
        this.logger.debug("Leader lock not available — another instance holds it");
      }

      return acquired;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not acquire leader lock: ${msg}`);
      this.isLeader = false;
      return false;
    }
  }

  isCurrentlyLeader(): boolean {
    return this.isLeader;
  }

  private startRenewal(): void {
    if (this.renewalInterval) return;

    this.renewalInterval = setInterval(async () => {
      if (!this.platformSql || !this.isLeader) return;
      try {
        const result = await this.platformSql`
          SELECT pg_try_advisory_lock(${ADVISORY_LOCK_ID}) AS still_mine
        `;
        if (result[0]?.still_mine !== true) {
          this.logger.warn("Leader lock lost — another instance holds it");
          await this.release();
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Leader lock renewal failed: ${msg}`);
        await this.release();
      }
    }, 30_000);
  }

  async release(): Promise<void> {
    if (this.renewalInterval) {
      clearInterval(this.renewalInterval);
      this.renewalInterval = null;
    }

    if (this.platformSql) {
      try {
        await this.platformSql`
          SELECT pg_advisory_unlock(${ADVISORY_LOCK_ID})
        `;
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Error releasing advisory lock: ${msg}`);
      }

      try {
        await (this.platformSql as unknown as { end: () => Promise<void> }).end();
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Error closing database connection: ${msg}`);
      }

      this.platformSql = null;
    }

    this.isLeader = false;
    this.logger.log("Released leader lock");
  }

  async onModuleDestroy(): Promise<void> {
    await this.release();
  }
}
