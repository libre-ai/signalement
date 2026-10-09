import { expect, test } from "bun:test";
import { PlaybackReview, videoReadyForExport } from "./video-state.ts";

test("video requires sanitized bytes, complete playback and explicit video/audio review", () => {
  const state = {
    present: true,
    sanitized: true,
    played: true,
    reviewed: true,
    audioIncluded: false,
    audioReviewed: false,
  };
  expect(videoReadyForExport(state)).toBe(true);
  for (const field of ["sanitized", "played", "reviewed"] as const)
    expect(videoReadyForExport({ ...state, [field]: false })).toBe(false);
  expect(videoReadyForExport({ ...state, audioIncluded: true })).toBe(false);
  expect(videoReadyForExport({ ...state, audioIncluded: true, audioReviewed: true })).toBe(true);
});
test("seeking forward cannot satisfy complete playback", () => {
  const playback = new PlaybackReview();
  playback.play(0);
  playback.time(0.4, 1);
  playback.seek();
  playback.time(10, 1);
  expect(playback.ended()).toBe(false);
  playback.play(0);
  playback.time(0.4, 1);
  playback.time(0.8, 1);
  expect(playback.ended()).toBe(true);
  playback.play(0);
  playback.time(0.5, 2);
  expect(playback.ended()).toBe(false);
});
