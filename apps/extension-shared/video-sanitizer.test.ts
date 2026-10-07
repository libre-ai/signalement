import { expect, test } from "bun:test";
import { selectVideoMime, validateVideoMasks } from "./video-sanitizer.ts";

test("video masks are integer bounded rectangles on every output frame", () => {
  expect(() => validateVideoMasks([{ x: 0, y: 0, width: 2, height: 2 }], 2, 2)).not.toThrow();
  for (const mask of [
    { x: -1, y: 0, width: 1, height: 1 },
    { x: 0, y: 0, width: 3, height: 1 },
    { x: 0.5, y: 0, width: 1, height: 1 },
  ])
    expect(() => validateVideoMasks([mask], 2, 2)).toThrow();
  expect(() => validateVideoMasks([], 100000, 100000)).toThrow();
});
test("silent encoder never requests an Opus track it cannot receive", () => {
  expect(selectVideoMime(false, () => true)).toBe("video/webm;codecs=vp8");
  expect(selectVideoMime(true, () => true)).toBe("video/webm;codecs=vp8,opus");
  expect(() => selectVideoMime(true, () => false)).toThrow();
});
