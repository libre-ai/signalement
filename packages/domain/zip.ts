export interface ArchiveFile {
  readonly path: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
}
const MAX_CONTENT = 268435456;
const MAX_ARCHIVE = MAX_CONTENT + 1048576 + 16384;
const encoder = new TextEncoder();
// Preserve a leading BOM as a character so path validation rejects it; decoding
// must never repair an archive name into a different accepted name.
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const crcTable = Array.from({ length: 256 }, (_, initial) => {
  let value = initial;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
export function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ (crcTable[(value ^ byte) & 255] ?? 0);
  return (value ^ 0xffffffff) >>> 0;
}
function checkPath(path: string): void {
  if (
    !/^(README\.md|manifest\.json|media\/(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])\.)[a-z][a-z0-9-]{0,63}\.(png|webm|mp4))$/.test(
      path,
    )
  )
    throw new Error("archive.path");
}
function checkFiles(files: readonly ArchiveFile[]): void {
  if (files.length < 2 || files.length > 34) throw new Error("archive.count");
  const paths = new Set<string>();
  let total = 0;
  for (const file of files) {
    checkPath(file.path);
    if (paths.has(file.path)) throw new Error("archive.duplicate");
    paths.add(file.path);
    const limit =
      file.path === "manifest.json" ? 1048576 : file.path === "README.md" ? 262144 : 67108864;
    if (file.bytes.length < 1 || file.bytes.length > limit) throw new Error("archive.file_size");
    if (file.path !== "manifest.json") total += file.bytes.length;
  }
  if (total > MAX_CONTENT) throw new Error("archive.total_size");
  if (!paths.has("manifest.json") || !paths.has("README.md")) throw new Error("archive.inventory");
}
/** Deterministic store-only ZIP32: fixed DOS epoch, UTF-8 flag, no extras/comments. */
export function writeZip(files: readonly ArchiveFile[]): Uint8Array<ArrayBuffer> {
  checkFiles(files);
  const ordered = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const size =
    22 +
    ordered.reduce(
      (sum, file) => sum + 76 + encoder.encode(file.path).length * 2 + file.bytes.length,
      0,
    );
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  const central: { file: ArchiveFile; name: Uint8Array; crc: number; offset: number }[] = [];
  let offset = 0;
  for (const file of ordered) {
    const name = encoder.encode(file.path);
    const crc = crc32(file.bytes);
    central.push({ file, name, crc, offset });
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 0x800, true);
    view.setUint16(offset + 12, 33, true);
    view.setUint32(offset + 14, crc, true);
    view.setUint32(offset + 18, file.bytes.length, true);
    view.setUint32(offset + 22, file.bytes.length, true);
    view.setUint16(offset + 26, name.length, true);
    bytes.set(name, offset + 30);
    bytes.set(file.bytes, offset + 30 + name.length);
    offset += 30 + name.length + file.bytes.length;
  }
  const directoryOffset = offset;
  for (const entry of central) {
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, 0x800, true);
    view.setUint16(offset + 14, 33, true);
    view.setUint32(offset + 16, entry.crc, true);
    view.setUint32(offset + 20, entry.file.bytes.length, true);
    view.setUint32(offset + 24, entry.file.bytes.length, true);
    view.setUint16(offset + 28, entry.name.length, true);
    view.setUint32(offset + 42, entry.offset, true);
    bytes.set(entry.name, offset + 46);
    offset += 46 + entry.name.length;
  }
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 8, files.length, true);
  view.setUint16(offset + 10, files.length, true);
  view.setUint32(offset + 12, offset - directoryOffset, true);
  view.setUint32(offset + 16, directoryOffset, true);
  return bytes;
}
/** Accept only this bounded, unambiguous store-only profile; never extract to disk. */
export function readZip(input: Uint8Array<ArrayBuffer>): ArchiveFile[] {
  if (input.length < 22 || input.length > MAX_ARCHIVE) throw new Error("archive.size");
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const end = input.length - 22;
  if (
    view.getUint32(end, true) !== 0x06054b50 ||
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0 ||
    view.getUint16(end + 20, true) !== 0
  )
    throw new Error("archive.end");
  const count = view.getUint16(end + 10, true);
  const directory = view.getUint32(end + 16, true);
  const directorySize = view.getUint32(end + 12, true);
  if (
    count < 2 ||
    count > 34 ||
    view.getUint16(end + 8, true) !== count ||
    directory + directorySize !== end
  )
    throw new Error("archive.directory");
  let cursor = directory;
  let local = 0;
  const files: ArchiveFile[] = [];
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50)
      throw new Error("archive.central");
    const nameLength = view.getUint16(cursor + 28, true);
    const size = view.getUint32(cursor + 24, true);
    const crc = view.getUint32(cursor + 16, true);
    if (
      nameLength < 1 ||
      nameLength > 80 ||
      cursor + 46 + nameLength > end ||
      view.getUint16(cursor + 4, true) !== 20 ||
      view.getUint16(cursor + 6, true) !== 20 ||
      view.getUint16(cursor + 8, true) !== 0x800 ||
      view.getUint16(cursor + 10, true) !== 0 ||
      view.getUint16(cursor + 12, true) !== 0 ||
      view.getUint16(cursor + 14, true) !== 33 ||
      view.getUint32(cursor + 20, true) !== size ||
      view.getUint16(cursor + 30, true) !== 0 ||
      view.getUint16(cursor + 32, true) !== 0 ||
      view.getUint16(cursor + 34, true) !== 0 ||
      view.getUint16(cursor + 36, true) !== 0 ||
      view.getUint32(cursor + 38, true) !== 0 ||
      view.getUint32(cursor + 42, true) !== local
    )
      throw new Error("archive.profile");
    const path = decoder.decode(input.subarray(cursor + 46, cursor + 46 + nameLength));
    checkPath(path);
    if (
      local + 30 + nameLength + size > directory ||
      view.getUint32(local, true) !== 0x04034b50 ||
      view.getUint16(local + 4, true) !== 20 ||
      view.getUint16(local + 6, true) !== 0x800 ||
      view.getUint16(local + 8, true) !== 0 ||
      view.getUint16(local + 10, true) !== 0 ||
      view.getUint16(local + 12, true) !== 33 ||
      view.getUint32(local + 14, true) !== crc ||
      view.getUint32(local + 18, true) !== size ||
      view.getUint32(local + 22, true) !== size ||
      view.getUint16(local + 26, true) !== nameLength ||
      view.getUint16(local + 28, true) !== 0
    )
      throw new Error("archive.local");
    const localName = decoder.decode(input.subarray(local + 30, local + 30 + nameLength));
    if (localName !== path) throw new Error("archive.name_mismatch");
    const bytes = input.subarray(local + 30 + nameLength, local + 30 + nameLength + size);
    // Inspect lengths before copying; no unbounded allocation or decompression.
    files.push({ path, bytes });
    local += 30 + nameLength + size;
    cursor += 46 + nameLength;
  }
  if (cursor !== end || local !== directory) throw new Error("archive.trailing");
  checkFiles(files);
  let checkCursor = directory;
  for (const file of files) {
    if (crc32(file.bytes) !== view.getUint32(checkCursor + 16, true))
      throw new Error("archive.crc");
    checkCursor += 46 + encoder.encode(file.path).length;
  }
  return files.map((file) => ({ path: file.path, bytes: new Uint8Array(file.bytes) }));
}
