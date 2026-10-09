import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable, Writable } from "node:stream";

import { BROWSER_STARTUP_MS } from "../../apps/extension-shared/browser-check-watchdog";
import { readZip } from "../../packages/domain/zip";
import { recipeEvidence, snapshotBuild } from "./evidence";
import { waitForExtensionWorker } from "./extension-worker";
import { type NativeQuotaPolicy, policyArgument, receiptFailures, receiptSummary } from "./receipt";

// Without an explicit flag the native quota stays required, as before.
const nativeQuotaArgument = process.argv.slice(2).length
  ? policyArgument(process.argv.slice(2))
  : "required";
if (nativeQuotaArgument === null)
  throw new Error("Usage: chrome.ts [--native-quota=required|non-required]");
const nativeQuotaPolicy: NativeQuotaPolicy = nativeQuotaArgument;
const root = resolve(import.meta.dir, "../..");
const storageBuild = await Bun.build({
  entrypoints: [join(root, "tools/browser-check/storage.browser-fixture.ts")],
  target: "browser",
});
if (!storageBuild.success || !storageBuild.outputs[0])
  throw new Error("Storage fixture build failed");
const storageScript = await storageBuild.outputs[0].text();
const output = join(root, "test-results/browser-check/chrome", crypto.randomUUID());
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "signalement-chrome-qualification-"));
const fixture = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/storage.js")
      return new Response(storageScript, { headers: { "Content-Type": "application/javascript" } });
    if (path === "/storage.html")
      return new Response(
        '<!doctype html><title>Synthetic storage qualification</title><script type="module" src="/storage.js"></script>',
        { headers: { "Content-Type": "text/html" } },
      );
    if (path !== "/" && path !== "/fixture.js") return new Response("Not found", { status: 404 });
    return new Response(
      Bun.file(
        join(root, "tests/fixtures/capture-app", path === "/" ? "index.html" : "fixture.js"),
      ),
    );
  },
});
function launchBrowser() {
  const child = spawn(
    process.env.CHROME_BINARY ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    [
      `--user-data-dir=${profile}`,
      "--remote-debugging-pipe",
      "--enable-unsafe-extension-debugging",
      "--no-first-run",
      "--no-default-browser-check",
      "--headless=new",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] },
  );
  const writerCandidate = child.stdio[3];
  const reader = child.stdio[4];
  if (!(writerCandidate instanceof Writable) || !(reader instanceof Readable))
    throw new Error("CDP pipes unavailable");
  return { child, writer: writerCandidate, reader };
}
let current = launchBrowser();
let serial = 0;
let pending = "";
const calls = new Map<
  number,
  {
    method: string;
    resolve: (value: Record<string, unknown>) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
function handleMessage(chunk: Buffer): void {
  pending += chunk.toString("utf8");
  let separator = pending.indexOf("\0");
  while (separator >= 0) {
    const message = JSON.parse(pending.slice(0, separator)) as {
      id?: number;
      result?: Record<string, unknown>;
      error?: { code: number; message: string };
    };
    pending = pending.slice(separator + 1);
    if (message.id !== undefined) {
      const call = calls.get(message.id);
      if (call) {
        clearTimeout(call.timer);
        calls.delete(message.id);
        if (message.error)
          call.reject(
            new Error(`CDP ${call.method} ${message.error.code}: ${message.error.message}`),
          );
        else call.resolve(message.result ?? {});
      }
    }
    separator = pending.indexOf("\0");
  }
}
current.reader.on("data", handleMessage);
async function cdp(
  method: string,
  params: Record<string, unknown> = {},
  sessionId?: string,
  timeoutMs = 25000,
): Promise<Record<string, unknown>> {
  const id = ++serial;
  return new Promise((resolveCall, rejectCall) => {
    const timer = setTimeout(() => {
      calls.delete(id);
      rejectCall(new Error(`CDP timeout: ${method}`));
    }, timeoutMs);
    calls.set(id, { method, resolve: resolveCall, reject: rejectCall, timer });
    current.writer.write(
      `${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`,
    );
  });
}
async function evaluate(session: string, expression: string): Promise<unknown> {
  const reply = await cdp(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true, userGesture: true },
    session,
  );
  if (reply.exceptionDetails) {
    const detail = reply.exceptionDetails as { exception?: { description?: string } };
    throw new Error(
      `Browser evaluation failed: ${detail.exception?.description?.split("\n")[0] ?? "Unknown"}`,
    );
  }
  return (reply.result as { value?: unknown }).value;
}
async function waitFor(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 25000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Browser assertion timeout");
    await Bun.sleep(100);
  }
}
interface Target {
  targetId: string;
  type: string;
  url: string;
}
async function targets(): Promise<Target[]> {
  return (await cdp("Target.getTargets", { filter: [{}] })).targetInfos as Target[];
}
async function attach(targetId: string): Promise<string> {
  return (await cdp("Target.attachToTarget", { targetId, flatten: true })).sessionId as string;
}
const evidence: Record<string, unknown> = {
  date: new Date().toISOString(),
  provider: "local-installed-google-chrome",
  model: null,
  profile: "fresh-temporary",
  mode: "headless-installed-extension",
  steps: [],
};
const steps = evidence.steps as string[];
try {
  // The first reply waits for the browser to start, which a cold runner stretches past the
  // per-call deadline (see BROWSER_STARTUP_MS); later calls keep their own deadline.
  evidence.browser = await cdp("Browser.getVersion", {}, undefined, BROWSER_STARTUP_MS);
  const storageTarget = await cdp("Target.createTarget", {
    url: `http://127.0.0.1:${fixture.port}/storage.html`,
  });
  const storageSession = await attach(String(storageTarget.targetId));
  await waitFor(
    async () => (await evaluate(storageSession, "'storageQualification' in globalThis")) === true,
  );
  evidence.storageProbe = await evaluate(storageSession, "globalThis.storageQualification");
  if ((evidence.storageProbe as { status?: string }).status !== "passed")
    throw new Error("Storage qualification failed");
  evidence.storageBundleSha256 = new Bun.CryptoHasher("sha256").update(storageScript).digest("hex");
  await cdp("Target.closeTarget", { targetId: storageTarget.targetId });
  steps.push("synthetic-production-storage-application-quota-and-native-abort");
  evidence.build = await snapshotBuild(
    join(root, "dist/extensions/chrome"),
    join(profile, "unpacked"),
  );
  evidence.inputHashes = await recipeEvidence(import.meta.path, root, {
    workerReadiness: join(import.meta.dir, "extension-worker.ts"),
    watchdog: join(root, "apps/extension-shared/browser-check-watchdog.ts"),
  });
  const { id } = await cdp("Extensions.loadUnpacked", {
    path: join(profile, "unpacked"),
  });
  if (typeof id !== "string") throw new Error("Extension installation returned no id");
  steps.push("extension-installed");
  let worker: Target | undefined;
  await waitFor(async () => {
    worker = (await targets()).find(
      (target) =>
        target.type === "service_worker" && target.url === `chrome-extension://${id}/background.js`,
    );
    return !!worker;
  });
  const workerSession = await attach(worker?.targetId ?? "");
  // The target is listed before the extension API is bound in the worker (F4): wait for the
  // API the instrumentation below replaces instead of evaluating against an unbound global.
  evidence.workerReadiness = await waitForExtensionWorker(
    (expression) => evaluate(workerSession, expression),
    id,
  );
  await evaluate(
    workerSession,
    "globalThis.qualificationCaptureCalls = 0; const originalCapture = chrome.tabs.captureVisibleTab.bind(chrome.tabs); chrome.tabs.captureVisibleTab = (...args) => { globalThis.qualificationCaptureCalls++; return originalCapture(...args); };",
  );
  evidence.instrumentation = "captureVisibleTab call counter forwarding the original native API";

  await cdp("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: output,
    eventsEnabled: true,
  });
  const { targetId } = await cdp("Target.createTarget", {
    url: `http://127.0.0.1:${fixture.port}/`,
  });
  const page = await attach(String(targetId));
  await waitFor(
    async () =>
      (await evaluate(page, "document.title === 'Signalement synthetic fixture'")) === true,
  );
  await evaluate(
    page,
    "document.getElementById('add').click(); document.getElementById('count').value",
  );
  await cdp("Target.activateTarget", { targetId });
  const tabTarget = (await targets()).find(
    (target) => target.type === "tab" && target.url === `http://127.0.0.1:${fixture.port}/`,
  );
  evidence.targetTypes = (await targets()).map((target) => target.type);
  await cdp("Extensions.triggerAction", { id, targetId: tabTarget?.targetId ?? targetId });
  let popup: Target | undefined;
  await waitFor(async () => {
    popup = (await targets()).find((t) => t.url === `chrome-extension://${id}/popup.html`);
    return !!popup;
  });
  if ((await targets()).some((t) => t.url.includes("/editor.html")))
    throw new Error("Popup collected without capture action");
  if ((await evaluate(workerSession, "globalThis.qualificationCaptureCalls")) !== 0)
    throw new Error("Popup invoked capture without explicit action");
  steps.push("popup-open-zero-native-capture-calls");
  const popupSession = await attach(popup?.targetId ?? "");
  await waitFor(
    async () => (await evaluate(popupSession, "document.readyState === 'complete'")) === true,
  );
  await evaluate(popupSession, "document.getElementById('capture').click()");
  let editor: Target | undefined;
  await waitFor(async () => {
    editor = (await targets()).find((t) =>
      t.url.startsWith(`chrome-extension://${id}/editor.html`),
    );
    return !!editor;
  });
  let session = await attach(editor?.targetId ?? "");
  // The editor target exists before its document is parsed; reading the
  // preview element earlier throws instead of letting waitFor poll again.
  await waitFor(
    async () => (await evaluate(session, "document.readyState === 'complete'")) === true,
  );
  await waitFor(
    async () =>
      (await evaluate(
        session,
        "document.getElementById('screenshot')?.hidden === false && document.getElementById('screenshot').naturalWidth > 0",
      )) === true,
  );
  if ((await evaluate(workerSession, "globalThis.qualificationCaptureCalls")) !== 1)
    throw new Error("Expected exactly one explicit native capture");
  steps.push("explicit-active-tab-capture-preview");
  const fill = async (id: string, value: string) =>
    evaluate(
      session,
      `document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(value)};document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event('input',{bubbles:true}));`,
    );
  const click = async (id: string) =>
    evaluate(session, `document.getElementById(${JSON.stringify(id)}).click()`);
  const status = async (text: string) =>
    waitFor(
      async () =>
        (await evaluate(
          session,
          `document.getElementById('status')?.textContent?.includes(${JSON.stringify(text)})`,
        )) === true,
    );
  for (const [id, value] of Object.entries({
    expected: "Counter shows 1",
    observed: "Counter shows 2",
    application: "Synthetic fixture",
    environment: "Disposable local browser",
    steps: "Open fixture\nClick Add item",
    x: "0",
    y: "0",
    width: "400",
    height: "300",
  }))
    await fill(id, value);
  await click("crop");
  await status("Pixels modifiés");
  await click("mask");
  await status("Pixels modifiés");
  await waitFor(
    async () =>
      (await evaluate(
        session,
        `(async()=>{const image=document.getElementById('screenshot');const bitmap=await createImageBitmap(await (await fetch(image.src)).blob());const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);const pixels=context.getImageData(0,0,bitmap.width,bitmap.height).data;return bitmap.width===400&&bitmap.height===300&&pixels.every((value,index)=>value===(index%4===3?255:0));})()`,
      )) === true,
  );
  steps.push("decoded-redaction-every-pixel-opaque-black");
  await fill("passphrase", "synthetic qualification phrase");
  await click("unlock");
  await status("Coffre déverrouillé");
  await click("save");
  await status("Brouillon chiffré enregistré");
  const envelopeSnapshot = async () =>
    evaluate(
      session,
      `(async()=>{const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('signalement-encrypted-drafts',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});try{const item=await new Promise((resolve,reject)=>{const request=db.transaction('vault','readonly').objectStore('vault').get('encrypted');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});return {revision:item.revision,ciphertextHash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',item.ciphertext)),byte=>byte.toString(16).padStart(2,'0')).join('')};}finally{db.close();}})()`,
    );
  const beforeQuota = await envelopeSnapshot();
  const originalDraftId = await evaluate(session, "document.getElementById('drafts').value");
  const knownEditors = new Set(
    (await targets())
      .filter((target) => target.url.includes("/editor.html"))
      .map((target) => target.targetId),
  );
  await cdp("Target.activateTarget", { targetId });
  await cdp(
    "Emulation.setDeviceMetricsOverride",
    { width: 1100, height: 1200, deviceScaleFactor: 1, mobile: false },
    page,
  );
  await evaluate(
    page,
    `(async()=>{const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=1024;const context=canvas.getContext('2d');const data=context.createImageData(1024,1024);const bytes=new Uint8Array(data.data.buffer);for(let offset=0;offset<bytes.length;offset+=65536)crypto.getRandomValues(bytes.subarray(offset,Math.min(offset+65536,bytes.length)));for(let offset=3;offset<bytes.length;offset+=4)bytes[offset]=255;context.putImageData(data,0,0);document.body.replaceChildren(canvas);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return true;})()`,
  );
  await cdp("Target.activateTarget", { targetId });
  await cdp("Extensions.triggerAction", { id, targetId: tabTarget?.targetId ?? targetId });
  let quotaPopup: Target | undefined;
  await waitFor(async () => {
    quotaPopup = (await targets()).find(
      (target) => target.url === `chrome-extension://${id}/popup.html`,
    );
    return !!quotaPopup;
  });
  const quotaPopupSession = await attach(quotaPopup?.targetId ?? "");
  await waitFor(
    async () => (await evaluate(quotaPopupSession, "document.readyState === 'complete'")) === true,
  );
  await evaluate(quotaPopupSession, "document.getElementById('capture').click()");
  let quotaEditor: Target | undefined;
  await waitFor(async () => {
    quotaEditor = (await targets()).find(
      (target) =>
        target.type === "page" &&
        target.url.startsWith(`chrome-extension://${id}/editor.html`) &&
        !knownEditors.has(target.targetId),
    );
    return !!quotaEditor;
  });
  session = await attach(quotaEditor?.targetId ?? "");
  await waitFor(
    async () =>
      (await evaluate(session, "document.getElementById('screenshot')?.naturalWidth > 0")) === true,
  );
  await fill("passphrase", "synthetic qualification phrase");
  await click("unlock");
  await status("Coffre déverrouillé");
  steps.push("synthetic-noise-capture-prepared");
  const origin = `chrome-extension://${id}`;
  await evaluate(
    session,
    "globalThis.qualificationStorageAbort=null;const nativeTransaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){const transaction=nativeTransaction.apply(this,args);transaction.addEventListener('abort',()=>{globalThis.qualificationStorageAbort=transaction.error?.name??null;});return transaction;};",
  );
  let quotaApplied = false;
  try {
    await cdp("Storage.overrideQuotaForOrigin", { origin, quotaSize: 1 }, session);
    quotaApplied = true;
    const quota = await cdp("Storage.getUsageAndQuota", { origin }, session);
    if (quota.overrideActive !== true || quota.quota !== 1)
      throw new Error("Native quota override unavailable for extension origin");
    evidence.quota = { overrideAccepted: true, advertisedQuota: 1 };
    await click("save");
    await waitFor(
      async () =>
        (await evaluate(
          session,
          "document.getElementById('status')?.textContent.includes('Opération refusée') || document.getElementById('status')?.textContent.includes('Brouillon chiffré enregistré')",
        )) === true,
    );
    const nativeError = await evaluate(session, "globalThis.qualificationStorageAbort");
    if (nativeError !== "QuotaExceededError")
      throw new Error("CDP Storage.overrideQuotaForOrigin did not cause native QuotaExceededError");
    if (JSON.stringify(await envelopeSnapshot()) !== JSON.stringify(beforeQuota))
      throw new Error("Quota failure changed durable draft bytes or revision");
    evidence.quota = { nativeError, preservedCiphertextAndRevision: true };
    steps.push("native-extension-quota-refusal-preserves-draft-revision-and-bytes");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("CDP Storage.")) throw error;
    evidence.quota = { status: "unverified", reason: error.message };
  } finally {
    if (quotaApplied) await cdp("Storage.overrideQuotaForOrigin", { origin }, session);
  }
  const durableBeforeRestart = await envelopeSnapshot();
  await click("lock");
  await status("Coffre verrouillé");
  await cdp("Page.reload", {}, session);
  await status("Aucune capture");
  await fill("passphrase", "synthetic qualification phrase");
  await click("unlock");
  await status("Coffre déverrouillé");
  await fill("drafts", String(originalDraftId));
  await click("load");
  await status("Brouillon repris");
  if ((await evaluate(session, "document.getElementById('observed').value")) !== "Counter shows 2")
    throw new Error("Draft mismatch");
  steps.push("encrypted-draft-save-lock-page-reload-unlock-resume");
  const previous = current;
  const exited = new Promise<void>((resolveExit, rejectExit) => {
    const timer = setTimeout(() => rejectExit(new Error("Browser shutdown timeout")), 25000);
    previous.child.once("exit", () => {
      clearTimeout(timer);
      resolveExit();
    });
  });
  await cdp("Browser.close");
  await exited;
  previous.reader.removeListener("data", handleMessage);
  current = launchBrowser();
  pending = "";
  current.reader.on("data", handleMessage);
  await cdp("Browser.getVersion", {}, undefined, BROWSER_STARTUP_MS);
  const installed = await cdp("Extensions.getExtensions");
  if (!(installed.extensions as { id: string }[]).some((extension) => extension.id === id)) {
    const restored = await cdp("Extensions.loadUnpacked", { path: join(profile, "unpacked") });
    if (restored.id !== id) throw new Error("Extension identity changed across browser restart");
  }
  const freshEditor = await cdp("Target.createTarget", {
    url: `chrome-extension://${id}/editor.html`,
  });
  session = await attach(String(freshEditor.targetId));
  await status("Aucune capture");
  if (
    (await evaluate(
      session,
      "document.getElementById('passphrase').value === '' && document.getElementById('screenshot').hidden",
    )) !== true
  )
    throw new Error("Restart restored unlocked or raw state");
  await click("load");
  await status("Opération refusée");
  await fill("passphrase", "synthetic qualification phrase");
  await click("unlock");
  await status("Coffre déverrouillé");
  await fill("drafts", String(originalDraftId));
  await click("load");
  await status("Brouillon repris");
  if (
    (await evaluate(session, "document.getElementById('observed').value")) !== "Counter shows 2" ||
    JSON.stringify(await envelopeSnapshot()) !== JSON.stringify(durableBeforeRestart)
  )
    throw new Error("Browser restart lost or changed saved draft");
  evidence.restart = {
    newProcess: current.child.pid !== previous.child.pid,
    lockedBeforePhrase: true,
    durableBytesAndRevisionPreserved: true,
  };
  if (current.child.pid === previous.child.pid) throw new Error("Browser process did not change");
  steps.push("browser-process-restart-locked-key-and-durable-draft-resume");
  await cdp("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: output,
    eventsEnabled: true,
  });

  await click("prepare");
  await status("Revue exacte prête");
  const reviewedHash = await evaluate(
    session,
    "(async()=>{const bytes=await (await fetch(document.getElementById('review-image').src)).arrayBuffer();return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');})()",
  );
  await evaluate(session, "document.getElementById('approved').checked=true");
  await click("export");
  await status("Téléchargement");
  await waitFor(async () => (await readdir(output)).includes("signalement-dossier.zip"));
  const verify = Bun.spawn(
    [
      process.execPath,
      join(root, "tools/contracts/verify-export.ts"),
      join(output, "signalement-dossier.zip"),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const verdict = await new Response(verify.stdout).text();
  if ((await verify.exited) !== 0 || !JSON.parse(verdict).valid)
    throw new Error("Independent export verifier rejected");
  const exportedFiles = readZip(
    new Uint8Array(await Bun.file(join(output, "signalement-dossier.zip")).arrayBuffer()),
  );
  const exportedMedia = exportedFiles.filter((file) => file.path.endsWith(".png"));
  if (
    exportedMedia.length !== 1 ||
    new Bun.CryptoHasher("sha256")
      .update(exportedMedia[0]?.bytes ?? new Uint8Array())
      .digest("hex") !== reviewedHash
  )
    throw new Error("Export media differs from exact reviewed bytes");
  evidence.reviewedMediaSha256 = reviewedHash;
  steps.push("downloaded-zip-independent-verifier");
  // The receipt keeps recording the native quota shortfall as `partial`; the
  // exit code below is decided by the receipt policy, not by this status alone.
  if ((evidence.quota as { status?: string }).status === "unverified") evidence.status = "partial";
  else evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  evidence.reason = error instanceof Error ? error.message : "Unknown failure";
} finally {
  for (const call of calls.values()) clearTimeout(call.timer);
  calls.clear();
  current.child.kill("SIGKILL");
  await new Promise<void>((resolveClose) => {
    if (current.child.exitCode !== null || current.child.signalCode !== null) resolveClose();
    else current.child.once("exit", () => resolveClose());
  });
  fixture.stop(true);
  await rm(profile, { recursive: true, force: true });
  await Bun.write(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
  const failures = receiptFailures(evidence, nativeQuotaPolicy);
  console.log(`${receiptSummary(evidence)} (native quota policy: ${nativeQuotaPolicy})`);
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  }
}
