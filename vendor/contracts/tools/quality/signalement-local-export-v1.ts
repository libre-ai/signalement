// Authority-fixture verifier only; no browser, privacy or implementation admission.
import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { canonicalJson } from "./authorized-execution";
import { parseStrictJson } from "./policy-core-raw-inputs";

export interface LogicalFile {
  path: string;
  kind: "file" | "symlink";
  bytes: Uint8Array;
}
interface Media {
  id: string;
  kind: "screenshot" | "video";
  capturedAt: string;
  derivation: { sourceId: string; operations: string[] };
  audioIncluded: boolean;
  audioReviewed: boolean;
  sanitation: "reviewed-with-limitations";
}
interface Manifest {
  payload: {
    dossierId: string;
    dossierRevision: number;
    createdAt: string;
    reviewedAt: string;
    document: { text: string; observationIds: string[] };
    observations: { id: string; provenance: string; capturedAt: string; mediaIds: string[] }[];
    hypotheses: { id: string }[];
    files: {
      path: string;
      role: string;
      mimeType: string;
      byteLength: number;
      sha256: string;
      media: Media | null;
    }[];
  };
  approval: { payloadDigest: string; approvedAt: string };
  exportedAt: string;
}
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validate = ajv.compile<Manifest>(
  await Bun.file(
    new URL("../../contracts/schemas/signalement-local-export.v1.schema.json", import.meta.url),
  ).json(),
);
function digest(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function hasLoneSurrogate(value: unknown): boolean {
  if (typeof value === "string")
    return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
  if (Array.isArray(value)) return value.some(hasLoneSurrogate);
  if (value !== null && typeof value === "object")
    return Object.entries(value).some(
      ([key, entry]) => hasLoneSurrogate(key) || hasLoneSurrogate(entry),
    );
  return false;
}
/** Input is parsed strict JSON, never arbitrary executable objects. Codes contain no dossier data. */
export function localExportFailures(manifest: unknown, files: readonly LogicalFile[]): string[] {
  if (!validate(manifest)) return ["manifest.schema"];
  if (hasLoneSurrogate(manifest)) return ["manifest.unicode"];
  const failures: string[] = [];
  const { payload, approval } = manifest;
  if (digest(canonicalJson(payload)) !== approval.payloadDigest)
    failures.push("approval.digest_mismatch");
  if (payload.reviewedAt !== approval.approvedAt || approval.approvedAt !== manifest.exportedAt)
    failures.push("approval.timestamp_mismatch");
  if (payload.createdAt > payload.reviewedAt) failures.push("payload.timestamp_order");
  if (files.length > 33) return [...failures, "file.count_limit"];
  const declared = new Set<string>();
  const ids = new Set<string>();
  const mediaIds = new Set<string>();
  let total = 0;
  let previous = "";
  let documents = 0;
  for (const file of payload.files) {
    if (declared.has(file.path)) failures.push("file.duplicate");
    if (previous >= file.path) failures.push("file.order");
    previous = file.path;
    declared.add(file.path);
    total += file.byteLength;
    const media = file.media;
    if (file.role === "document") {
      documents += 1;
      if (file.path !== "README.md" || file.mimeType !== "text/markdown" || media !== null)
        failures.push("document.type_mismatch");
      if (file.byteLength > 262144) failures.push("document.size_limit");
    } else if (media === null) failures.push("media.missing");
    else {
      if (ids.has(media.id)) failures.push("lineage.duplicate_id");
      ids.add(media.id);
      mediaIds.add(media.id);
      const extension =
        file.mimeType === "image/png" ? "png" : file.mimeType === "video/webm" ? "webm" : "mp4";
      if (
        file.role !== media.kind ||
        (media.kind === "screenshot"
          ? file.mimeType !== "image/png"
          : !["video/webm", "video/mp4"].includes(file.mimeType)) ||
        file.path !== `media/${media.id}.${extension}`
      )
        failures.push("media.type_mismatch");
      if (media.capturedAt > payload.reviewedAt) failures.push("media.timestamp_order");
      if (
        media.id === media.derivation.sourceId ||
        !media.derivation.operations.includes("metadata-removal")
      )
        failures.push("media.derivation");
      if (
        media.audioIncluded !== media.audioReviewed ||
        (media.kind === "screenshot" && media.audioIncluded) ||
        (media.audioIncluded && media.derivation.operations.includes("audio-removal"))
      )
        failures.push("media.audio");
    }
  }
  if (documents !== 1) failures.push("document.inventory");
  if (total > 268435456) failures.push("file.total_limit");
  const actual = new Set<string>();
  for (const file of files) {
    if (actual.has(file.path)) failures.push("file.duplicate");
    actual.add(file.path);
    if (file.kind !== "file") failures.push("file.not_regular");
    const entry = payload.files.find((candidate) => candidate.path === file.path);
    if (!entry) {
      failures.push("file.inventory_mismatch");
      continue;
    }
    if (file.bytes.byteLength !== entry.byteLength) {
      failures.push("file.length_mismatch");
      continue;
    }
    if (digest(file.bytes) !== entry.sha256) failures.push("file.digest_mismatch");
    if (
      entry.role === "document" &&
      !Buffer.from(file.bytes).equals(Buffer.from(payload.document.text, "utf8"))
    )
      failures.push("document.bytes_mismatch");
  }
  if (actual.size !== declared.size || [...declared].some((path) => !actual.has(path)))
    failures.push("file.inventory_mismatch");
  const observationIds = new Set<string>();
  for (const observation of payload.observations) {
    if (ids.has(observation.id)) failures.push("lineage.duplicate_id");
    ids.add(observation.id);
    observationIds.add(observation.id);
    if (observation.capturedAt < payload.createdAt || observation.capturedAt > payload.reviewedAt)
      failures.push("observation.timestamp_order");
    if (observation.provenance === "capture-observation" && observation.mediaIds.length === 0)
      failures.push("lineage.capture_required");
    for (const id of observation.mediaIds)
      if (!mediaIds.has(id)) failures.push("lineage.unknown_media");
  }
  for (const hypothesis of payload.hypotheses) {
    if (ids.has(hypothesis.id)) failures.push("lineage.duplicate_id");
    ids.add(hypothesis.id);
  }
  for (const id of payload.document.observationIds)
    if (!observationIds.has(id)) failures.push("lineage.unknown_observation");
  return [...new Set(failures)];
}

/** Raw manifest boundary: bounded UTF-8, duplicate-key refusal and depth budget. */
export function rawLocalExportFailures(bytes: Uint8Array, files: readonly LogicalFile[]): string[] {
  if (bytes.byteLength > 1048576) return ["manifest.size_limit"];
  let parsed: unknown;
  try {
    parsed = parseStrictJson(bytes, 16);
  } catch {
    return ["manifest.raw_json"];
  }
  return localExportFailures(parsed, files);
}
