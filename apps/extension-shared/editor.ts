import type { Rectangle, ScreenshotEdit } from "../../packages/capture-core/pixels.ts";
import {
  buildReview,
  type ExportInput,
  type ExportReview,
  type ReviewedMedia,
} from "../../packages/domain/export.ts";
import { IndexedDbStore } from "../../packages/draft-storage/indexeddb.ts";
import { type Attachment, DraftVault } from "../../packages/draft-storage/vault.ts";
import { decodeCapture, editPng, Recording } from "./browser-media.ts";

import { type SanitizedVideo, sanitizeVideo } from "./video-sanitizer.ts";
import { PlaybackReview, videoReadyForExport } from "./video-state.ts";

declare const chrome: {
  runtime: { sendMessage(value: unknown): Promise<{ ok: boolean; data: string | null }> };
};
declare const browser: typeof chrome;
function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error("Élément manquant");
  return value as T;
}
const input = (id: string) => element<HTMLInputElement | HTMLTextAreaElement>(id);
const fields = ["expected", "observed", "application", "environment", "steps"];
const urls = new Map<string, string>();
let original: Uint8Array<ArrayBuffer> | null = null;
let derivative: Uint8Array<ArrayBuffer> | null = null;
let operations: ReviewedMedia["operations"] = [];
let captureId = `source-${crypto.randomUUID()}`;
let capturedAt = utc();
let dossierId = `d-${crypto.randomUUID()}`;
let createdAt = utc();
let revision = 1;
let savedRevision: number | null = null;
let review: ExportReview | null = null;
let generation = 0;
let videoPresent = false;
let videoOriginal: Blob | null = null;
let videoAudioCaptured = false;
let videoDerivative: SanitizedVideo | null = null;
let videoMasks: Rectangle[] = [];
let videoPlayed = false;
let playback = new PlaybackReview();
let videoSourceId = `source-${crypto.randomUUID()}`;
let videoCapturedAt = utc();
let sanitation: AbortController | null = null;
function resetVideoReview() {
  playback = new PlaybackReview();
  videoPlayed = false;
  element<HTMLInputElement>("video-reviewed").checked = false;
  element<HTMLInputElement>("audio-reviewed").checked = false;
}
function readyVideo() {
  return videoReadyForExport({
    present: videoPresent,
    sanitized: videoDerivative !== null,
    played: videoPlayed,
    reviewed: element<HTMLInputElement>("video-reviewed").checked,
    audioIncluded: videoDerivative?.audioIncluded ?? false,
    audioReviewed: element<HTMLInputElement>("audio-reviewed").checked,
  });
}
let vault: DraftVault | null = null;
let pendingOperations = 0;
let capturePending = location.hash.length > 1;
const recording = new Recording();
function utc() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
function status(message: string) {
  element("status").textContent = message;
}
function showBlob(id: string, bytes: Uint8Array<ArrayBuffer> | Blob | null, mime = "image/png") {
  const old = urls.get(id);
  if (old) URL.revokeObjectURL(old);
  urls.delete(id);
  const target = element<HTMLImageElement | HTMLVideoElement>(id);
  if (target instanceof HTMLVideoElement) target.pause();
  target.removeAttribute("src");
  if (target instanceof HTMLVideoElement) target.load();
  target.hidden = bytes === null;
  if (bytes !== null) {
    const url = URL.createObjectURL(
      bytes instanceof Blob ? bytes : new Blob([bytes], { type: mime }),
    );
    urls.set(id, url);
    target.src = url;
  }
}
function invalidate() {
  generation++;
  revision++;
  review = null;
  element("review").hidden = true;
  element<HTMLInputElement>("approved").checked = false;
  for (const id of ["markdown", "manifest", "files"]) element(id).textContent = "";
  showBlob("review-image", null);
  showBlob("review-video", null);
}
function bind(id: string, action: () => Promise<void> | void) {
  element(id).addEventListener("click", async () => {
    if (pendingOperations > 0 && !["lock", "stop", "remove-video"].includes(id)) {
      status("Une opération est déjà en cours.");
      return;
    }
    pendingOperations++;
    try {
      await action();
    } catch {
      status(
        "Opération refusée ou indisponible. Vérifiez la phrase, les droits, les limites et l’état du brouillon. Aucune réussite n’est présumée.",
      );
    } finally {
      pendingOperations--;
    }
  });
}
function clear() {
  recording.cancel();
  sanitation?.abort();
  sanitation = null;
  videoOriginal = null;
  videoAudioCaptured = false;
  videoDerivative = null;
  videoMasks = [];
  element("video-masks").textContent = "Aucun masque vidéo.";
  element<HTMLInputElement>("keep-audio").checked = false;
  element<HTMLInputElement>("keep-audio").disabled = true;
  for (const id of ["x", "y"]) input(id).value = "0";
  for (const id of ["width", "height"]) input(id).value = "100";
  resetVideoReview();
  videoPresent = false;
  vault?.lock();
  original = null;
  derivative = null;
  operations = [];
  savedRevision = null;
  invalidate();
  for (const id of fields) input(id).value = "";
  input("passphrase").value = "";
  element<HTMLInputElement>("audio").checked = false;
  for (const id of ["screenshot", "review-image", "video", "review-video"]) showBlob(id, null);
  element("drafts").replaceChildren();
  element("recording-state").textContent = "Verrouillé. Pistes arrêtées.";
  dossierId = `d-${crypto.randomUUID()}`;
  captureId = `source-${crypto.randomUUID()}`;
  createdAt = utc();
  capturedAt = utc();
}
for (const id of [...fields, "retention", "audio", "video-reviewed", "audio-reviewed"])
  input(id).addEventListener("input", invalidate);
