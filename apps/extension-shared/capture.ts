interface EventSource {
  addListener(callback: () => void): void;
  removeListener(callback: () => void): void;
}
export interface CaptureTab {
  id?: number;
  windowId?: number;
  url?: string;
}
export interface CaptureTabs {
  query(query: {
    active: boolean;
    currentWindow?: boolean;
    windowId?: number;
  }): Promise<CaptureTab[]>;
  captureVisibleTab(windowId: number, options: { format: "png" }): Promise<string>;
  onActivated: EventSource;
  onUpdated: EventSource;
}

/** Caller invokes this only from an explicit extension action. No page script is injected. */
export async function captureExplicitly(tabs: CaptureTabs): Promise<string> {
  let changed = false;
  function invalidate(): void {
    changed = true;
  }
  tabs.onActivated.addListener(invalidate);
  tabs.onUpdated.addListener(invalidate);
  try {
    const [target] = await tabs.query({ active: true, currentWindow: true });
    if (
      !target ||
      !Number.isSafeInteger(target.id) ||
      typeof target.windowId !== "number" ||
      !Number.isSafeInteger(target.windowId) ||
      !/^https?:\/\//u.test(target.url ?? "")
    ) {
      throw new Error("Web page required");
    }
    // Conservatively refuse any tab event during capture, including navigation away and back.
    if (changed) throw new Error("Capture target changed");
    const data = await tabs.captureVisibleTab(target.windowId, { format: "png" });
    const [current] = await tabs.query({ active: true, windowId: target.windowId });
    if (
      changed ||
      current?.id !== target.id ||
      current?.windowId !== target.windowId ||
      current?.url !== target.url
    )
      throw new Error("Capture target changed");
    const prefix = "data:image/png;base64,";
    if (
      !data.startsWith(prefix) ||
      data.length > prefix.length + 4 * Math.ceil((16 * 1024 ** 2) / 3) ||
      !/^[A-Za-z0-9+/]+={0,2}$/u.test(data.slice(prefix.length))
    )
      throw new Error("Invalid capture");
    return data;
  } finally {
    tabs.onActivated.removeListener(invalidate);
    tabs.onUpdated.removeListener(invalidate);
  }
}
