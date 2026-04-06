import { NotFoundException } from "@nestjs/common";

/**
 * Returns the row or throws {@link NotFoundException} (O(1)).
 */
export function assertFoundOrThrow<T>(
  row: T | null | undefined,
  message: string,
): T {
  if (row === null || row === undefined) {
    throw new NotFoundException(message);
  }
  return row;
}
