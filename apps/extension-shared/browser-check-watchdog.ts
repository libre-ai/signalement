export interface TimelineEntry {
  stage: string;
  atMs: number;
}

export interface WatchdogBudgets {
  /** Silence allowed between spawning the browser and its first request. */
  startupMs: number;
  /** Silence allowed between two progress beacons once the page is running. */
  stageMs: number;
  /** Ceiling for the whole run, even while it keeps reporting progress. */
  overallMs: number;
}

// Measured 2026-10-09 on CI (Chrome 154.0.8037.97, ubuntu-latest), 32 first launches on fresh
// runners (runs 37872290823-37873100676 and 37873745532-37877128422): the browser takes 0.7-35.7 s
// before requesting the page, 0.2-0.9 s once warm. The cost is the first read of the 437 MiB Chrome
// install from the runner disk: reading it beforehand took 3.1-13.9 s and left a 0.5-2.8 s launch,
// while dropping the guest page cache does not reproduce it. Startup keeps 1.7 times the longest
// observed launch. It is shared by every browser check: whichever one CI runs first pays the cold
// read, so a check that is warm today only because of its position must not depend on it.
export const BROWSER_STARTUP_MS = 60_000;

// Every media stage is clocked by about 2.2 s of real-time recording or playback (longest gap
// observed 2.9 s) and the stages take 13.3-15.8 s, so one 20 s wall clock from spawn failed correct
// cold runs. Each media stage keeps over three times its longest observed gap: a real stall still
// fails and is named, while a slow startup no longer consumes media time.
export const VIDEO_CHECK_BUDGETS: WatchdogBudgets = {
  startupMs: BROWSER_STARTUP_MS,
  stageMs: 10_000,
  overallMs: 90_000,
};

// Fixtures without real-time media (editor, draft storage) bound each of their own waits at 5 s
// and report the failing check themselves. Twice that between two beacons means the page has
// stopped reporting at all; the overall ceiling covers a cold startup plus the fixture.
export const BROWSER_FIXTURE_BUDGETS: WatchdogBudgets = {
  startupMs: BROWSER_STARTUP_MS,
  stageMs: 10_000,
  overallMs: 90_000,
};

/**
 * Returns why a browser check must stop now, or null while it is still making progress.
 * `timeline` holds the stages already reported, oldest first; `nowMs` shares its clock.
 */
export function stallVerdict(
  timeline: readonly TimelineEntry[],
  nowMs: number,
  budgets: WatchdogBudgets,
): string | null {
  const last = timeline.at(-1) ?? { stage: "browser-spawned", atMs: 0 };
  const allowed = last.stage === "browser-spawned" ? budgets.startupMs : budgets.stageMs;
  if (nowMs - last.atMs > allowed) return `no progress for ${allowed} ms after ${last.stage}`;
  if (nowMs > budgets.overallMs)
    return `overall budget ${budgets.overallMs} ms exceeded after ${last.stage}`;
  return null;
}

export interface StageClock {
  readonly timeline: readonly TimelineEntry[];
  mark(stage: string): void;
  elapsedMs(): number;
}

// Stage names come from the page under test: both their count and length stay bounded.
const MAX_STAGES = 256;
const MAX_STAGE_LENGTH = 64;

export function startStageClock(now: () => number = () => performance.now()): StageClock {
  const started = now();
  const timeline: TimelineEntry[] = [];
  return {
    timeline,
    mark(stage) {
      if (timeline.length < MAX_STAGES)
        timeline.push({
          stage: stage.slice(0, MAX_STAGE_LENGTH),
          atMs: Math.round(now() - started),
        });
    },
    elapsedMs: () => now() - started,
  };
}

/** Polls until `isSettled`, or returns the stall verdict that ended the wait. */
export async function awaitProgress(
  isSettled: () => boolean,
  clock: StageClock,
  budgets: WatchdogBudgets,
  sleep: (ms: number) => Promise<void> = (ms) => Bun.sleep(ms),
): Promise<string | null> {
  while (!isSettled()) {
    await sleep(100);
    if (isSettled()) return null;
    const stall = stallVerdict(clock.timeline, clock.elapsedMs(), budgets);
    if (stall !== null) return stall;
  }
  return null;
}

/** Last lines of the browser's stderr, or null when it wrote nothing. */
export function browserLogTail(log: string): string | null {
  const trimmed = log.trim();
  return trimmed === "" ? null : trimmed.split("\n").slice(-20).join("\n");
}
