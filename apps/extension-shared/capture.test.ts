import { expect, test } from "bun:test";
import { type CaptureTabs, captureExplicitly } from "./capture";

function fixture() {
  const listeners = new Set<() => void>();
  const windows: number[] = [];
  let queries = 0;
  let changed = false;
  const tabs: CaptureTabs = {
    async query() {
      queries++;
      return [{ id: changed ? 8 : 7, windowId: 3, url: "https://fixture.invalid/" }];
    },
    async captureVisibleTab(windowId) {
      windows.push(windowId);
      return "data:image/png;base64,c3ludGhldGlj";
    },
    onActivated: {
      addListener(fn) {
        listeners.add(fn);
      },
      removeListener(fn) {
        listeners.delete(fn);
      },
    },
    onUpdated: {
      addListener(fn) {
        listeners.add(fn);
      },
      removeListener(fn) {
        listeners.delete(fn);
      },
    },
  };
  return {
    tabs,
    windows,
    listeners,
    queryCount: () => queries,
    change: () => {
      changed = true;
    },
    navigate: () => {
      for (const fn of listeners) fn();
    },
  };
}

test("construction does not collect; explicit capture binds the original window", async () => {
  const f = fixture();
  expect(f.queryCount()).toBe(0);
  expect(await captureExplicitly(f.tabs)).toBe("data:image/png;base64,c3ludGhldGlj");
  expect(f.windows).toEqual([3]);
  expect(f.listeners.size).toBe(0);
});

test("navigation invalidates capture even when URL and tab return to their initial values", async () => {
  const f = fixture();
  f.tabs.captureVisibleTab = async () => {
    f.navigate();
    return "data:image/png;base64,c3ludGhldGlj";
  };
  await expect(captureExplicitly(f.tabs)).rejects.toThrow("Capture target changed");
  expect(f.listeners.size).toBe(0);
});

test("a different active tab is refused", async () => {
  const f = fixture();
  f.tabs.captureVisibleTab = async () => {
    f.change();
    return "data:image/png;base64,c3ludGhldGlj";
  };
  await expect(captureExplicitly(f.tabs)).rejects.toThrow("Capture target changed");
});

test("permission rejection cleans listeners and does not return bytes", async () => {
  const f = fixture();
  f.tabs.captureVisibleTab = async () => {
    throw new Error("Denied");
  };
  await expect(captureExplicitly(f.tabs)).rejects.toThrow("Denied");
  expect(f.listeners.size).toBe(0);
});

test("privileged pages and malformed capture replies are refused", async () => {
  const f = fixture();
  f.tabs.query = async () => [{ id: 7, windowId: 3, url: "chrome://settings/" }];
  await expect(captureExplicitly(f.tabs)).rejects.toThrow("Web page required");
  expect(f.windows).toEqual([]);
  const g = fixture();
  g.tabs.captureVisibleTab = async () => "data:text/html,untrusted";
  await expect(captureExplicitly(g.tabs)).rejects.toThrow("Invalid capture");
});
