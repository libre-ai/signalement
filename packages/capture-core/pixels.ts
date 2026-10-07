export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}
export interface Rectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export interface BorderAnnotation extends Rectangle {
  readonly thickness: number;
  readonly color: readonly [number, number, number, 255];
}
export interface ScreenshotEdit {
  readonly crop?: Rectangle;
  readonly masks?: readonly Rectangle[];
  readonly annotations?: readonly BorderAnnotation[];
}

export const MAX_SCREENSHOT_PIXELS = 16_777_216;
export const MAX_ENCODED_SCREENSHOT_BYTES = 16 * 1024 * 1024;
const MAX_OPERATIONS = 128;
const MAX_PAINTED_PIXELS = MAX_SCREENSHOT_PIXELS * 4;
const MAX_BORDER_THICKNESS = 32;
const PNG_PREFIX = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];

function reject(): never {
  throw new Error("Invalid screenshot edit or media bounds");
}

function dimensions(width: number, height: number): number {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_SCREENSHOT_PIXELS / height
  )
    reject();
  return width * height;
}

/** Preflight only: the browser must still decode successfully and match these dimensions. */
export function inspectPngHeader(bytes: Uint8Array): { width: number; height: number } {
  if (
    bytes.byteLength < 33 ||
    bytes.byteLength > MAX_ENCODED_SCREENSHOT_BYTES ||
    PNG_PREFIX.some((value, index) => bytes[index] !== value)
  )
    reject();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  dimensions(width, height);
  const depth = bytes[24];
  const color = bytes[25];
  const validDepths =
    color === 0
      ? [1, 2, 4, 8, 16]
      : color === 3
        ? [1, 2, 4, 8]
        : color === 2 || color === 4 || color === 6
          ? [8, 16]
          : [];
  if (
    depth === undefined ||
    !validDepths.includes(depth) ||
    bytes[26] !== 0 ||
    bytes[27] !== 0 ||
    (bytes[28] !== 0 && bytes[28] !== 1)
  )
    reject();
  let crc = 0xffffffff;
  for (let offset = 12; offset < 29; offset += 1) {
    crc ^= bytes[offset] ?? 0;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
  }
  if ((crc ^ 0xffffffff) >>> 0 !== view.getUint32(29)) reject();
  return { width, height };
}

function validateRectangle(rectangle: Rectangle, width: number, height: number): void {
  dimensions(rectangle.width, rectangle.height);
  if (
    !Number.isSafeInteger(rectangle.x) ||
    !Number.isSafeInteger(rectangle.y) ||
    rectangle.x < 0 ||
    rectangle.y < 0 ||
    rectangle.x > width - rectangle.width ||
    rectangle.y > height - rectangle.height
  )
    reject();
}

function paint(image: RgbaImage, rectangle: Rectangle, color: readonly number[]): void {
  for (let y = rectangle.y; y < rectangle.y + rectangle.height; y += 1) {
    for (let x = rectangle.x; x < rectangle.x + rectangle.width; x += 1) {
      image.pixels.set(color, (y * image.width + x) * 4);
    }
  }
}

/** Mask and annotation coordinates refer to the cropped image, never the source viewport. */
export function transformScreenshot(source: RgbaImage, edit: ScreenshotEdit): RgbaImage {
  const pixelCount = dimensions(source.width, source.height);
  if (
    !(source.pixels instanceof Uint8Array) ||
    source.pixels.byteLength !== pixelCount * 4 ||
    (typeof SharedArrayBuffer !== "undefined" && source.pixels.buffer instanceof SharedArrayBuffer)
  )
    reject();
  const crop = edit.crop ?? { x: 0, y: 0, width: source.width, height: source.height };
  validateRectangle(crop, source.width, source.height);
  const masks = edit.masks ?? [];
  const annotations = edit.annotations ?? [];
  if (masks.length > MAX_OPERATIONS || annotations.length > MAX_OPERATIONS) reject();
  for (const mask of masks) validateRectangle(mask, crop.width, crop.height);
  for (const annotation of annotations) {
    validateRectangle(annotation, crop.width, crop.height);
    if (
      !Number.isSafeInteger(annotation.thickness) ||
      annotation.thickness < 1 ||
      annotation.thickness > MAX_BORDER_THICKNESS ||
      annotation.color.length !== 4 ||
      annotation.color[3] !== 255 ||
      annotation.color.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)
    )
      reject();
  }
  let paintedPixels = crop.width * crop.height;
  for (const mask of masks) paintedPixels += mask.width * mask.height * 2;
  for (const annotation of annotations) {
    paintedPixels += 2 * Math.min(annotation.thickness, annotation.height) * annotation.width;
    paintedPixels += 2 * Math.min(annotation.thickness, annotation.width) * annotation.height;
  }
  if (paintedPixels > MAX_PAINTED_PIXELS) reject();
  const output: RgbaImage = {
    width: crop.width,
    height: crop.height,
    pixels: new Uint8Array(crop.width * crop.height * 4),
  };
  for (let row = 0; row < crop.height; row += 1) {
    const start = ((crop.y + row) * source.width + crop.x) * 4;
    output.pixels.set(source.pixels.subarray(start, start + crop.width * 4), row * crop.width * 4);
  }
  for (const mask of masks) paint(output, mask, [0, 0, 0, 255]);
  for (const annotation of annotations) {
    const vertical = Math.min(annotation.thickness, annotation.height);
    const horizontal = Math.min(annotation.thickness, annotation.width);
    paint(output, { ...annotation, height: vertical }, annotation.color);
    paint(
      output,
      { ...annotation, y: annotation.y + annotation.height - vertical, height: vertical },
      annotation.color,
    );
    paint(output, { ...annotation, width: horizontal }, annotation.color);
    paint(
      output,
      { ...annotation, x: annotation.x + annotation.width - horizontal, width: horizontal },
      annotation.color,
    );
  }
  // Reapply black masks so annotation overlap cannot weaken the reviewed redaction boundary.
  for (const mask of masks) paint(output, mask, [0, 0, 0, 255]);
  return output;
}
