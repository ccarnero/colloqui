import { describe, expect, it, mock } from "bun:test";
import { replaceKnativeServiceWithConflictRetry } from "../../src/utils/k8s-retry";

function noopSleep(): Promise<void> {
  return Promise.resolve();
}

describe("replaceKnativeServiceWithConflictRetry", () => {
  it("gets once and replaces once on the happy path", async () => {
    const customApi = {
      getNamespacedCustomObject: mock(() =>
        Promise.resolve({ metadata: { resourceVersion: "1" }, spec: {} })
      ),
      replaceNamespacedCustomObject: mock(() => Promise.resolve({ ok: true })),
    };

    const mutate = mock((current: Record<string, unknown>) => ({
      ...current,
      mutated: true,
    }));

    await replaceKnativeServiceWithConflictRetry(
      customApi as never,
      "ns",
      "svc",
      mutate,
      { sleep: noopSleep }
    );

    expect(customApi.getNamespacedCustomObject).toHaveBeenCalledTimes(1);
    expect(customApi.replaceNamespacedCustomObject).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("re-GETs on 409 and re-applies the mutation to the FRESH object, not the stale one", async () => {
    const staleObject = {
      metadata: { resourceVersion: "1" },
      spec: { image: "stale-image" },
    };
    const freshObject = {
      metadata: { resourceVersion: "2" },
      spec: { image: "fresh-image" },
    };

    const getNamespacedCustomObject = mock(() => Promise.resolve(staleObject));
    getNamespacedCustomObject.mockImplementationOnce(() =>
      Promise.resolve(staleObject)
    );
    getNamespacedCustomObject.mockImplementationOnce(() =>
      Promise.resolve(freshObject)
    );

    const replaceNamespacedCustomObject = mock(() => Promise.resolve({}));
    replaceNamespacedCustomObject.mockImplementationOnce(() =>
      Promise.reject({ response: { statusCode: 409 } })
    );
    replaceNamespacedCustomObject.mockImplementationOnce(() =>
      Promise.resolve({ ok: true })
    );

    const customApi = {
      getNamespacedCustomObject,
      replaceNamespacedCustomObject,
    };

    // Mutation re-applies the same logic each time it is invoked, deriving
    // its output purely from whatever `current` object it is handed.
    const mutate = (
      current: Record<string, unknown>
    ): Record<string, unknown> => {
      const spec = current.spec as { image: string };
      return { ...current, spec: { ...spec, patched: true } };
    };

    await replaceKnativeServiceWithConflictRetry(
      customApi as never,
      "ns",
      "svc",
      mutate,
      { sleep: noopSleep }
    );

    expect(getNamespacedCustomObject).toHaveBeenCalledTimes(2);
    expect(replaceNamespacedCustomObject).toHaveBeenCalledTimes(2);

    // The regression check: the SECOND (successful) replace call must carry
    // a body built from the FRESH (second GET) object, not the stale one.
    // The generated client-node CustomObjectsApi takes a single param
    // object with a `body` field, so args[0].body is the payload.
    const secondCallParams = replaceNamespacedCustomObject.mock.calls[1][0] as {
      body: {
        metadata: { resourceVersion: string };
        spec: { image: string; patched: boolean };
      };
    };
    const secondBody = secondCallParams.body;
    expect(secondBody.metadata.resourceVersion).toBe("2");
    expect(secondBody.spec.image).toBe("fresh-image");
    expect(secondBody.spec.patched).toBe(true);
  });

  it("does not retry on a non-conflict error", async () => {
    const customApi = {
      getNamespacedCustomObject: mock(() =>
        Promise.resolve({ metadata: {}, spec: {} })
      ),
      replaceNamespacedCustomObject: mock(() =>
        Promise.reject(new Error("network down"))
      ),
    };

    await expect(
      replaceKnativeServiceWithConflictRetry(
        customApi as never,
        "ns",
        "svc",
        (current) => current,
        { sleep: noopSleep }
      )
    ).rejects.toThrow("network down");

    expect(customApi.getNamespacedCustomObject).toHaveBeenCalledTimes(1);
    expect(customApi.replaceNamespacedCustomObject).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxAttempts and surfaces the last conflict error", async () => {
    const customApi = {
      getNamespacedCustomObject: mock(() =>
        Promise.resolve({ metadata: {}, spec: {} })
      ),
      replaceNamespacedCustomObject: mock(() =>
        Promise.reject({ response: { statusCode: 409 } })
      ),
    };

    await expect(
      replaceKnativeServiceWithConflictRetry(
        customApi as never,
        "ns",
        "svc",
        (current) => current,
        { maxAttempts: 3, sleep: noopSleep }
      )
    ).rejects.toMatchObject({ response: { statusCode: 409 } });

    expect(customApi.getNamespacedCustomObject).toHaveBeenCalledTimes(3);
    expect(customApi.replaceNamespacedCustomObject).toHaveBeenCalledTimes(3);
  });
});
