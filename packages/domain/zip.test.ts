import { expect, test } from "bun:test";
import { crc32, readZip, writeZip } from "./zip.ts";

const encoder = new TextEncoder();
function files() {
  return [
    { path: "README.md", bytes: encoder.encode("Synthetic") },
    { path: "manifest.json", bytes: encoder.encode("{}") },
  ];
}
test("CRC32 agrees with published check value and archives roundtrip", () => {
  expect(crc32(encoder.encode("123456789"))).toBe(0xcbf43926);
  expect(readZip(writeZip(files()))).toEqual(files());
});
test("rejects unsafe names, duplicates, missing manifest, counts and empty files", () => {
  for (const path of [
    "../README.md",
    "/README.md",
    "media/con.png",
    "media/x%2epng",
    "media/x\\y.png",
  ])
    expect(() =>
      writeZip([
        { path, bytes: encoder.encode("x") },
        files()[1] as ReturnType<typeof files>[number],
      ]),
    ).toThrow();
  expect(() =>
    writeZip([
      files()[0] as ReturnType<typeof files>[number],
      files()[0] as ReturnType<typeof files>[number],
    ]),
  ).toThrow("archive.duplicate");
  expect(() => writeZip([])).toThrow("archive.count");
  expect(() =>
    writeZip([
      { path: "README.md", bytes: new Uint8Array() },
      { path: "manifest.json", bytes: encoder.encode("{}") },
    ]),
  ).toThrow("archive.file_size");
  expect(() =>
    writeZip([
      { path: "README.md", bytes: encoder.encode("x") },
      { path: "media/x.png", bytes: encoder.encode("x") },
    ]),
  ).toThrow("archive.inventory");
});
test("refuses archive structural mutation, compression, links, offsets, names and CRC", () => {
  const original = writeZip(files());
  const end = original.length - 22;
  const central = new DataView(original.buffer).getUint32(end + 16, true);
  for (const offset of [
    0,
    4,
    6,
    8,
    10,
    12,
    14,
    18,
    22,
    26,
    28,
    30,
    central,
    central + 4,
    central + 6,
    central + 8,
    central + 10,
    central + 12,
    central + 14,
    central + 16,
    central + 20,
    central + 24,
    central + 28,
    central + 30,
    central + 32,
    central + 34,
    central + 36,
    central + 38,
    central + 42,
    central + 46,
    end,
    end + 4,
    end + 6,
    end + 8,
    end + 10,
    end + 12,
    end + 16,
    end + 20,
  ]) {
    const changed = new Uint8Array(original);
    changed[offset] = (changed[offset] ?? 0) ^ 1;
    expect(() => readZip(changed)).toThrow();
  }
  expect(() => readZip(new Uint8Array())).toThrow("archive.size");
  const payload = new Uint8Array(original);
  payload[39] = (payload[39] ?? 0) ^ 1;
  expect(() => readZip(payload)).toThrow("archive.crc");
});

test("parser rejects duplicate safe entries and undeclared trailing local bytes", () => {
  const original = writeZip([
    ...files(),
    { path: "media/aaa.png", bytes: encoder.encode("a") },
    { path: "media/bbb.png", bytes: encoder.encode("b") },
  ]);
  // Both names are safe and the lengths/CRC remain valid; duplicate membership
  // must be checked independently from archive structural consistency.
  const duplicate = new Uint8Array(original);
  // ZIP headers contain non-ASCII bytes, so locate exact bytes rather than text offsets.
  const needle = encoder.encode("media/bbb.png");
  for (let offset = 0; offset <= duplicate.length - needle.length; offset += 1) {
    if (needle.every((value, index) => duplicate[offset + index] === value))
      duplicate.set(encoder.encode("media/aaa.png"), offset);
  }
  expect(() => readZip(duplicate)).toThrow("archive.duplicate");
  const extra = new Uint8Array(original.length + 1);
  extra.set(original);
  expect(() => readZip(extra)).toThrow();
});

test("rejects a BOM-prefixed filename instead of repairing its UTF-8 identity", () => {
  const original = writeZip(files());
  const view = new DataView(original.buffer);
  const end = original.length - 22;
  const central = view.getUint32(end + 16, true);
  const secondCentral = central + 46 + view.getUint16(central + 28, true);
  const secondLocal = view.getUint32(secondCentral + 42, true);
  const nameLength = view.getUint16(secondCentral + 28, true);
  const localName = secondLocal + 30;
  const centralName = secondCentral + 46;
  const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
  const changed = new Uint8Array(original.length + 6);
  changed.set(original.subarray(0, localName));
  changed.set(bom, localName);
  changed.set(original.subarray(localName, centralName), localName + 3);
  changed.set(bom, centralName + 3);
  changed.set(original.subarray(centralName), centralName + 6);
  const updated = new DataView(changed.buffer);
  updated.setUint16(secondLocal + 26, nameLength + 3, true);
  updated.setUint16(secondCentral + 3 + 28, nameLength + 3, true);
  updated.setUint32(end + 6 + 12, view.getUint32(end + 12, true) + 3, true);
  updated.setUint32(end + 6 + 16, central + 3, true);
  expect(() => readZip(changed)).toThrow("archive.path");
});
