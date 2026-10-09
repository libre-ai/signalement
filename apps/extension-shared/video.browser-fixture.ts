import { sanitizeWebm } from "./video-container.ts";
import { reencodeVideoPixels } from "./video-sanitizer.ts";

// Each beacon lets the harness bound every real-time media stage separately and name the one
// that stalled, instead of one wall clock that also absorbs browser startup.
function progress(stage: string): void {
  void fetch("/progress", { method: "POST", body: stage });
}

async function source(audio: boolean): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas");
  context.fillStyle = "rgb(0,255,0)";
  context.fillRect(0, 0, 64, 64);
  const stream = canvas.captureStream(15);
  const ac = audio ? new AudioContext() : null;
  let oscillator: OscillatorNode | null = null;
  if (ac) {
    await ac.resume();
    const dest = ac.createMediaStreamDestination();
    oscillator = ac.createOscillator();
    oscillator.connect(dest);
    oscillator.start();
    for (const track of dest.stream.getAudioTracks()) stream.addTrack(track);
  }
  const recorder = new MediaRecorder(stream, {
    mimeType: audio ? "video/webm;codecs=vp8,opus" : "video/webm;codecs=vp8",
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => chunks.push(event.data);
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  recorder.start(100);
  const timer = setInterval(() => {
    context.fillStyle = "rgb(0,255,0)";
    context.fillRect(0, 0, 64, 64);
  }, 30);
  await new Promise((resolve) => setTimeout(resolve, 2200));
  recorder.stop();
  await stopped;
  clearInterval(timer);
  for (const track of stream.getTracks()) track.stop();
  oscillator?.stop();
  await ac?.close();
  return new Blob(chunks, { type: "video/webm" });
}
async function run() {
  const checks: string[] = [];
  for (const audio of [false, true]) {
    const mode = audio ? "audio" : "silent";
    progress(`recording-${mode}`);
    const original = await source(audio);
    progress(`recorded-${mode}`);
    const originalVideo = document.createElement("video");
    originalVideo.muted = true;
    document.body.append(originalVideo);
    const originalUrl = URL.createObjectURL(original);
    originalVideo.src = originalUrl;
    await new Promise<void>((resolve, reject) => {
      originalVideo.onloadeddata = () => resolve();
      originalVideo.onerror = () => reject(new Error("Source decode"));
    });
    const originalFrame = new Promise<void>((resolve) =>
      originalVideo.requestVideoFrameCallback(() => resolve()),
    );
    await originalVideo.play();
    await originalFrame;
    originalVideo.pause();
    const oracleCanvas = document.createElement("canvas");
    oracleCanvas.width = 64;
    oracleCanvas.height = 64;
    const oracle = oracleCanvas.getContext("2d");
    if (!oracle) throw new Error("Canvas");
    oracle.drawImage(originalVideo, 0, 0);
    const sourcePixel = oracle.getImageData(48, 8, 1, 1).data;
    originalVideo.removeAttribute("src");
    originalVideo.load();
    originalVideo.remove();
    URL.revokeObjectURL(originalUrl);
    if ((sourcePixel[1] ?? 0) < 200)
      throw new Error(`Source fixture pixel ${Array.from(sourcePixel).join(",")}`);
    progress(`source-decoded-${mode}`);
    const controller = new AbortController();
    const raw = await reencodeVideoPixels(
      original,
      audio,
      [{ x: 0, y: 0, width: 32, height: 64 }],
      controller.signal,
    );
    const result = { ...raw, bytes: sanitizeWebm(raw.bytes, audio) };
    if (
      result.bytes.length === 0 ||
      result.width !== 64 ||
      result.height !== 64 ||
      result.audioIncluded !== audio
    )
      throw new Error("Derivative shape");
    progress(`transcoded-${mode}`);
    checks.push(`transcode-${audio ? "audio" : "silent"}`);
    const canonical = sanitizeWebm(result.bytes, audio);
    if (
      canonical.length !== result.bytes.length ||
      !canonical.every((v, i) => v === result.bytes[i])
    )
      throw new Error("Metadata policy");
    checks.push(`container-policy-${audio ? "audio" : "silent"}`);
    if (audio) {
      const context = new AudioContext();
      const decoded = await context.decodeAudioData(result.bytes.buffer.slice(0));
      const samples = decoded.getChannelData(0);
      let energy = 0;
      for (const sample of samples) energy += sample * sample;
      if (Math.sqrt(energy / samples.length) < 0.01) throw new Error("Decoded audio silent");
      await context.close();
      checks.push("decoded-audio-energy");
    } else {
      let refused = false;
      try {
        sanitizeWebm(result.bytes, true);
      } catch {
        refused = true;
      }
      if (!refused) throw new Error("Unexpected audio track");
      checks.push("silent-no-audio-track");
    }
    const video = document.createElement("video");
    video.muted = true;
    document.body.append(video);
    const url = URL.createObjectURL(new Blob([result.bytes], { type: "video/webm" }));
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Derivative decode"));
    });
    const presented = new Promise<void>((resolve) =>
      video.requestVideoFrameCallback(() => resolve()),
    );
    await video.play();
    await presented;
    video.pause();
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas");
    context.drawImage(video, 0, 0);
    const left = context.getImageData(8, 8, 1, 1).data;
    const right = context.getImageData(48, 8, 1, 1).data;
    if (
      (left[0] ?? 255) > 20 ||
      (left[1] ?? 255) > 20 ||
      (left[2] ?? 255) > 20 ||
      (right[1] ?? 0) < 200
    )
      throw new Error(
        `Opaque video mask ${audio}: left=${Array.from(left).join(",")} right=${Array.from(right).join(",")}`,
      );
    checks.push(`decoded-mask-${audio ? "audio" : "silent"}`);
    progress(`derivative-presented-${mode}`);
    let frames = 0;
    let badFrame = false;
    let callback: number | null = null;
    function inspectFrame() {
      context?.drawImage(video, 0, 0);
      const black = context?.getImageData(8, 8, 1, 1).data;
      const green = context?.getImageData(48, 8, 1, 1).data;
      if (
        !black ||
        !green ||
        (black[0] ?? 255) > 20 ||
        (black[1] ?? 255) > 20 ||
        (black[2] ?? 255) > 20 ||
        (green[1] ?? 0) < 200
      )
        badFrame = true;
      frames++;
      callback = video.requestVideoFrameCallback(inspectFrame);
    }
    const complete = new Promise<void>((resolve) =>
      video.addEventListener("ended", () => resolve(), { once: true }),
    );
    callback = video.requestVideoFrameCallback(inspectFrame);
    await video.play();
    await complete;
    if (callback !== null) video.cancelVideoFrameCallback(callback);
    if (frames < 2 || badFrame) throw new Error("Mask missing from a decoded frame");
    checks.push(`all-decoded-frames-masked-${audio ? "audio" : "silent"}`);
    progress(`derivative-ended-${mode}`);
    video.removeAttribute("src");
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  }
  return checks;
}
run()
  .then((checks) =>
    fetch("/result", { method: "POST", body: JSON.stringify({ status: "passed", checks }) }),
  )
  .catch((error: unknown) =>
    fetch("/result", {
      method: "POST",
      body: JSON.stringify({
        status: "failed",
        reason: error instanceof Error ? error.message : "Unknown",
      }),
    }),
  );
