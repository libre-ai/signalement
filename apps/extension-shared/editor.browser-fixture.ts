import { readZip } from "../../packages/domain/zip.ts";

// Synthetic isolated-browser acceptance. Never injected into a production extension.
const checks: string[] = [];
// One beacon per passed check lets the harness bound the silence between checks instead of the
// whole run from browser spawn, and name the last check reached when the page stops reporting.
function progress(stage: string): void {
  void fetch("/progress", { method: "POST", body: stage });
}
function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
  checks.push(label);
  progress(label);
}
function field(id: string) {
  const item = document.getElementById(id);
  if (!item) throw new Error("Missing fixture control");
  return item as HTMLInputElement;
}
function click(id: string) {
  field(id).click();
}
async function waitFor(predicate: () => boolean) {
  const end = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("Fixture timeout");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
function set(id: string, value: string) {
  field(id).value = value;
  field(id).dispatchEvent(new Event("input", { bubbles: true }));
}
async function run() {
  const downloads: string[] = [];
  HTMLAnchorElement.prototype.click = function () {
    downloads.push(this.href);
  };
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 4;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  context.fillStyle = "rgb(0,255,0)";
  context.fillRect(0, 0, 4, 4);
  const synthetic = canvas.toDataURL("image/png");
  const initLock = location.search.includes("init-lock");
  const audioFixture = location.search.includes("audio-fixture");
  let deliverCapture: (value: { ok: boolean; data: string }) => void = () => {};
  const incoming = new Promise<{ ok: boolean; data: string }>((resolve) => {
    deliverCapture = resolve;
  });
  Object.defineProperty(window, "chrome", {
    value: { runtime: { sendMessage: async () => incoming } },
    configurable: true,
  });
  history.replaceState(null, "", `${location.pathname}#synthetic-nonce`);
  await import("./editor.ts");
  click("prepare");
  await waitFor(
    () =>
      document.getElementById("status")?.textContent?.startsWith("Réception de la capture") ===
      true,
  );
  assert(
    document.getElementById("review")?.hidden === true,
    "review-refused-while-capture-pending",
  );
  if (initLock) {
    click("lock");
    await waitFor(
      () => document.getElementById("status")?.textContent === "Coffre verrouillé et écran effacé.",
    );
    deliverCapture({ ok: true, data: synthetic });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert(
      document.getElementById("screenshot")?.hidden === true,
      "late-capture-cannot-return-after-lock",
    );
    return checks;
  }
  deliverCapture({ ok: true, data: synthetic });
  await waitFor(
    () => document.getElementById("status")?.textContent?.startsWith("Capture reçue") === true,
  );
  set("expected", "Le compteur augmente de un.");
  set("observed", "Le compteur augmente de deux.");
  set("application", "Fixture synthétique");
  set("environment", "Navigateur isolé");
  set("steps", "Cliquer sur Ajouter");
  set("x", "1");
  set("y", "1");
  set("width", "2");
  set("height", "2");
  click("crop");
  await waitFor(
    () => document.getElementById("status")?.textContent?.startsWith("Pixels modifiés") === true,
  );
  const image = field("screenshot") as unknown as HTMLImageElement;
  await image.decode();
  assert(image.naturalWidth === 2 && image.naturalHeight === 2, "crop-changes-export-pixels");
  set("x", "0");
  set("y", "0");
  set("width", "1");
  set("height", "1");
  const old = image.src;
  click("mask");
  await waitFor(() => image.src !== old);
  await image.decode();
  context.clearRect(0, 0, 4, 4);
  context.drawImage(image, 0, 0);
  const pixel = context.getImageData(0, 0, 1, 1).data;
  assert(
    pixel[0] === 0 && pixel[1] === 0 && pixel[2] === 0 && pixel[3] === 255,
    "opaque-pixel-redaction",
  );
  set("passphrase", "synthetic UI test passphrase");
  click("unlock");
  await waitFor(() => document.getElementById("status")?.textContent === "Coffre déverrouillé.");
  click("save");
  await waitFor(
    () => document.getElementById("status")?.textContent === "Brouillon chiffré enregistré.",
  );
  click("lock");
  await waitFor(
    () => document.getElementById("status")?.textContent === "Coffre verrouillé et écran effacé.",
  );
  assert(field("expected").value === "" && image.hidden === true, "lock-clears-ui");
  set("passphrase", "synthetic UI test passphrase");
  click("unlock");
  await waitFor(() => document.getElementById("status")?.textContent === "Coffre déverrouillé.");
  click("load");
  await waitFor(
    () => document.getElementById("status")?.textContent?.startsWith("Brouillon repris") === true,
  );
  assert(field("expected").value === "Le compteur augmente de un.", "encrypted-save-resume");
  click("prepare");
  await waitFor(() => document.getElementById("review")?.hidden === false);
  assert(
    (document.getElementById("markdown")?.textContent?.length ?? 0) > 0,
    "exact-review-visible",
  );
  const firstManifest = document.getElementById("manifest")?.textContent;
  field("approved").checked = true;
  click("prepare");
  await waitFor(
    () =>
      document.getElementById("review")?.hidden === false &&
      (document.getElementById("manifest")?.textContent?.length ?? 0) > 0 &&
      document.getElementById("manifest")?.textContent !== firstManifest,
  );
  assert(!field("approved").checked, "reprepare-requires-new-approval");
  const reviewedMarkdown = document.getElementById("markdown")?.textContent;
  const reviewedManifest = document.getElementById("manifest")?.textContent;
  const reviewedImage = await (
    await fetch((field("review-image") as unknown as HTMLImageElement).src)
  ).arrayBuffer();
  click("export");
  await waitFor(
    () => document.getElementById("status")?.textContent?.startsWith("Opération refusée") === true,
  );
  assert(downloads.length === 0, "export-refused-without-approval");
  field("approved").checked = true;
  click("export");
  await waitFor(() => downloads.length === 1);
  const zipBytes = new Uint8Array(await (await fetch(downloads[0] ?? "")).arrayBuffer());
  const files = readZip(zipBytes);
  const text = new TextDecoder();
  assert(
    text.decode(files.find((file) => file.path === "README.md")?.bytes) === reviewedMarkdown,
    "zip-matches-reviewed-markdown",
  );
  assert(
    text.decode(files.find((file) => file.path === "manifest.json")?.bytes) === reviewedManifest,
    "zip-matches-reviewed-manifest",
  );
  const png = files.find((file) => file.path.endsWith(".png"))?.bytes;
  assert(
    png !== undefined &&
      png.length === reviewedImage.byteLength &&
      png.every((value, index) => value === new Uint8Array(reviewedImage)[index]),
    "zip-matches-reviewed-pixels",
  );
  set("expected", "Texte modifié après revue");
  assert(document.getElementById("review")?.hidden === true, "editing-invalidates-review");
  const videoCanvas = document.createElement("canvas");
  videoCanvas.width = 64;
  videoCanvas.height = 64;
  const videoContext = videoCanvas.getContext("2d", { alpha: false });
  if (!videoContext) throw new Error("Canvas");
  videoContext.fillStyle = "rgb(0,255,0)";
  videoContext.fillRect(0, 0, 64, 64);
  const syntheticStream = videoCanvas.captureStream(15);
  const audioContext = audioFixture ? new AudioContext() : null;
  let oscillator: OscillatorNode | null = null;
  if (audioContext) {
    await audioContext.resume();
    const destination = audioContext.createMediaStreamDestination();
    oscillator = audioContext.createOscillator();
    oscillator.connect(destination);
    oscillator.start();
    for (const track of destination.stream.getAudioTracks()) syntheticStream.addTrack(track);
    field("audio").checked = true;
    field("audio").dispatchEvent(new Event("input", { bubbles: true }));
  }
  Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
    value: async () => syntheticStream,
    configurable: true,
  });
  const painting = setInterval(() => {
    videoContext.fillRect(0, 0, 64, 64);
  }, 30);
  click("record");
  await waitFor(
    () =>
      document
        .getElementById("recording-state")
        ?.textContent?.startsWith("Enregistrement en cours") === true,
  );
  await new Promise((resolve) => setTimeout(resolve, 700));
  click("stop");
  await waitFor(
    () =>
      document.getElementById("recording-state")?.textContent?.startsWith("Vidéo arrêtée") === true,
  );
  clearInterval(painting);
  oscillator?.stop();
  await audioContext?.close();
  click("prepare");
  await waitFor(
    () => document.getElementById("status")?.textContent?.startsWith("Export bloqué") === true,
  );
  assert(document.getElementById("review")?.hidden === true, "raw-video-export-refused");
  if (audioFixture) {
    assert(!field("keep-audio").disabled, "captured-audio-choice-enabled");
    field("keep-audio").checked = true;
    field("keep-audio").dispatchEvent(new Event("input", { bubbles: true }));
  }
  click("sanitize-video");
  await waitFor(
    () =>
      document.getElementById("recording-state")?.textContent?.startsWith("Dérivé assaini prêt") ===
      true,
  );
  const video = field("video") as unknown as HTMLVideoElement;
  video.muted = true;
  const ended = new Promise<void>((resolve) =>
    video.addEventListener("ended", () => resolve(), { once: true }),
  );
  await video.play();
  await ended;
  field("video-reviewed").checked = true;
  field("video-reviewed").dispatchEvent(new Event("input", { bubbles: true }));
  if (audioFixture) {
    click("prepare");
    await waitFor(
      () => document.getElementById("status")?.textContent?.startsWith("Export bloqué") === true,
    );
    assert(
      document.getElementById("review")?.hidden === true,
      "audio-needs-separate-explicit-review",
    );
    field("audio-reviewed").checked = true;
    field("audio-reviewed").dispatchEvent(new Event("input", { bubbles: true }));
  }
  click("prepare");
  await waitFor(() => document.getElementById("review")?.hidden === false);
  assert(
    (document.getElementById("manifest")?.textContent ?? "").includes('"video"'),
    "sanitized-video-reviewed-export",
  );
  const exactVideo = new Uint8Array(
    await (await fetch((field("review-video") as unknown as HTMLVideoElement).src)).arrayBuffer(),
  );
  const previousDownloads = downloads.length;
  field("approved").checked = true;
  click("export");
  await waitFor(() => downloads.length === previousDownloads + 1);
  const videoZip = readZip(
    new Uint8Array(await (await fetch(downloads.at(-1) ?? "")).arrayBuffer()),
  );
  const exportedVideo = videoZip.find((file) => file.path.endsWith(".webm"))?.bytes;
  assert(
    exportedVideo !== undefined &&
      exportedVideo.length === exactVideo.length &&
      exportedVideo.every((value, index) => value === exactVideo[index]),
    "zip-matches-reviewed-video",
  );
  click("save");
  await waitFor(
    () => document.getElementById("status")?.textContent === "Brouillon chiffré enregistré.",
  );
  click("lock");
  await waitFor(
    () => document.getElementById("status")?.textContent === "Coffre verrouillé et écran effacé.",
  );
  set("passphrase", "synthetic UI test passphrase");
  click("unlock");
  await waitFor(() => document.getElementById("status")?.textContent === "Coffre déverrouillé.");
  click("load");
  await waitFor(
    () => document.getElementById("status")?.textContent?.startsWith("Brouillon repris") === true,
  );
  assert(!video.hidden, "encrypted-video-resumed");
  if (audioFixture)
    assert(
      !field("keep-audio").disabled && field("keep-audio").checked,
      "resumed-audio-can-be-removed-and-resanitized",
    );
  assert(!field("video-reviewed").checked, "video-reapproval-required-after-resume");
  await video.play();
  const beforeRaceExpected = field("expected").value;
  set("expected", "Synthetic stale content must not persist");
  const originalArrayBuffer = Blob.prototype.arrayBuffer;
  let conversionStarted = false;
  let releaseConversion: () => void = () => {};
  Blob.prototype.arrayBuffer = function () {
    if (this.type.startsWith("video/") && !conversionStarted) {
      conversionStarted = true;
      return new Promise<ArrayBuffer>((resolve) => {
        releaseConversion = () => {
          void originalArrayBuffer.call(this).then(resolve);
        };
      });
    }
    return originalArrayBuffer.call(this);
  };
  click("save");
  await waitFor(() => conversionStarted);
  click("lock");
  await waitFor(
    () => document.getElementById("status")?.textContent === "Coffre verrouillé et écran effacé.",
  );
  set("passphrase", "synthetic UI test passphrase");
  click("unlock");
  assert(
    document.getElementById("status")?.textContent === "Une opération est déjà en cours.",
    "lock-cannot-reset-busy-operation-count",
  );
  assert(video.paused && video.readyState === 0, "lock-stops-and-unloads-video-playback");
  releaseConversion();
  await waitFor(
    () => document.getElementById("status")?.textContent?.startsWith("Opération refusée") === true,
  );
  Blob.prototype.arrayBuffer = originalArrayBuffer;
  click("unlock");
  await waitFor(() => document.getElementById("status")?.textContent === "Coffre déverrouillé.");
  click("load");
  await waitFor(
    () => document.getElementById("status")?.textContent?.startsWith("Brouillon repris") === true,
  );
  assert(
    field("expected").value === beforeRaceExpected,
    "locked-save-conversion-cannot-overwrite-durable-draft",
  );
  click("lock");
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
        reason: error instanceof Error ? error.message : "Unknown fixture error",
        checks,
      }),
    }),
  );
