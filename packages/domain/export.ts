import { canonicalJson } from "../../vendor/contracts/tools/quality/authorized-execution.ts";
import validate from "./schema-validator.js";
import { type ArchiveFile, writeZip } from "./zip.ts";

export interface ReviewedMedia {
  id: string;
  sourceId: string;
  kind: "screenshot" | "video";
  mimeType: "image/png" | "video/webm" | "video/mp4";
  bytes: Uint8Array<ArrayBuffer>;
  capturedAt: string;
  operations: ("metadata-removal" | "redaction" | "crop" | "transcode" | "audio-removal")[];
  audioIncluded: boolean;
  audioReviewed: boolean;
}
export interface ExportInput {
  id: string;
  revision: number;
  createdAt: string;
  expected: string;
  observed: string;
  application: string;
  environment: string;
  steps: string[];
  media: ReviewedMedia[];
}
export interface ExportReview {
  readonly markdown: string;
  readonly manifest: string;
  readonly filenames: readonly string[];
  toZip(): Promise<Uint8Array<ArrayBuffer>>;
}
const encoder = new TextEncoder();
function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_{}[\]()#+.!|~:/=-]/g, "\\$&")
    .replace(/\r\n|\r|\n/g, " · ");
}
async function hash(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
}
function assertScalarStrings(value: unknown): void {
  if (
    typeof value === "string" &&
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
  )
    throw new Error("export.unicode");
  if (Array.isArray(value)) for (const item of value) assertScalarStrings(item);
  else if (value !== null && typeof value === "object")
    for (const item of Object.values(value)) assertScalarStrings(item);
}
/** Freeze the entire reviewed snapshot before the first asynchronous boundary. */
export async function buildReview(input: ExportInput, reviewedAt: string): Promise<ExportReview> {
  if (input.media.length > 32 || input.steps.length > 100) throw new Error("export.limit");
  let total = 0;
  for (const media of input.media) {
    if (
      !(media.bytes instanceof Uint8Array) ||
      !(media.bytes.buffer instanceof ArrayBuffer) ||
      media.bytes.length < 1 ||
      media.bytes.length > 67108864
    )
      throw new Error("export.media_size");
    total += media.bytes.length;
  }
  if (total > 268173312) throw new Error("export.total_size");
  const snapshot: ExportInput = {
    id: input.id,
    revision: input.revision,
    createdAt: input.createdAt,
    expected: input.expected,
    observed: input.observed,
    application: input.application,
    environment: input.environment,
    steps: [...input.steps],
    media: input.media.map((media) => ({
      id: media.id,
      sourceId: media.sourceId,
      kind: media.kind,
      mimeType: media.mimeType,
      bytes: new Uint8Array(media.bytes),
      capturedAt: media.capturedAt,
      operations: [...media.operations],
      audioIncluded: media.audioIncluded,
      audioReviewed: media.audioReviewed,
    })),
  };
  const markdown = [
    "# Reviewed local dossier",
    "",
    "## Expected — user statement",
    escapeText(snapshot.expected),
    "",
    "## Observed — user statement",
    escapeText(snapshot.observed),
    "",
    "## Context — user statement",
    `Application: ${escapeText(snapshot.application)}`,
    `Environment: ${escapeText(snapshot.environment)}`,
    "",
    "## Steps — user statement",
    ...snapshot.steps.map((step, index) => `${index + 1}. ${escapeText(step)}`),
    "",
    "## Approved media derivatives",
    ...snapshot.media.map(
      (media) => `- ${escapeText(media.id)} (${media.kind}); sanitation reviewed with limitations.`,
    ),
    "",
    "No reproduction or fix-verification verdict is asserted.",
    "",
  ].join("\n");
  const documentBytes = encoder.encode(markdown);
  if (documentBytes.length > 262144) throw new Error("export.document_size");
  const content: ArchiveFile[] = [{ path: "README.md", bytes: documentBytes }];
  const descriptors = [
    {
      path: "README.md",
      role: "document",
      mimeType: "text/markdown",
      byteLength: documentBytes.length,
      sha256: "0".repeat(64),
      media: null as null | {
        id: string;
        kind: string;
        capturedAt: string;
        derivation: { sourceId: string; operations: string[] };
        audioIncluded: boolean;
        audioReviewed: boolean;
        sanitation: string;
      },
    },
  ];
  const ids = new Set<string>();
  for (const media of snapshot.media) {
    if (ids.has(media.id)) throw new Error("export.duplicate_media");
    ids.add(media.id);
    if (
      media.capturedAt > reviewedAt ||
      media.sourceId === media.id ||
      !media.operations.includes("metadata-removal")
    )
      throw new Error("export.media_lineage");
    if (
      media.audioIncluded !== media.audioReviewed ||
      (media.kind === "screenshot" && media.audioIncluded) ||
      (media.audioIncluded && media.operations.includes("audio-removal"))
    )
      throw new Error("export.audio");
    if (
      (media.kind === "screenshot" && media.mimeType !== "image/png") ||
      (media.kind === "video" && !["video/mp4", "video/webm"].includes(media.mimeType))
    )
      throw new Error("export.media_type");
    const extension =
      media.mimeType === "image/png" ? "png" : media.mimeType === "video/webm" ? "webm" : "mp4";
    const path = `media/${media.id}.${extension}`;
    content.push({ path, bytes: media.bytes });
    descriptors.push({
      path,
      role: media.kind,
      mimeType: media.mimeType,
      byteLength: media.bytes.length,
      sha256: "0".repeat(64),
      media: {
        id: media.id,
        kind: media.kind,
        capturedAt: media.capturedAt,
        derivation: { sourceId: media.sourceId, operations: media.operations },
        audioIncluded: media.audioIncluded,
        audioReviewed: media.audioReviewed,
        sanitation: "reviewed-with-limitations",
      },
    });
  }
  descriptors.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const payload = {
    dossierId: snapshot.id,
    dossierRevision: snapshot.revision,
    createdAt: snapshot.createdAt,
    reviewedAt,
    statements: { expected: snapshot.expected, observed: snapshot.observed },
    context: {
      provenance: "user-statement",
      application: snapshot.application,
      environment: snapshot.environment,
      steps: snapshot.steps,
    },
    observations: [],
    hypotheses: [],
    document: { text: markdown, observationIds: [] },
    files: descriptors,
  };
  const manifestValue = {
    schemaVersion: "libre-ai.signalement-local-export.v1",
    payload,
    approval: { target: "local-export", payloadDigest: "0".repeat(64), approvedAt: reviewedAt },
    exportedAt: reviewedAt,
  };
  assertScalarStrings(manifestValue);
  if (!validate(manifestValue) || snapshot.createdAt > reviewedAt)
    throw new Error("export.contract");
  // No caller-owned object survives above; only this private snapshot crosses await.
  for (const descriptor of descriptors) {
    const file = content.find((file) => file.path === descriptor.path);
    if (!file) throw new Error("export.inventory");
    descriptor.sha256 = await hash(file.bytes);
  }
  manifestValue.approval.payloadDigest = await hash(encoder.encode(canonicalJson(payload)));
  const manifest = canonicalJson(manifestValue);
  const manifestBytes = encoder.encode(manifest);
  if (manifestBytes.length > 1048576) throw new Error("export.manifest_size");
  content.push({ path: "manifest.json", bytes: manifestBytes });
  const filenames = Object.freeze(content.map((file) => file.path).sort());
  return Object.freeze({
    markdown,
    manifest,
    filenames,
    async toZip() {
      return writeZip(content);
    },
  });
}
