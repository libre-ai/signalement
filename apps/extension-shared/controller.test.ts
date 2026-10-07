import { expect, spyOn, test } from "bun:test";
import { createController, type ExtensionApi } from "./controller";

test("only the extension popup can request capture; the editor consumes its nonce once", async () => {
  let captures = 0;
  let opened = "";
  let now = 0;
  const api: ExtensionApi = {
    runtime: { id: "fixture-extension", getURL: (path) => `chrome-extension://fixture/${path}` },
    tabs: {
      query: async () => [{ id: 1, windowId: 2, url: "https://fixture.invalid/" }],
      captureVisibleTab: async () => {
        captures++;
        return "data:image/png;base64,c3ludGhldGlj";
      },
      create: async ({ url }) => {
        opened = url;
      },
      onActivated: { addListener() {}, removeListener() {} },
      onUpdated: { addListener() {}, removeListener() {} },
    },
  };
  const handle = createController(
    api,
    () => now,
    () => "test-nonce",
  );
  const popup = { id: api.runtime.id, url: api.runtime.getURL("popup.html") };
  const editor = { id: api.runtime.id, url: api.runtime.getURL("editor.html") };
  expect(captures).toBe(0);
  expect(
    await handle({ kind: "capture" }, { id: "page", url: "https://fixture.invalid/" }),
  ).toEqual({ ok: false, error: "not-authorized" });
  expect(await handle({ kind: "capture" }, editor)).toEqual({ ok: false, error: "not-authorized" });
  expect(captures).toBe(0);
  expect(await handle({ kind: "capture" }, popup)).toEqual({ ok: true });
  expect(opened).toBe(`${api.runtime.getURL("editor.html")}#test-nonce`);
  expect(await handle({ kind: "consume", nonce: "test-nonce" }, editor)).toEqual({
    ok: true,
    data: "data:image/png;base64,c3ludGhldGlj",
  });
  expect(await handle({ kind: "consume", nonce: "test-nonce" }, editor)).toEqual({
    ok: false,
    error: "capture-expired",
  });
  await handle({ kind: "capture" }, popup);
  now = 61_000;
  expect(await handle({ kind: "consume", nonce: "test-nonce" }, editor)).toEqual({
    ok: false,
    error: "capture-expired",
  });
  expect(await handle({ kind: "open" }, popup)).toEqual({ ok: true });
  expect(opened).toBe(api.runtime.getURL("editor.html"));
});

test("a closed reply protocol refuses unknown fields and never returns provider error text", async () => {
  const api: ExtensionApi = {
    runtime: { id: "test", getURL: (path) => `moz-extension://fixture/${path}` },
    tabs: {
      query: async () => {
        throw new Error("sensitive diagnostic");
      },
      captureVisibleTab: async () => "",
      create: async () => {},
      onActivated: { addListener() {}, removeListener() {} },
      onUpdated: { addListener() {}, removeListener() {} },
    },
  };
  const handle = createController(api);
  const sender = { id: "test", url: api.runtime.getURL("popup.html") };
  expect(await handle({ kind: "capture", unexpected: true }, sender)).toEqual({
    ok: false,
    error: "invalid-message",
  });
  expect(await handle({ kind: "capture" }, sender)).toEqual({
    ok: false,
    error: "capture-unavailable",
  });
});

test("capture uses an opaque nonce and timer expiry clears its one-shot buffer", async () => {
  let timer: (() => void) | undefined;
  let opened = "";
  const timeout = spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void) => {
    timer = callback;
    return 0;
  }) as unknown as typeof setTimeout);
  try {
    const api: ExtensionApi = {
      runtime: { id: "synthetic", getURL: (path) => `chrome-extension://synthetic/${path}` },
      tabs: {
        query: async () => [{ id: 1, windowId: 2, url: "https://fixture.invalid/" }],
        captureVisibleTab: async () => "data:image/png;base64,c3ludGhldGlj",
        create: async ({ url }) => {
          opened = url;
        },
        onActivated: { addListener() {}, removeListener() {} },
        onUpdated: { addListener() {}, removeListener() {} },
      },
    };
    const handle = createController(api);
    expect(
      await handle({ kind: "capture" }, { id: "synthetic", url: api.runtime.getURL("popup.html") }),
    ).toEqual({ ok: true });
    const nonce = new URL(opened).hash.slice(1);
    expect(nonce).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    if (!timer) throw new Error("Missing expiry timer");
    timer();
    expect(
      await handle(
        { kind: "consume", nonce },
        { id: "synthetic", url: api.runtime.getURL("editor.html") },
      ),
    ).toEqual({ ok: false, error: "capture-expired" });
  } finally {
    timeout.mockRestore();
  }
});
