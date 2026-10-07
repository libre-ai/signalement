# Screenshot pixel core

`pixels.ts` is browser-independent internal implementation, not a public export
contract. It accepts already-decoded RGBA bytes and returns a fresh buffer.

## Adapter sequence

1. Reject encoded media above 16 MiB before decoding or constructing a canvas.
2. Call `inspectPngHeader(encoded)` to validate the complete IHDR, CRC, legal PNG
   color/depth combination and at most 16,777,216 decoded pixels (64 MiB RGBA).
   This is header preflight, not a complete PNG parser or decode verdict.
3. Decode using the browser, confirm decoded dimensions match preflight, obtain
   RGBA bytes, and call `transformScreenshot`.
4. Encode the resulting pixels into a new PNG, bound its encoded length, and
   preview those exact derivative bytes. Never export a CSS overlay as redaction.
   Any edit must invalidate prior approval; approval management belongs to the caller.

All rectangles use integer **pixel** coordinates with exclusive right/bottom edges.
Crop coordinates refer to the original image. Mask and annotation coordinates refer
only to the cropped result. Geometry outside the relevant image is rejected, never
silently clipped. CSS units and device pixel ratios must be converted explicitly by
the adapter. Input bytes remain unchanged, including on validation failure.

```ts
const derivative = transformScreenshot(original, {
  crop: { x: 100, y: 50, width: 640, height: 480 },
  masks: [{ x: 10, y: 20, width: 200, height: 30 }],
  annotations: [{ x: 250, y: 100, width: 80, height: 60,
    thickness: 2, color: [255, 0, 0, 255] }],
});
```

This mask covers original pixels x=110..309 and y=70..99. Masking replaces all four
channels with opaque black. Annotations draw opaque borders after masking; masks
are reapplied so overlapping annotations cannot alter masked pixels. A border
thicker than its rectangle fills the rectangle. At most 128 masks and 128
annotations are admitted; border thickness is 1..32 pixels. The total crop and
painting work is capped at 67,108,864 pixel writes, checked before output allocation.
Shared mutable raw buffers are rejected.

Tests use exact synthetic pixel canaries and independent PNG CRC fixtures. They do
not qualify any browser's capture permission, screenshot codec, or recording API.

Run `bun test packages/capture-core --coverage` for the pixel oracle suite and
`bun packages/capture-core/pixels.bench.ts` for the synthetic maximum-size hot path.
The benchmark reports local samples, not branded-browser performance qualification.
