import { expect, test } from "bun:test";
import { join } from "node:path";

import { inspectPngHeader, type RgbaImage, transformScreenshot } from "./pixels";

// A known 1x1 transparent PNG; its IHDR CRC is independent of the implementation.
const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==",
    "base64",
  ),
);
function source(): RgbaImage {
  return {
    width: 3,
    height: 2,
    pixels: new Uint8Array([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ]),
  };
}
test("reads bounded PNG dimensions from a complete valid IHDR before decoding", () => {
  expect(inspectPngHeader(PNG)).toEqual({ width: 1, height: 1 });
  expect(inspectPngHeader(new Uint8Array([0, ...PNG]).subarray(1))).toEqual({
    width: 1,
    height: 1,
  });
});
test("rejects truncated, corrupt or oversized encoded PNG headers", () => {
  for (const length of [0, 8, 24, 32])
    expect(() => inspectPngHeader(PNG.subarray(0, length))).toThrow();
  for (const offset of [0, 11, 12, 16, 24, 25, 26, 27, 28, 29]) {
    const bytes = PNG.slice();
    bytes[offset] = 255;
    expect(() => inspectPngHeader(bytes)).toThrow();
  }
  const large = new Uint8Array(16 * 1024 * 1024 + 1);
  large.set(PNG);
  expect(() => inspectPngHeader(large)).toThrow();
});
test("crop removes exact source pixels and preserves the original", () => {
  const input = source();
  const before = input.pixels.slice();
  const result = transformScreenshot(input, { crop: { x: 1, y: 0, width: 2, height: 2 } });
  expect(result.width).toBe(2);
  expect(result.height).toBe(2);
  expect([...result.pixels]).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 17, 18, 19, 20, 21, 22, 23, 24]);
  result.pixels[0] = 0;
  expect(input.pixels).toEqual(before);
});
test("mask coordinates are crop-relative and erase every channel including alpha", () => {
  const result = transformScreenshot(source(), {
    crop: { x: 1, y: 0, width: 2, height: 2 },
    masks: [{ x: 0, y: 1, width: 1, height: 1 }],
  });
  expect([...result.pixels]).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 0, 0, 0, 255, 21, 22, 23, 24]);
});
test("annotation paints only the border and cannot overwrite a mask", () => {
  const input = { width: 3, height: 3, pixels: new Uint8Array(36).fill(91) };
  const result = transformScreenshot(input, {
    masks: [{ x: 0, y: 0, width: 1, height: 1 }],
    annotations: [{ x: 0, y: 0, width: 3, height: 3, thickness: 1, color: [255, 0, 0, 255] }],
  });
  expect([...result.pixels]).toEqual([
    0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 91, 91, 91, 91, 255, 0, 0, 255,
    255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255,
  ]);
  expect(input.pixels).toEqual(new Uint8Array(36).fill(91));
});
test("rejects invalid dimensions, mismatched byte lengths and oversized raw surfaces", () => {
  for (const width of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, 16_777_217]) {
    expect(() => transformScreenshot({ width, height: 1, pixels: new Uint8Array() }, {})).toThrow();
  }
  expect(() =>
    transformScreenshot({ width: 4096, height: 4097, pixels: new Uint8Array() }, {}),
  ).toThrow();
  expect(() =>
    transformScreenshot({ width: 1, height: 1, pixels: new Uint8Array(3) }, {}),
  ).toThrow();
});
test("rejects invalid crop and derivative geometry before changing the input", () => {
  for (const rectangle of [
    { x: -1, y: 0, width: 1, height: 1 },
    { x: 0.5, y: 0, width: 1, height: 1 },
    { x: 0, y: 0, width: 0, height: 1 },
    { x: 2, y: 1, width: 2, height: 1 },
    { x: Number.MAX_SAFE_INTEGER, y: 0, width: 1, height: 1 },
  ]) {
    for (const edit of [
      { crop: rectangle },
      { masks: [rectangle] },
      { annotations: [{ ...rectangle, thickness: 1, color: [255, 0, 0, 255] as const }] },
    ])
      expect(() => transformScreenshot(source(), edit)).toThrow();
  }
  expect(() =>
    transformScreenshot(source(), {
      crop: { x: 0, y: 0, width: 1, height: 1 },
      masks: [{ x: 1, y: 0, width: 1, height: 1 }],
    }),
  ).toThrow();
});
test("rejects excessive operations and invalid annotation thickness or colors", () => {
  const rectangle = { x: 0, y: 0, width: 1, height: 1 };
  expect(() => transformScreenshot(source(), { masks: Array(129).fill(rectangle) })).toThrow();
  expect(() =>
    transformScreenshot(source(), {
      annotations: Array(129).fill({ ...rectangle, thickness: 1, color: [0, 0, 0, 255] }),
    }),
  ).toThrow();
  for (const thickness of [0, -1, 1.5, 33])
    expect(() =>
      transformScreenshot(source(), {
        annotations: [{ ...rectangle, thickness, color: [0, 0, 0, 255] }],
      }),
    ).toThrow();
  for (const red of [-1, 256, 1.5, NaN])
    expect(() =>
      transformScreenshot(source(), {
        annotations: [{ ...rectangle, thickness: 1, color: [red, 0, 0, 255] }],
      }),
    ).toThrow();
});
test("no-op derivative owns a fresh buffer", () => {
  const input = source();
  const output = transformScreenshot(input, {});
  expect(output.pixels).toEqual(input.pixels);
  expect(output.pixels.buffer).not.toBe(input.pixels.buffer);
});

test("enforces the PNG decoded-pixel limit with independently checksummed headers", () => {
  // Header CRCs generated with Python zlib.crc32, not production validation code.
  const header = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, "hex"));
  for (const invalid of [
    "89504e470d0a1a0a0000000d494844520000100000001001080600000039fff7b2",
    "89504e470d0a1a0a0000000d4948445200000000000000010806000000f0d7afb7",
    "89504e470d0a1a0a0000000d4948445200000001010000010806000000086ed0ca",
  ])
    expect(() => inspectPngHeader(header(invalid))).toThrow();
  expect(
    inspectPngHeader(header("89504e470d0a1a0a0000000d4948445200001000000010000806000000f2a32417")),
  ).toEqual({ width: 4096, height: 4096 });
});

test("transforms in browser contexts without SharedArrayBuffer", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `delete globalThis.SharedArrayBuffer; const {transformScreenshot}=await import(${JSON.stringify(join(import.meta.dir, "pixels.ts"))}); const result=transformScreenshot({width:1,height:1,pixels:new Uint8Array([1,2,3,255])},{}); if(result.pixels[0]!==1)process.exit(2);`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(await child.exited).toBe(0);
});

test("bounds cumulative painting work before allocating a derivative", () => {
  const input = { width: 1024, height: 1024, pixels: new Uint8Array(1024 * 1024 * 4) };
  expect(() =>
    transformScreenshot(input, {
      masks: Array.from({ length: 128 }, () => ({ x: 0, y: 0, width: 1024, height: 1024 })),
    }),
  ).toThrow();
});
