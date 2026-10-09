import type { Rectangle } from "../../packages/capture-core/pixels.ts";
import { sanitizeWebm } from "./video-container.ts";

export interface SanitizedVideo {
  bytes: Uint8Array<ArrayBuffer>;
  mimeType: "video/webm";
  audioIncluded: boolean;
  width: number;
  height: number;
}
export function validateVideoMasks(
  masks: readonly Rectangle[],
  width: number,
  height: number,
): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 16_777_216 ||
    masks.length > 128
  )
    throw new Error(`Dimensions vidéo hors limites: ${width}x${height}`);
  for (const m of masks)
    if (
      ![m.x, m.y, m.width, m.height].every(Number.isSafeInteger) ||
      m.x < 0 ||
      m.y < 0 ||
      m.width < 1 ||
      m.height < 1 ||
      m.x + m.width > width ||
      m.y + m.height > height
    )
      throw new Error("Masque vidéo invalide");
}
export function selectVideoMime(audio: boolean, supported: (mime: string) => boolean): string {
  const suffix = audio ? ",opus" : "";
  const mime = [`video/webm;codecs=vp8${suffix}`, `video/webm;codecs=vp9${suffix}`].find(supported);
  if (!mime) throw new Error("Encodeur WebM indisponible");
  return mime;
}
function waitEvent(target: EventTarget, type: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    function cleanup() {
      target.removeEventListener(type, done);
      target.removeEventListener("error", failed);
      signal.removeEventListener("abort", failed);
    }
    function done() {
      cleanup();
      resolve();
    }
    function failed() {
      cleanup();
      reject(new Error("Vidéo refusée ou annulée"));
    }
    target.addEventListener(type, done, { once: true });
    target.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", failed, { once: true });
    if (signal.aborted) failed();
  });
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("Vidéo annulée"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
/** Decodes pixels/PCM into new tracks, then rebuilds a restricted container. No source bytes are copied. */
export async function reencodeVideoPixels(
  source: Blob,
  includeAudio: boolean,
  inputMasks: readonly Rectangle[],
  externalSignal: AbortSignal,
): Promise<SanitizedVideo> {
  if (inputMasks.length > 128) throw new Error("Limites vidéo");
  const masks = inputMasks.map((mask) => ({ ...mask }));
  if (source.size < 1 || source.size > 64 * 1024 ** 2)
    throw new Error(`Taille vidéo hors limites: ${source.size}`);
  const mime = selectVideoMime(includeAudio, (value) => MediaRecorder.isTypeSupported(value));
  const controller = new AbortController();
  const abort = () => controller.abort();
  externalSignal.addEventListener("abort", abort, { once: true });
  if (externalSignal.aborted) abort();
  const timeout = setTimeout(abort, 70_000);
  const video = document.createElement("video");
  video.muted = true;
  video.width = 160;
  video.setAttribute("aria-label", "Source temporaire du réencodage local");
  document.body.append(video);
  video.playsInline = true;
  const url = URL.createObjectURL(source);
  let output: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let frameId: number | null = null;
  let audioContext: AudioContext | null = null;
  try {
    audioContext = includeAudio ? new AudioContext() : null;
    if (audioContext) await abortable(audioContext.resume(), controller.signal);
    const loaded = waitEvent(video, "loadeddata", controller.signal);
    video.src = url;
    video.load();
    await loaded;
    const width = video.videoWidth,
      height = video.videoHeight;
    validateVideoMasks(masks, width, height);
    if (Number.isFinite(video.duration) && video.duration > 61)
      throw new Error("Vidéo supérieure à 60 secondes");
    if (typeof video.requestVideoFrameCallback !== "function")
      throw new Error("Décodage frame par frame indisponible");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas indisponible");
    function draw() {
      context?.drawImage(video, 0, 0, width, height);
      if (context) {
        context.fillStyle = "rgb(0,0,0)";
        for (const mask of masks) context.fillRect(mask.x, mask.y, mask.width, mask.height);
      }
    }
    // Decode and present frame zero before creating captureStream: its initial frame is queued immediately.
    const firstFrame = new Promise<void>((resolve) => {
      frameId = video.requestVideoFrameCallback(() => resolve());
    });
    await abortable(video.play(), controller.signal);
    await abortable(firstFrame, controller.signal);
    video.pause();
    if (video.currentTime > 0) {
      const rewind = waitEvent(video, "seeked", controller.signal);
      video.currentTime = 0;
      await rewind;
    }
    draw();
    output = canvas.captureStream(0);
    const outputTrack = output.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
    if (!outputTrack) throw new Error("Capture vidéo indisponible");
    const manualFrames = typeof outputTrack.requestFrame === "function";
    if (!manualFrames) {
      for (const track of output.getTracks()) track.stop();
      output = canvas.captureStream(30);
    }
    if (audioContext) {
      const decoded = audioContext.createMediaElementSource(video);
      const destination = audioContext.createMediaStreamDestination();
      decoded.connect(destination);
      video.muted = false;
      for (const track of destination.stream.getAudioTracks()) output.addTrack(track);
    }
    recorder = new MediaRecorder(output, {
      mimeType: mime,
      videoBitsPerSecond: 4_000_000,
      audioBitsPerSecond: 128_000,
    });
    const chunks: Blob[] = [];
    let count = 0;
    recorder.addEventListener("dataavailable", (event) => {
      count += event.data.size;
      if (count > 64 * 1024 ** 2) {
        controller.abort();
        return;
      }
      chunks.push(event.data);
    });
    recorder.addEventListener("error", abort, { once: true });
    const ended = waitEvent(video, "ended", controller.signal);
    void ended.catch(() => {});
    function frame() {
      if (controller.signal.aborted) return;
      draw();
      if (manualFrames) outputTrack?.requestFrame();
      else context?.getImageData(0, 0, 1, 1);
      frameId = video.requestVideoFrameCallback(frame);
    }
    recorder.start(1000);
    if (manualFrames) outputTrack.requestFrame();
    frameId = video.requestVideoFrameCallback(frame);
    await abortable(video.play(), controller.signal);
    await ended;
    const stopped = waitEvent(recorder, "stop", controller.signal);
    recorder.stop();
    for (const track of output.getTracks()) track.stop();
    await stopped;
    if (controller.signal.aborted || count === 0) throw new Error("Vidéo annulée");
    const encoded = new Uint8Array(await new Blob(chunks).arrayBuffer());
    return { bytes: encoded, mimeType: "video/webm", audioIncluded: includeAudio, width, height };
  } finally {
    controller.abort();
    clearTimeout(timeout);
    externalSignal.removeEventListener("abort", abort);
    if (frameId !== null) video.cancelVideoFrameCallback(frameId);
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    if (recorder && recorder.state !== "inactive") recorder.stop();
    for (const track of output?.getTracks() ?? []) track.stop();
    if (audioContext) await audioContext.close();
    URL.revokeObjectURL(url);
  }
}

/** Public sanitation path: raw reencoded bytes never leave this wrapper. */
export async function sanitizeVideo(
  source: Blob,
  includeAudio: boolean,
  masks: readonly Rectangle[],
  signal: AbortSignal,
): Promise<SanitizedVideo> {
  const result = await reencodeVideoPixels(source, includeAudio, masks, signal);
  if (signal.aborted) throw new Error("Vidéo annulée");
  return { ...result, bytes: sanitizeWebm(result.bytes, includeAudio) };
}
