/**
 * Bun's `vi` from `bun:test` does not implement `vi.mocked`. Use this to narrow
 * `vi.fn()` mocks for `mockResolvedValue` / `mockRejectedValue`.
 */
export function mockFn<T extends (...args: unknown[]) => unknown>(
  fn: T,
): T & {
  mockResolvedValue: (v: unknown) => void;
  mockRejectedValue: (e: unknown) => void;
} {
  return fn as T & {
    mockResolvedValue: (v: unknown) => void;
    mockRejectedValue: (e: unknown) => void;
  };
}

type IMockQuery = {
  mockImplementation: (fn: (...args: unknown[]) => Promise<unknown>) => void;
};

/**
 * postgres.js tagged templates invoke the mock once per fragment; dynamic
 * UPDATE/SELECT paths may call the mock many times before the final query.
 */
export function mockSqlSequentialResponses(
  mockQuery: IMockQuery,
  responses: unknown[][],
): void {
  let index = 0;
  mockQuery.mockImplementation(() => {
    const response = responses[index] ?? [];
    index++;
    return Promise.resolve(response);
  });
}
