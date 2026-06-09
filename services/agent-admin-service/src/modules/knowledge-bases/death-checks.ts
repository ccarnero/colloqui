/**
 * Pure functions for verifying that a knowledge base or job still exists
 * during long-running ingestion processing.
 *
 * The `checkFn` parameter follows dependency inversion — the caller
 * provides the actual DB or Redis check, keeping these functions pure
 * and testable without infrastructure.
 */

/**
 * Verifies that a knowledge base still exists before/during processing.
 * Throws if the KB was deleted mid-flight.
 */
export async function verifyKbExists(
  checkFn: (tenantId: string, kbId: string) => Promise<boolean>,
  tenantId: string,
  kbId: string,
): Promise<void> {
  const exists = await checkFn(tenantId, kbId);
  if (!exists) {
    throw new Error(
      `Knowledge base ${kbId} was deleted during processing`,
    );
  }
}

/**
 * Verifies that a job is still active before/during processing.
 * Throws if the job was cancelled mid-flight.
 */
export async function verifyJobActive(
  checkFn: (tenantId: string, kbId: string, jobId: string) => Promise<boolean>,
  tenantId: string,
  kbId: string,
  jobId: string,
): Promise<void> {
  const active = await checkFn(tenantId, kbId, jobId);
  if (!active) {
    throw new Error(
      `Job ${jobId} was cancelled during processing`,
    );
  }
}
