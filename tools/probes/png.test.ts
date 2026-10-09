import { describe, expect, test } from "bun:test";
import { pngDimensions } from "./png.ts";

describe("bounded PNG metadata", () => {
  test("reads dimensions without retaining screenshot pixels", () => {
    const header = new Uint8Array(24);
    header.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
    const view = new DataView(header.buffer);
    view.setUint32(16, 640);
    view.setUint32(20, 480);
    expect(pngDimensions(header)).toEqual({ width: 640, height: 480 });
  });
  test("rejects malformed, truncated and oversized headers", () => {
    expect(() => pngDimensions(new Uint8Array(2))).toThrow();
    expect(() => pngDimensions(new Uint8Array(24))).toThrow();
    const header = new Uint8Array(24);
    header.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
    const view = new DataView(header.buffer);
    view.setUint32(16, 100_000);
    view.setUint32(20, 100_000);
    expect(() => pngDimensions(header)).toThrow();
  });
});
