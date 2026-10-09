/* global browser, chrome */
const api = typeof browser === "undefined" ? chrome : browser;
const key = "syntheticCapabilityProbe";
let recorder = null;
let stream = null;
let stopTimer = null;
let videoBytes = 0;
let pageClosed = false;
let acquiring = false;
function releaseRecording() {
  const currentStream = stream;
  stream = null;
  if (stopTimer !== null) clearTimeout(stopTimer);
  stopTimer = null;
  for (const track of currentStream?.getTracks() ?? []) track.stop();
  if (recorder && recorder.state !== "inactive") recorder.stop();
}
window.addEventListener("pagehide", () => {
  pageClosed = true;
  releaseRecording();
});
function report(value) {
  document.getElementById("result").textContent = JSON.stringify(value, null, 2);
}
function bind(id, action) {
  document.getElementById(id).addEventListener("click", async () => {
    try {
      await action();
    } catch (error) {
      if (["record", "pause", "resume", "stop"].includes(id)) releaseRecording();
      // Error names are enough to classify failure; messages can include page identifiers.
      report({ action: id, status: "failed", errorName: error?.name ?? "Error" });
    }
  });
}
bind("inspect", async () => {
  const permissions = await api.permissions.getAll();
  const stored = await api.storage.local.get(key);
  report({
    captureVisibleTab: typeof api.tabs.captureVisibleTab === "function",
    getDisplayMedia: typeof navigator.mediaDevices?.getDisplayMedia === "function",
    mediaRecorder: typeof MediaRecorder === "function",
    permissions,
    draftPresent: stored[key]?.marker === "synthetic-draft-v1",
  });
});
bind("capture", async () => {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.startsWith("http://127.0.0.1:43187/")) {
    throw new DOMException("Synthetic fixture required", "SecurityError");
  }
  const data = await api.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const [current] = await api.tabs.query({ active: true, windowId: tab.windowId });
  if (current?.id !== tab.id || current?.url !== tab.url || current?.windowId !== tab.windowId) {
    document.getElementById("preview").removeAttribute("src");
    throw new DOMException("Capture target changed", "SecurityError");
  }
  const preview = document.getElementById("preview");
  preview.src = data;
  await preview.decode();
  report({
    status: "captured",
    mime: data.slice(0, 22),
    width: preview.naturalWidth,
    height: preview.naturalHeight,
    encodedBytes: data.length,
    scope: "visible-area",
  });
});
bind("write", async () => {
  await api.storage.local.set({ [key]: { marker: "synthetic-draft-v1" } });
  const stored = await api.storage.local.get(key);
  report({ status: "write-read", matches: stored[key]?.marker === "synthetic-draft-v1" });
});
bind("delete", async () => {
  await api.storage.local.remove(key);
  const stored = await api.storage.local.get(key);
  report({ status: "deleted", absent: !Object.hasOwn(stored, key) });
});
bind("record", async () => {
  if (stream || acquiring) throw new DOMException("Already recording", "InvalidStateError");
  acquiring = true;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } finally {
    acquiring = false;
  }
  if (pageClosed) {
    releaseRecording();
    return;
  }
  videoBytes = 0;
  recorder = new MediaRecorder(stream);
  recorder.addEventListener("dataavailable", (event) => {
    videoBytes += event.data.size;
  });
  recorder.addEventListener("error", () => {
    releaseRecording();
    report({ status: "failed", errorName: "RecordingError" });
  });
  recorder.addEventListener("stop", () => {
    releaseRecording();
    report({ status: "stopped", bytes: videoBytes, mime: recorder.mimeType });
  });
  stream.getVideoTracks()[0]?.addEventListener("ended", () => {
    if (recorder.state !== "inactive") recorder.stop();
  });
  recorder.start(1000);
  stopTimer = setTimeout(() => {
    if (recorder.state !== "inactive") recorder.stop();
  }, 10_000);
  report({ status: "recording", audioTracks: stream.getAudioTracks().length, maxSeconds: 10 });
});
bind("pause", async () => {
  recorder.pause();
  report({ status: recorder.state });
});
bind("resume", async () => {
  recorder.resume();
  report({ status: recorder.state });
});
bind("stop", async () => {
  recorder.stop();
});
