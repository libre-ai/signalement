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

// Measured 2026-10-09 on CI (Chrome 154.0.8037.97, ubuntu-latest), runs 37871032245 and
// 37872290823-37873100676: the first browser launch on a fresh runner takes 0.7-7.5 s before
// requesting the page (0.2-0.9 s once warm, and dropping the page cache does not reproduce it), and
// every media stage is clocked by about 2.2 s of real-time recording or playback (longest gap
// observed 2.8 s). The stages then take 13.3-15.0 s, so one 20 s wall clock from spawn failed
// correct cold runs. Each budget is about four times the longest observed gap: a real stall still
// fails within seconds and is named, while a slow startup no longer consumes media time.
export const VIDEO_CHECK_BUDGETS: WatchdogBudgets = {
  startupMs: 30_000,
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
