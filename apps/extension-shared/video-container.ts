// Restricted native-encoder WebM profile. Matroska IDs: https://www.matroska.org/technical/elements.html
interface Element {
  id: number;
  data: Uint8Array<ArrayBuffer>;
}
const MAX_BYTES = 64 * 1024 ** 2;
function fail(): never {
  throw new Error("Conteneur vidéo hors profil sûr");
}
function join(parts: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const length = parts.reduce((n, p) => n + p.length, 0);
  if (length > MAX_BYTES) fail();
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
interface Header {
  id: number;
  start: number;
  size: number | null;
}
function header(bytes: Uint8Array<ArrayBuffer>, position: number): Header {
  let offset = position;
  const first = bytes[offset];
  if (first === undefined || first === 0) fail();
  let idLength = 1;
  while (idLength <= 4 && (first & (0x80 >> (idLength - 1))) === 0) idLength++;
  if (idLength > 4) fail();
  let id = 0;
  for (let i = 0; i < idLength; i++) id = id * 256 + (bytes[offset++] ?? fail());
  const firstSize = bytes[offset++] ?? fail();
  if (firstSize === 0) fail();
  let length = 1;
  while (length <= 8 && (firstSize & (0x80 >> (length - 1))) === 0) length++;
  if (length > 8) fail();
  let size = BigInt(firstSize & ((0x80 >> (length - 1)) - 1));
  for (let i = 1; i < length; i++) size = size * 256n + BigInt(bytes[offset++] ?? fail());
  if (size === (1n << BigInt(7 * length)) - 1n) return { id, start: offset, size: null };
  if (size > BigInt(bytes.length - offset)) fail();
  return { id, start: offset, size: Number(size) };
}
const segmentElements = new Set([
  0x1549a966, 0x1654ae6b, 0x1f43b675, 0x114d9b74, 0x1c53bb6b, 0x1254c367, 0x1941a469, 0x1043a770,
]);
function parse(bytes: Uint8Array<ArrayBuffer>, segment = false): Element[] {
  const result: Element[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (result.length > 100000) fail();
    const item = header(bytes, offset);
    let end = item.size === null ? bytes.length : item.start + item.size;
    if (item.size === null) {
      if (item.id === 0x1f43b675 && segment) {
        // Unknown-size clusters end at the next level-one element, never at a byte-pattern inside a block.
        let scan = item.start;
        let count = 0;
        while (scan < bytes.length) {
          if (count++ > 100000) fail();
          const child = header(bytes, scan);
          if (segmentElements.has(child.id)) break;
          if (child.size === null) fail();
          scan = child.start + child.size;
        }
        end = scan;
      } else if (item.id !== 0x18538067) fail();
    }
    result.push({ id: item.id, data: bytes.slice(item.start, end) });
    offset = end;
  }
  return result;
}
function pack(id: number, data: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  let hex = id.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const idBytes = Uint8Array.fromHex(hex);
  let length = 1;
  while (data.length >= 2 ** (7 * length) - 1) length++;
  const size = new Uint8Array(length);
  let value = data.length;
  for (let i = length - 1; i >= 0; i--) {
    size[i] = value % 256;
    value = Math.floor(value / 256);
  }
  size[0] = (size[0] ?? 0) | (1 << (8 - length));
  return join([idBytes, size, data]);
}
function encoded(e: Element) {
  return pack(e.id, e.data);
}
function filtered(
  data: Uint8Array<ArrayBuffer>,
  keep: Set<number>,
  drop: Set<number>,
): Uint8Array<ArrayBuffer> {
  return join(
    parse(data).flatMap((e) => (keep.has(e.id) ? [encoded(e)] : drop.has(e.id) ? [] : fail())),
  );
}
const software = new TextEncoder().encode("signalement");
function info(data: Uint8Array<ArrayBuffer>) {
  const clean = filtered(
    data,
    new Set([0x2ad7b1, 0x4489]),
    new Set([0x4461, 0x7ba9, 0x73a4, 0x7384, 0x4d80, 0x5741, 0xbf, 0xec]),
  );
  return join([clean, pack(0x4d80, software), pack(0x5741, software)]);
}
function uint(data: Uint8Array<ArrayBuffer>): number {
  if (data.length < 1 || data.length > 4) fail();
  return data.reduce((n, b) => n * 256 + b, 0);
}
function tracks(data: Uint8Array<ArrayBuffer>, audio: boolean): Uint8Array<ArrayBuffer> {
  let videoCount = 0;
  let audioCount = 0;
  const result = parse(data).map((track) => {
    if (track.id !== 0xae) fail();
    const fields = parse(track.data);
    const kind = uint(fields.find((e) => e.id === 0x83)?.data ?? fail());
    const codec = new TextDecoder().decode(fields.find((e) => e.id === 0x86)?.data ?? fail());
    if (kind === 1 && ["V_VP8", "V_VP9"].includes(codec)) videoCount++;
    else if (kind === 2 && audio && codec === "A_OPUS") audioCount++;
    else fail();
    const number = fields.find((e) => e.id === 0xd7)?.data ?? fail();
    const parts = fields.flatMap((e) => {
      if (e.id === 0x73c5) return [];
      if (e.id === 0x55ee) return [];
      if (e.id === 0xe0)
        return [
          pack(
            e.id,
            filtered(
              e.data,
              new Set([0xb0, 0xba, 0x54b0, 0x54ba, 0x54b2, 0x9a]),
              new Set([0x55b0, 0x7670, 0x53c0, 0xbf, 0xec]),
            ),
          ),
        ];
      if (e.id === 0xe1)
        return [
          pack(
            e.id,
            filtered(e.data, new Set([0xb5, 0x78b5, 0x9f, 0x6264]), new Set([0xbf, 0xec])),
          ),
        ];
      // CodecName is optional free-form text; CodecID alone controls decoding.
      if ([0x536e, 0x258688, 0x22b59c, 0x22b59d, 0xbf, 0xec].includes(e.id)) return [];
      if (
        ![0xd7, 0x83, 0x86, 0x63a2, 0x9c, 0x88, 0x55aa, 0xb9, 0x23e383, 0x56aa, 0x56bb].includes(
          e.id,
        )
      )
        fail();
      if (
        e.id === 0x63a2 &&
        (codec !== "A_OPUS" ||
          e.data.length !== 19 ||
          new TextDecoder().decode(e.data.slice(0, 8)) !== "OpusHead")
      )
        fail();
      return [encoded(e)];
    });
    parts.push(pack(0x73c5, number));
    return pack(0xae, join(parts));
  });
  if (videoCount !== 1 || audioCount > (audio ? 1 : 0) || (audio && audioCount !== 1)) fail();
  return join(result);
}
function cluster(data: Uint8Array<ArrayBuffer>) {
  return join(
    parse(data).flatMap((e) => {
      if ([0xe7, 0xa3].includes(e.id)) return [encoded(e)];
      if (e.id === 0xa0)
        return [
          pack(e.id, filtered(e.data, new Set([0xa1, 0x9b, 0xfb, 0x75a2]), new Set([0xbf, 0xec]))),
        ];
      if ([0xa7, 0xab, 0xbf, 0xec].includes(e.id)) return [];
      return fail();
    }),
  );
}
/** Only call on fresh decode/canvas/reencode output, never as a substitute for pixel sanitation. */
export function sanitizeWebm(
  bytes: Uint8Array<ArrayBuffer>,
  audio: boolean,
): Uint8Array<ArrayBuffer> {
  if (bytes.length === 0 || bytes.length > MAX_BYTES) fail();
  const roots = parse(bytes);
  if (roots.length !== 2 || roots[0]?.id !== 0x1a45dfa3 || roots[1]?.id !== 0x18538067) fail();
  const header = filtered(
    roots[0].data,
    new Set([0x4286, 0x42f7, 0x42f2, 0x42f3, 0x4282, 0x4287, 0x4285]),
    new Set([0xbf, 0xec]),
  );
  const doctype = parse(header).find((e) => e.id === 0x4282);
  if (new TextDecoder().decode(doctype?.data) !== "webm") fail();
  let infos = 0,
    tracksets = 0,
    clusters = 0;
  const body = join(
    parse(roots[1].data, true).flatMap((e) => {
      if (e.id === 0x1549a966) {
        infos++;
        return [pack(e.id, info(e.data))];
      }
      if (e.id === 0x1654ae6b) {
        tracksets++;
        return [pack(e.id, tracks(e.data, audio))];
      }
      if (e.id === 0x1f43b675) {
        clusters++;
        return [pack(e.id, cluster(e.data))];
      }
      if ([0x114d9b74, 0x1c53bb6b, 0x1254c367, 0x1941a469, 0x1043a770, 0xec, 0xbf].includes(e.id))
        return [];
      return fail();
    }),
  );
  if (infos !== 1 || tracksets !== 1 || clusters < 1) fail();
  return join([pack(0x1a45dfa3, header), pack(0x18538067, body)]);
}
/** Structural diagnostics only: never returns payload bytes or strings. */
export function webmStructure(bytes: Uint8Array<ArrayBuffer>): string[] {
  const rows: string[] = [];
  const masters = new Set([
    0x1a45dfa3, 0x18538067, 0x1549a966, 0x1654ae6b, 0xae, 0xe0, 0xe1, 0x1f43b675, 0xa0,
  ]);
  function walk(data: Uint8Array<ArrayBuffer>, depth: number) {
    if (depth > 5) fail();
    for (const e of parse(data, true)) {
      if (rows.length > 128) return;
      rows.push(`${depth}:${e.id.toString(16)}`);
      if (masters.has(e.id)) walk(e.data, depth + 1);
    }
  }
  walk(bytes, 0);
  return rows;
}
