import { expect, test } from "bun:test";
import { sanitizeWebm } from "./video-container.ts";

function element(id: number, data: number[]): number[] {
  const hex = id.toString(16).padStart(id.toString(16).length + (id.toString(16).length % 2), "0");
  return [
    ...Uint8Array.fromHex(hex),
    ...(data.length < 127 ? [0x80 | data.length] : [0x40 | (data.length >> 8), data.length & 255]),
    ...data,
  ];
}
const text = (value: string) => Array.from(new TextEncoder().encode(value));
function fixture(
  extra: number[] = [],
  multipleUnknownClusters = false,
  trackExtra: number[] = [],
): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    ...element(0x1a45dfa3, element(0x4282, text("webm"))),
    ...element(0x18538067, [
      ...element(0x1549a966, [
        ...element(0x2ad7b1, [0x0f, 0x42, 0x40]),
        ...element(0x7ba9, text("SYNTHETIC_PRIVATE_TITLE")),
        ...extra,
      ]),
      ...element(
        0x1654ae6b,
        element(0xae, [
          ...element(0xd7, [1]),
          ...element(0x83, [1]),
          ...element(0x86, text("V_VP8")),
          ...trackExtra,
          ...element(0xe0, [...element(0xb0, [2]), ...element(0xba, [2])]),
        ]),
      ),
      ...(multipleUnknownClusters
        ? [0, 1].flatMap((time) => [
            0x1f,
            0x43,
            0xb6,
            0x75,
            0xff,
            ...element(0xe7, [time]),
            ...element(0xa3, [0x81, 0, 0, 0x80, 1]),
          ])
        : element(0x1f43b675, [...element(0xe7, [0]), ...element(0xa3, [0x81, 0, 0, 0x80, 1])])),
    ]),
  ]);
}
test("removes titles, dates and source software strings, replacing required software with constant", () => {
  const result = sanitizeWebm(fixture(element(0x4d80, text("SYNTHETIC_ENCODER_NAME"))), false);
  const decoded = new TextDecoder().decode(result);
  expect(decoded).not.toContain("SYNTHETIC");
  expect(decoded).toContain("signalement");
});
test("rejects unknown info elements and malformed sizes", () => {
  expect(() => sanitizeWebm(fixture(element(0x81, [1])), false)).toThrow();
  expect(() => sanitizeWebm(new Uint8Array([0x1a, 0x45]), false)).toThrow();
});

test("resolves consecutive unknown-size clusters at EBML element boundaries", () => {
  const clean = sanitizeWebm(fixture([], true), false);
  expect(sanitizeWebm(clean, false)).toEqual(clean);
});

test("drops native codec display names while rejecting unknown track fields", () => {
  const clean = sanitizeWebm(
    fixture([], false, element(0x258688, text("SYNTHETIC_CODEC_NAME"))),
    false,
  );
  expect(new TextDecoder().decode(clean)).not.toContain("SYNTHETIC_CODEC_NAME");
  expect(sanitizeWebm(clean, false)).toEqual(clean);
  expect(() => sanitizeWebm(fixture([], false, element(0x81, [1])), false)).toThrow();
});
