import { transformScreenshot } from "./pixels";

// Synthetic maximum-size surface; no captured content is read or written.
const source = { width: 4096, height: 4096, pixels: new Uint8Array(4096 * 4096 * 4).fill(91) };
const samples: number[] = [];
for (let iteration = 0; iteration < 3; iteration += 1) {
  const started = performance.now();
  const result = transformScreenshot(source, {
    masks: [{ x: 0, y: 0, width: 4096, height: 4096 }],
  });
  samples.push(performance.now() - started);
  if (result.pixels[0] !== 0 || result.pixels.at(-1) !== 255 || source.pixels[0] !== 91) {
    throw new Error("Synthetic benchmark assertion failed");
  }
}
console.log(JSON.stringify({ pixels: 4096 * 4096, samplesMs: samples.map(Math.round) }));
