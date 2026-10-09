// Chrome lists an extension's service-worker target, and accepts Runtime.evaluate on it, before
// the extension bindings are installed in the worker global. Measured locally on Chrome 154
// (20/20 launches): an evaluation issued as soon as the target appears reads `typeof chrome` as
// "undefined", and one issued a few milliseconds later reads the bound API. CI run 37874140923
// hit that window once in 34 runs (`ReferenceError: chrome is not defined`). The wait below
// polls the worker for the API it is about to use, bounded so a worker that never binds fails
// with the state it was stuck in rather than a generic timeout.

export type WorkerReadinessState =
  | "unbound"
  | "runtime-pending"
  | "tabs-pending"
  | "ready"
  | "unexpected";

export interface WorkerReadiness {
  polls: number;
  waitedMs: number;
  /** Distinct consecutive states observed, oldest first. */
  states: WorkerReadinessState[];
}

export interface WorkerReadinessOptions {
  budgetMs: number;
  pollMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

// The measured window is a few milliseconds; 10 s matches the stage budget of the other browser
// checks and stays well under the 25 s protocol-call deadline, so this failure is named first.
export const WORKER_READINESS_DEFAULTS: WorkerReadinessOptions = {
  budgetMs: 10_000,
  pollMs: 5,
  now: () => performance.now(),
  sleep: (ms) => Bun.sleep(ms),
};

const STATES: readonly WorkerReadinessState[] = [
  "unbound",
  "runtime-pending",
  "tabs-pending",
  "ready",
];

/** Every reference to `chrome` sits behind the leading typeof guard: it must not throw unbound. */
export function workerReadinessExpression(extensionId: string): string {
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error("Unexpected extension id");
  return [
    "typeof chrome === 'undefined' ? 'unbound'",
    `chrome.runtime?.id !== ${JSON.stringify(extensionId)} ? 'runtime-pending'`,
    "typeof chrome.tabs?.captureVisibleTab !== 'function' ? 'tabs-pending'",
    "'ready'",
  ].join(" : ");
}

function asState(value: unknown): WorkerReadinessState {
  return STATES.find((state) => state === value) ?? "unexpected";
}

export async function waitForExtensionWorker(
  evaluate: (expression: string) => Promise<unknown>,
  extensionId: string,
  options: WorkerReadinessOptions = WORKER_READINESS_DEFAULTS,
): Promise<WorkerReadiness> {
  const expression = workerReadinessExpression(extensionId);
  const started = options.now();
  const states: WorkerReadinessState[] = [];
  let polls = 0;
  for (;;) {
    const state = asState(await evaluate(expression));
    polls++;
    if (states.at(-1) !== state) states.push(state);
    const waitedMs = Math.round(options.now() - started);
    if (state === "ready") return { polls, waitedMs, states };
    if (waitedMs >= options.budgetMs)
      throw new Error(
        `Extension service worker API not bound after ${options.budgetMs} ms (polls: ${polls}, last state: ${state})`,
      );
    await options.sleep(options.pollMs);
  }
}