bind("lock", () => {
  clear();
  status("Coffre verrouillé et écran effacé.");
});
window.addEventListener("pagehide", clear);
function rectangle() {
  return {
    x: Number(input("x").value),
    y: Number(input("y").value),
    width: Number(input("width").value),
    height: Number(input("height").value),
  };
}
async function transform(edit: ScreenshotEdit, operation: "crop" | "redaction" | null) {
  if (!derivative) throw new Error("Aucune capture");
  const before = generation;
  const bytes = await editPng(derivative, edit);
  if (before !== generation) return;
  derivative = bytes;
  if (operation && !operations.includes(operation)) operations.push(operation);
  invalidate();
  showBlob("screenshot", derivative);
  status("Pixels modifiés. La revue précédente est invalidée.");
}
bind("crop", () => transform({ crop: rectangle() }, "crop"));
bind("mask", () => transform({ masks: [rectangle()] }, "redaction"));
bind("annotate", () =>
  transform({ annotations: [{ ...rectangle(), thickness: 3, color: [255, 0, 0, 255] }] }, null),
);
bind("remove-image", () => {
  original = null;
  derivative = null;
  operations = [];
  invalidate();
  showBlob("screenshot", null);
});
bind("record", async () => {
  invalidate();
  sanitation?.abort();
  videoOriginal = null;
  videoAudioCaptured = false;
  videoDerivative = null;
  videoMasks = [];
  resetVideoReview();
  showBlob("video", null);
  videoPresent = true;
  videoSourceId = `source-${crypto.randomUUID()}`;
  videoCapturedAt = utc();
  await recording.start(
    element<HTMLInputElement>("audio").checked,
    (message, blob, audioCaptured) => {
      element("recording-state").textContent = message;
      if (blob) {
        videoOriginal = blob;
        videoAudioCaptured = audioCaptured === true;
        showBlob("video", blob);
        element<HTMLInputElement>("keep-audio").checked = false;
        element<HTMLInputElement>("keep-audio").disabled = !audioCaptured;
      }
    },
  );
});
bind("video-mask", () => {
  videoMasks.push(rectangle());
  videoDerivative = null;
  resetVideoReview();
  invalidate();
  element("video-masks").textContent = JSON.stringify(videoMasks);
});
bind("clear-video-masks", () => {
  videoMasks = [];
  videoDerivative = null;
  resetVideoReview();
  invalidate();
  element("video-masks").textContent = "Aucun masque vidéo.";
});
element("keep-audio").addEventListener("input", () => {
  videoDerivative = null;
  resetVideoReview();
  invalidate();
});
element<HTMLVideoElement>("video").addEventListener("ended", () => {
  if (videoDerivative) videoPlayed = playback.ended();
});
element<HTMLVideoElement>("video").addEventListener("seeking", () => {
  videoPlayed = false;
  playback.seek();
});
element<HTMLVideoElement>("video").addEventListener("play", () =>
  playback.play(element<HTMLVideoElement>("video").currentTime),
);
element<HTMLVideoElement>("video").addEventListener("timeupdate", () => {
  const video = element<HTMLVideoElement>("video");
  playback.time(video.currentTime, video.playbackRate);
});
bind("sanitize-video", async () => {
  if (!videoOriginal) throw new Error("Aucune source vidéo");
  invalidate();
  resetVideoReview();
  const epoch = generation;
  sanitation?.abort();
  const controller = new AbortController();
  sanitation = controller;
  element("recording-state").textContent =
    "Réencodage des pixels et filtrage du conteneur en cours…";
  const result = await sanitizeVideo(
    videoOriginal,
    element<HTMLInputElement>("keep-audio").checked,
    structuredClone(videoMasks),
    controller.signal,
  );
  if (epoch !== generation) return;
  videoDerivative = result;
  showBlob("video", result.bytes, "video/webm");
  element("recording-state").textContent =
    "Dérivé assaini prêt. Lisez toute la vidéo puis confirmez sa revue et celle de l’audio inclus.";
});
bind("pause", () => {
  recording.pause();
  element("recording-state").textContent = "Enregistrement en pause";
});
bind("resume", () => {
  recording.resume();
  element("recording-state").textContent = "Enregistrement en cours";
});
bind("stop", () => recording.stop());
bind("remove-video", () => {
  recording.cancel();
  sanitation?.abort();
  sanitation = null;
  videoOriginal = null;
  videoAudioCaptured = false;
  videoDerivative = null;
  videoMasks = [];
  resetVideoReview();
  videoPresent = false;
  showBlob("video", null);
  invalidate();
  element("recording-state").textContent = "Vidéo retirée";
});
async function refreshDrafts() {
  if (!vault) throw new Error("Locked");
  const epoch = generation;
  const entries = await vault.list();
  if (epoch !== generation) throw new Error("État modifié");
  const select = element<HTMLSelectElement>("drafts");
  select.replaceChildren();
  for (const entry of entries) {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = `${entry.id} — expire ${new Date(entry.expiresAt).toISOString()}`;
    select.append(option);
  }
}
bind("unlock", async () => {
  const epoch = generation;
  const phrase = input("passphrase").value;
  input("passphrase").value = "";
  if (!vault) {
    const store = await IndexedDbStore.open();
    if (epoch !== generation) {
      store.close();
      return;
    }
    vault = new DraftVault(store);
  }
  await vault.unlock(phrase);
  if (epoch !== generation) return;
  await refreshDrafts();
  status("Coffre déverrouillé.");
});
bind("save", async () => {
  if (!vault || (videoPresent && !videoDerivative))
    throw new Error("Assainissement vidéo requis ou coffre verrouillé");
  const epoch = generation;
  const savingId = dossierId;
  const savingRevision = savedRevision;
  const savingVault = vault;
  const expiresAt = Date.now() + Number(input("retention").value) * 86400000;
  const sourceVideo = videoOriginal;
  const cleanVideo = videoDerivative ? videoDerivative.bytes.slice() : null;
  const content = new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      dossierId,
      createdAt,
      revision,
      captureId,
      capturedAt,
      operations,
      screenshot: original !== null && derivative !== null,
      video: videoDerivative
        ? {
            sourceId: videoSourceId,
            capturedAt: videoCapturedAt,
            audioIncluded: videoDerivative.audioIncluded,
            sourceAudioCaptured: videoAudioCaptured,
            sourceType: videoOriginal?.type ?? "video/webm",
            width: videoDerivative.width,
            height: videoDerivative.height,
            masks: videoMasks,
          }
        : null,
      fields: Object.fromEntries(fields.map((id) => [id, input(id).value])),
    }),
  );
  const attachments: Attachment[] =
    original && derivative
      ? [
          { kind: "screenshot" as const, bytes: original.slice() },
          { kind: "screenshot" as const, bytes: derivative.slice() },
        ]
      : [];
  if (sourceVideo && cleanVideo) {
    const sourceBytes = new Uint8Array(await sourceVideo.arrayBuffer());
    attachments.push({ kind: "video", bytes: sourceBytes }, { kind: "video", bytes: cleanVideo });
  }
  if (epoch !== generation || savingVault !== vault)
    throw new Error("Enregistrement annulé : écran modifié");
  const next = await savingVault.save(
    { id: savingId, content, attachments, expiresAt },
    savingRevision,
  );
  if (savingId === dossierId) savedRevision = next;
  if (epoch !== generation) return;
  await refreshDrafts();
  status("Brouillon chiffré enregistré.");
});
bind("load", async () => {
  if (!vault) throw new Error("Locked");
  const epoch = generation;
  const draft = await vault.load(input("drafts").value);
  if (!draft || epoch !== generation) throw new Error("Absent");
  const data = JSON.parse(new TextDecoder().decode(draft.content)) as {
    version: number;
    dossierId: string;
    createdAt: string;
    revision: number;
    captureId: string;
    capturedAt: string;
    operations: ReviewedMedia["operations"];
    screenshot?: boolean;
    video?: {
      sourceId: string;
      capturedAt: string;
      audioIncluded: boolean;
      sourceAudioCaptured?: boolean;
      sourceType?: string;
      width: number;
      height: number;
      masks: Rectangle[];
    } | null;
    fields: Record<string, string>;
  };
  if (
    data.version !== 1 ||
    fields.some((id) => typeof data.fields[id] !== "string") ||
    draft.attachments.length !==
      ((data.screenshot ?? draft.attachments[0]?.kind === "screenshot") ? 2 : 0) +
        (data.video ? 2 : 0)
  )
    throw new Error("Format interne refusé");
  recording.cancel();
  sanitation?.abort();
  sanitation = null;
  videoOriginal = null;
  videoAudioCaptured = false;
  videoDerivative = null;
  videoMasks = [];
  resetVideoReview();
  videoPresent = false;
  showBlob("video", null);
  invalidate();
  dossierId = draft.id;
  createdAt = data.createdAt;
  revision = data.revision;
  captureId = data.captureId;
  capturedAt = data.capturedAt;
  operations = data.operations;
  savedRevision = draft.revision;
  for (const id of fields) input(id).value = data.fields[id] ?? "";
  const hasScreenshot = data.screenshot ?? draft.attachments[0]?.kind === "screenshot";
  original = hasScreenshot ? (draft.attachments[0]?.bytes ?? null) : null;
  derivative = hasScreenshot ? (draft.attachments[1]?.bytes ?? null) : null;
  if (data.video) {
    const index = hasScreenshot ? 2 : 0;
    const source = draft.attachments[index];
    const clean = draft.attachments[index + 1];
    if (!source || !clean) throw new Error("Vidéo absente");
    videoOriginal = new Blob([source.bytes], { type: data.video.sourceType ?? "video/webm" });
    videoAudioCaptured = data.video.sourceAudioCaptured ?? data.video.audioIncluded;
    videoDerivative = {
      bytes: clean.bytes,
      mimeType: "video/webm",
      audioIncluded: data.video.audioIncluded,
      width: data.video.width,
      height: data.video.height,
    };
    videoSourceId = data.video.sourceId;
    videoCapturedAt = data.video.capturedAt;
    videoMasks = data.video.masks;
    videoPresent = true;
    resetVideoReview();
    showBlob("video", clean.bytes, "video/webm");
    element<HTMLInputElement>("keep-audio").checked = data.video.audioIncluded;
    element<HTMLInputElement>("keep-audio").disabled = !videoAudioCaptured;
  }
  showBlob("screenshot", derivative);
  status("Brouillon repris. Préparez une nouvelle revue avant export.");
});
bind("delete", async () => {
  if (!vault) throw new Error("Locked");
  const id = input("drafts").value;
  const selected = await vault.load(id);
  if (!selected) throw new Error("Absent");
  await vault.delete(id, selected.revision);
  if (id === dossierId) {
    savedRevision = null;
    invalidate();
  }
  await refreshDrafts();
  status("Brouillon durable supprimé. L’écran courant reste en mémoire jusqu’au verrouillage.");
});
bind("prepare", async () => {
  if (capturePending) {
    status("Réception de la capture en cours. Attendez avant la revue.");
    return;
  }
  invalidate();
  if (!readyVideo()) {
    status(
      "Export bloqué : assainissez et lisez toute la vidéo, puis confirmez la revue vidéo et audio.",
    );
    return;
  }
  const epoch = generation;
  const media: ReviewedMedia[] = derivative
    ? [
        {
          id: `media-${crypto.randomUUID()}`,
          sourceId: captureId,
          kind: "screenshot",
          mimeType: "image/png",
          bytes: derivative.slice(),
          capturedAt,
          operations: [...operations],
          audioIncluded: false,
          audioReviewed: false,
        },
      ]
    : [];
  if (videoDerivative) {
    const videoOperations: ReviewedMedia["operations"] = ["metadata-removal", "transcode"];
    if (!videoDerivative.audioIncluded) videoOperations.push("audio-removal");
    if (videoMasks.length) videoOperations.push("redaction");
    media.push({
      id: `media-${crypto.randomUUID()}`,
      sourceId: videoSourceId,
      kind: "video",
      mimeType: "video/webm",
      bytes: videoDerivative.bytes.slice(),
      capturedAt: videoCapturedAt,
      operations: videoOperations,
      audioIncluded: videoDerivative.audioIncluded,
      audioReviewed:
        videoDerivative.audioIncluded && element<HTMLInputElement>("audio-reviewed").checked,
    });
  }
  const payload: ExportInput = {
    id: dossierId,
    revision,
    createdAt,
    expected: input("expected").value,
    observed: input("observed").value,
    application: input("application").value,
    environment: input("environment").value,
    steps: input("steps").value.split("\n").filter(Boolean),
    media,
  };
  const prepared = await buildReview(payload, utc());
  if (epoch !== generation) return;
  review = prepared;
  element("markdown").textContent = prepared.markdown;
  element("manifest").textContent =
    typeof prepared.manifest === "string"
      ? prepared.manifest
      : JSON.stringify(prepared.manifest, null, 2);
  element("files").textContent = prepared.filenames.join("\n");
  showBlob("review-image", media.find((item) => item.kind === "screenshot")?.bytes ?? null);
  showBlob(
    "review-video",
    media.find((item) => item.kind === "video")?.bytes ?? null,
    "video/webm",
  );
  element("review").hidden = false;
  status("Revue exacte prête. Toute modification l’invalide.");
});
bind("export", async () => {
  if (!review || !element<HTMLInputElement>("approved").checked || !readyVideo())
    throw new Error("Approbation requise");
  const epoch = generation;
  const bytes = await review.toZip();
  if (epoch !== generation) return;
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "signalement-dossier.zip";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status("Téléchargement de l’export approuvé déclenché.");
});
async function initialize() {
  const nonce = location.hash.slice(1);
  history.replaceState(null, "", location.pathname);
  if (!nonce) {
    status("Aucune capture : vous pouvez décrire un problème ou reprendre un brouillon.");
    return;
  }
  const epoch = generation;
  const api = typeof browser === "undefined" ? chrome : browser;
  const response = await api.runtime.sendMessage({ kind: "consume", nonce });
  if (!response.ok || response.data === null) throw new Error("Capture expirée");
  const source = decodeCapture(response.data);
  const clean = await editPng(source, {});
  if (epoch !== generation) return;
  invalidate();
  original = source;
  derivative = clean;
  operations = ["metadata-removal"];
  showBlob("screenshot", derivative);
  status("Capture reçue en mémoire. Masquez les données sensibles avant la revue.");
}
initialize()
  .catch(() =>
    status(
      "Capture indisponible ou expirée. Aucune page différente n’est capturée automatiquement.",
    ),
  )
  .finally(() => {
    capturePending = false;
  });
