import { expect, test } from "bun:test";
import { decodeCapture, Recording } from "./browser-media.ts";

test("rejects non-PNG and oversized capture URLs before decode", () => {
  expect(() => decodeCapture("data:text/html;base64,AA==")).toThrow();
  expect(() => decodeCapture("data:image/png;base64,%%%")).toThrow();
});
test("recording constructor failure releases acquired tracks", async () => {
  let stopped = 0;
  const media = {
    getAudioTracks: () => [],
    getTracks: () => [{ stop: () => stopped++ }],
  } as unknown as MediaStream;
  const recording = new Recording(
    async () => media,
    () => {
      throw new Error("Synthetic failure");
    },
  );
  await expect(recording.start(false, () => {})).rejects.toThrow();
  expect(stopped).toBe(1);
});
test("cancel while permission chooser is pending releases later stream", async () => {
  let resolveStream: (stream: MediaStream) => void = () => {};
  let stopped = 0;
  const recording = new Recording(
    () =>
      new Promise((resolve) => {
        resolveStream = resolve;
      }),
  );
  const pending = recording.start(false, () => {});
  recording.cancel();
  resolveStream({ getTracks: () => [{ stop: () => stopped++ }] } as unknown as MediaStream);
  await pending;
  expect(stopped).toBe(1);
});
test("late stop from cancelled recorder cannot stop a later recording", async () => {
  const eventMaps: Map<string, () => void>[] = [];
  let stopped = 0;
  const recording = new Recording(
    async () =>
      ({
        getTracks: () => [{ stop: () => stopped++ }],
        getVideoTracks: () => [],
        getAudioTracks: () => [],
      }) as unknown as MediaStream,
    () => {
      const events = new Map<string, () => void>();
      eventMaps.push(events);
      return {
        state: "recording",
        addEventListener: (name: string, fn: () => void) => events.set(name, fn),
        start: () => {},
        stop: () => {},
      } as unknown as MediaRecorder;
    },
  );
  await recording.start(false, () => {});
  recording.cancel();
  await recording.start(false, () => {});
  eventMaps[0]?.get("stop")?.();
  expect(stopped).toBe(1);
  recording.cancel();
  expect(stopped).toBe(2);
});
test("audio stays opt-in and oversize recording is discarded with tracks stopped", async () => {
  const requestedAudio: boolean[] = [];
  let stopped = 0;
  const events = new Map<string, (event: { data: { size: number } }) => void>();
  const messages: string[] = [];
  const recording = new Recording(
    async (audio) => {
      requestedAudio.push(audio);
      return {
        getTracks: () => [{ stop: () => stopped++ }],
        getVideoTracks: () => [],
        getAudioTracks: () => [],
      } as unknown as MediaStream;
    },
    () =>
      ({
        state: "recording",
        start: () => {},
        stop: () => {},
        addEventListener: (name: string, fn: (event: { data: { size: number } }) => void) =>
          events.set(name, fn),
      }) as unknown as MediaRecorder,
  );
  await recording.start(false, (message) => messages.push(message));
  expect(requestedAudio[0]).toBe(false);
  events.get("dataavailable")?.({ data: { size: 64 * 1024 ** 2 + 1 } });
  expect(stopped).toBe(1);
  expect(messages.at(-1)).toContain("supprimée");
});
test("stale source-track ended event cannot stop a new capture", async () => {
  const ended: (() => void)[] = [];
  let stops = 0;
  const recording = new Recording(
    async () =>
      ({
        getTracks: () => [{ stop: () => {} }],
        getAudioTracks: () => [],
        getVideoTracks: () => [
          { addEventListener: (_event: string, callback: () => void) => ended.push(callback) },
        ],
      }) as unknown as MediaStream,
    () =>
      ({
        state: "recording",
        addEventListener: () => {},
        start: () => {},
        stop: () => {
          stops++;
        },
      }) as unknown as MediaRecorder,
  );
  await recording.start(false, () => {});
  recording.cancel();
  await recording.start(false, () => {});
  const baseline = stops;
  ended[0]?.();
  expect(stops).toBe(baseline);
  recording.cancel();
});
