import { describe, expect, test } from "bun:test";

import { stallVerdict, type TimelineEntry, VIDEO_CHECK_BUDGETS } from "./browser-check-watchdog.ts";

// Timeline measured on CI run 37872290823 (Chrome 154.0.8037.97, first launch on a fresh runner):
// a correct run whose browser startup alone took 6.7 s and whose result arrived at 22.3 s.
const coldPassingRun: TimelineEntry[] = [
  { stage: "browser-spawned", atMs: 2 },
  { stage: "page-requested", atMs: 6706 },
  { stage: "fixture-requested", atMs: 7060 },
  { stage: "recording-silent", atMs: 7277 },
  { stage: "recorded-silent", atMs: 10114 },
  { stage: "source-decoded-silent", atMs: 10827 },
  { stage: "transcoded-silent", atMs: 13001 },
  { stage: "derivative-presented-silent", atMs: 13031 },
  { stage: "derivative-ended-silent", atMs: 15096 },
  { stage: "recording-audio", atMs: 15096 },
  { stage: "recorded-audio", atMs: 17628 },
  { stage: "source-decoded-audio", atMs: 17692 },
  { stage: "transcoded-audio", atMs: 19936 },
  { stage: "derivative-presented-audio", atMs: 20025 },
  { stage: "derivative-ended-audio", atMs: 22306 },
];

function verdictsAlong(timeline: TimelineEntry[], untilMs: number): (string | null)[] {
  const verdicts: (string | null)[] = [];
  for (let now = 0; now <= untilMs; now += 100) {
    const seen = timeline.filter((entry) => entry.atMs <= now);
    verdicts.push(stallVerdict(seen, now, VIDEO_CHECK_BUDGETS));
  }
  return verdicts;
}

describe("stallVerdict", () => {
  test("never stalls a measured cold-start run that keeps progressing past 20 s", () => {
    expect(verdictsAlong(coldPassingRun, 22306).every((verdict) => verdict === null)).toBe(true);
  });

  test("names the media stage that stopped progressing", () => {
    const stalled = coldPassingRun.slice(0, 6);
    const last = stalled.at(-1)?.atMs ?? 0;
    expect(stallVerdict(stalled, last + VIDEO_CHECK_BUDGETS.stageMs, VIDEO_CHECK_BUDGETS)).toBe(
      null,
    );
    expect(stallVerdict(stalled, last + VIDEO_CHECK_BUDGETS.stageMs + 1, VIDEO_CHECK_BUDGETS)).toBe(
      `no progress for ${VIDEO_CHECK_BUDGETS.stageMs} ms after source-decoded-silent`,
    );
  });

  test("bounds browser startup separately from media stages", () => {
    const spawned: TimelineEntry[] = [{ stage: "browser-spawned", atMs: 0 }];
    expect(stallVerdict(spawned, VIDEO_CHECK_BUDGETS.startupMs, VIDEO_CHECK_BUDGETS)).toBe(null);
    expect(stallVerdict(spawned, VIDEO_CHECK_BUDGETS.startupMs + 1, VIDEO_CHECK_BUDGETS)).toBe(
      `no progress for ${VIDEO_CHECK_BUDGETS.startupMs} ms after browser-spawned`,
    );
  });

  test("a media stage does not inherit the startup budget", () => {
    expect(VIDEO_CHECK_BUDGETS.stageMs).toBeLessThan(VIDEO_CHECK_BUDGETS.startupMs);
    const recording: TimelineEntry[] = coldPassingRun.slice(0, 4);
    const last = recording.at(-1)?.atMs ?? 0;
    expect(
      stallVerdict(recording, last + VIDEO_CHECK_BUDGETS.stageMs + 1, VIDEO_CHECK_BUDGETS),
    ).toBe(`no progress for ${VIDEO_CHECK_BUDGETS.stageMs} ms after recording-silent`);
  });

  test("fails a run that progresses but never finishes within the overall budget", () => {
    const creeping: TimelineEntry[] = [];
    for (let at = 0; at <= VIDEO_CHECK_BUDGETS.overallMs; at += 1000)
      creeping.push({ stage: `stage-${at}`, atMs: at });
    const now = VIDEO_CHECK_BUDGETS.overallMs + 1;
    expect(stallVerdict(creeping, now, VIDEO_CHECK_BUDGETS)).toBe(
      `overall budget ${VIDEO_CHECK_BUDGETS.overallMs} ms exceeded after stage-${VIDEO_CHECK_BUDGETS.overallMs}`,
    );
  });

  test("an empty timeline is a stall from time zero, never a pass", () => {
    expect(stallVerdict([], VIDEO_CHECK_BUDGETS.startupMs + 1, VIDEO_CHECK_BUDGETS)).toBe(
      `no progress for ${VIDEO_CHECK_BUDGETS.startupMs} ms after browser-spawned`,
    );
  });
});
