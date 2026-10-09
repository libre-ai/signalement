import { describe, expect, test } from "bun:test";

import { waitForExtensionWorker, workerReadinessExpression } from "./extension-worker";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";

// A fake clock lets the bounded wait be exercised without real time passing.
function fakeClock() {
  let nowMs = 0;
  return {
    now: () => nowMs,
    sleep: async (ms: number) => {
      nowMs += ms;
    },
  };
}

describe("waitForExtensionWorker", () => {
  test("polls until the worker reports a bound extension API", async () => {
    // Measured locally (Chrome 154, 20/20 launches): the first evaluation issued right after
    // attaching reads `undefined`, the next one a few milliseconds later reads the bound API.
    const states = ["unbound", "unbound", "runtime-pending", "ready"];
    const evaluated: string[] = [];
    const clock = fakeClock();
    const readiness = await waitForExtensionWorker(
      async (expression) => {
        evaluated.push(expression);
        return states.shift();
      },
      extensionId,
      { budgetMs: 10_000, pollMs: 5, ...clock },
    );
    expect(readiness).toEqual({
      polls: 4,
      waitedMs: 15,
      states: ["unbound", "runtime-pending", "ready"],
    });
    expect(new Set(evaluated)).toEqual(new Set([workerReadinessExpression(extensionId)]));
  });

  test("returns after one poll when the API is already bound", async () => {
    const readiness = await waitForExtensionWorker(async () => "ready", extensionId, {
      budgetMs: 10_000,
      pollMs: 5,
      ...fakeClock(),
    });
    expect(readiness).toEqual({ polls: 1, waitedMs: 0, states: ["ready"] });
  });

  test("fails with the last observed state once the budget is spent", async () => {
    await expect(
      waitForExtensionWorker(async () => "tabs-pending", extensionId, {
        budgetMs: 100,
        pollMs: 10,
        ...fakeClock(),
      }),
    ).rejects.toThrow(
      "Extension service worker API not bound after 100 ms (polls: 11, last state: tabs-pending)",
    );
  });

  test("treats an unexpected evaluation value as not ready instead of ready", async () => {
    await expect(
      waitForExtensionWorker(async () => true, extensionId, {
        budgetMs: 20,
        pollMs: 10,
        ...fakeClock(),
      }),
    ).rejects.toThrow("last state: unexpected");
  });

  test("never references the extension API outside a typeof guard", () => {
    // The expression is evaluated precisely while `chrome` may be undeclared: any bare
    // reference would throw the ReferenceError this wait exists to avoid.
    const expression = workerReadinessExpression(extensionId);
    expect(expression.startsWith("typeof chrome === 'undefined'")).toBe(true);
    expect(expression).toContain(JSON.stringify(extensionId));
  });

  test("refuses an extension id that could escape the expression", () => {
    expect(() => workerReadinessExpression("x'); globalThis.pwned = 1; ('")).toThrow(
      "Unexpected extension id",
    );
  });
});
