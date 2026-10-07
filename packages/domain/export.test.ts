import { expect, test } from "bun:test";
import { buildReview, type ExportInput } from "./export.ts";

export function syntheticInput(): ExportInput {
  return {
    id: "dossier-synthetic",
    revision: 1,
    createdAt: "2026-10-07T10:00:00Z",
    expected: "Panel visible",
    observed: "No panel",
    application: "Synthetic app",
    environment: "Synthetic browser",
    steps: ["Open panel"],
    media: [],
  };
}
const reviewedAt = "2026-10-07T10:01:00Z";
test("freezes all inputs before its first await and returns fresh deterministic archives", async () => {
  const input = syntheticInput();
  input.media.push({
    id: "image-one",
    sourceId: "source-one",
    kind: "screenshot",
    mimeType: "image/png",
    bytes: new Uint8Array([1, 2, 3]),
    capturedAt: input.createdAt,
    operations: ["metadata-removal"],
    audioIncluded: false,
    audioReviewed: false,
  });
  const promise = buildReview(input, reviewedAt);
  input.expected = "Changed";
  input.steps.push("Changed");
  const media = input.media[0];
  if (!media) throw new Error("Missing fixture");
  media.bytes.fill(9);
  media.operations.push("crop");
  const review = await promise;
  expect(review.markdown).toContain("Panel visible");
  expect(review.markdown).not.toContain("Changed");
  const manifest = JSON.parse(review.manifest);
  expect(manifest.payload.files[1].sha256).toBe(
    "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
  );
  expect(manifest.payload.files[1].media.derivation.operations).toEqual(["metadata-removal"]);
  const first = await review.toZip();
  const second = await review.toZip();
  expect(first).toEqual(second);
  first.fill(0);
  expect(await review.toZip()).toEqual(second);
  expect(review.filenames).toEqual(["README.md", "manifest.json", "media/image-one.png"]);
  expect(Object.isFrozen(review)).toBe(true);
  expect(Object.isFrozen(review.filenames)).toBe(true);
});
test("escapes HTML, markdown images and remote links in plain user text", async () => {
  const input = syntheticInput();
  input.expected = '<img src="https://example.invalid/a"> ![x](https://example.invalid/b)';
  const review = await buildReview(input, reviewedAt);
  expect(review.markdown).not.toContain("<img");
  expect(review.markdown).not.toContain("![x](");
  expect(review.markdown).toContain("&lt;img");
});
test("rejects invalid identifiers, time order, media and limits", async () => {
  for (const mutation of [
    (input: ExportInput) => {
      input.id = "../bad";
    },
    (input: ExportInput) => {
      input.revision = 0;
    },
    (input: ExportInput) => {
      input.createdAt = "2026-10-07T11:00:00Z";
    },
    (input: ExportInput) => {
      input.expected = "x".repeat(4097);
    },
  ]) {
    const input = syntheticInput();
    mutation(input);
    await expect(buildReview(input, reviewedAt)).rejects.toThrow();
  }
});

test("rejects unreviewed media, duplicate lineage and malformed scalar strings", async () => {
  for (const kind of [
    "duplicate",
    "audio",
    "source",
    "future",
    "metadata",
    "mime",
    "empty",
    "reserved",
    "unicode",
  ] as const) {
    const input = syntheticInput();
    const media = {
      id: "image-one",
      sourceId: "source-one",
      kind: "screenshot" as const,
      mimeType: "image/png" as const,
      bytes: new Uint8Array([1]),
      capturedAt: input.createdAt,
      operations: ["metadata-removal" as const],
      audioIncluded: false,
      audioReviewed: false,
    };
    input.media.push(media);
    if (kind === "duplicate") input.media.push(media);
    if (kind === "audio") media.audioIncluded = true;
    if (kind === "source") media.sourceId = media.id;
    if (kind === "future") media.capturedAt = "2026-10-07T11:00:00Z";
    if (kind === "metadata") media.operations = [];
    if (kind === "mime") input.media[0] = { ...media, mimeType: "video/webm" };
    if (kind === "empty") media.bytes = new Uint8Array();
    if (kind === "reserved") media.id = "con";
    if (kind === "unicode") input.observed = "\ud800";
    await expect(buildReview(input, reviewedAt)).rejects.toThrow();
  }
});
test("bundles the browser consumer without Bun, Node crypto, eval or dynamic compilation", async () => {
  const result = await Bun.build({
    entrypoints: [new URL("./export.ts", import.meta.url).pathname],
    target: "browser",
    minify: true,
  });
  expect(result.success).toBe(true);
  const output = result.outputs[0];
  if (!output) throw new Error("Missing bundle");
  const source = await output.text();
  expect(source).not.toContain("Bun.");
  expect(source).not.toContain("node:crypto");
  expect(source).not.toMatch(/new Function\b|eval\(/);
});
