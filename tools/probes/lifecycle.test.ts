import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("./extension/probe.js", import.meta.url), "utf8");

function harness(
  failure: "constructor" | "start" | null = null,
  changed: false | "tab" | "navigation" = false,
) {
  const clicks = new Map<string, () => Promise<void>>();
  const events = new Map<string, () => void>();
  const preview = {
    src: "",
    removeAttribute: () => {},
    decode: async () => {},
    naturalWidth: 1,
    naturalHeight: 1,
  };
  const result = { textContent: "" };
  let stopped = 0;
  let cleared = 0;
  let queries = 0;
  let capturedWindow: number | undefined;
  const track = { stop: () => stopped++, addEventListener: () => {} };
  class Recorder {
    state = "inactive";
    mimeType = "video/webm";
    constructor() {
      if (failure === "constructor") throw new Error("constructor failure");
    }
    addEventListener() {}
    start() {
      if (failure === "start") throw new Error("start failure");
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
    }
  }
  runInNewContext(source, {
    chrome: {
      tabs: {
        query: async () => {
          queries++;
          return [
            {
              id: changed === "tab" && queries > 1 ? 2 : 1,
              windowId: 7,
              url:
                changed === "navigation" && queries > 1
                  ? "http://127.0.0.1:43187/other"
                  : "http://127.0.0.1:43187/",
            },
          ];
        },
        captureVisibleTab: async (windowId: number) => {
          capturedWindow = windowId;
          return "data:image/png;base64,AA";
        },
      },
    },
    navigator: {
      mediaDevices: {
        getDisplayMedia: async () => ({
          getTracks: () => [track],
          getVideoTracks: () => [track],
          getAudioTracks: () => [],
        }),
      },
    },
    MediaRecorder: Recorder,
    DOMException,
    console,
    document: {
      getElementById: (id: string) =>
        id === "preview"
          ? preview
          : id === "result"
            ? result
            : { addEventListener: (_: string, fn: () => Promise<void>) => clicks.set(id, fn) },
    },
    window: { addEventListener: (id: string, fn: () => void) => events.set(id, fn) },
    setTimeout: () => 1,
    clearTimeout: () => cleared++,
  });
  return {
    clicks,
    events,
    preview,
    result,
    stopped: () => stopped,
    cleared: () => cleared,
    capturedWindow: () => capturedWindow,
  };
}
for (const failure of ["constructor", "start"] as const) {
  test(`stops acquired tracks when recorder ${failure} fails`, async () => {
    const h = harness(failure);
    await h.clicks.get("record")?.();
    expect(h.stopped()).toBe(1);
    expect(h.result.textContent).toContain("failed");
  });
}
test("pagehide releases recording tracks and timer", async () => {
  const h = harness();
  await h.clicks.get("record")?.();
  h.events.get("pagehide")?.();
  expect(h.stopped()).toBe(1);
  expect(h.cleared()).toBe(1);
});
test("capture binds window and refuses changed active tab before preview", async () => {
  const h = harness(null, "tab");
  await h.clicks.get("capture")?.();
  expect(h.capturedWindow()).toBe(7);
  expect(h.preview.src).toBe("");
  expect(h.result.textContent).toContain("failed");
});

test("capture refuses navigation before preview", async () => {
  const h = harness(null, "navigation");
  await h.clicks.get("capture")?.();
  expect(h.preview.src).toBe("");
  expect(h.result.textContent).toContain("failed");
});
