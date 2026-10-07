import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { readZip } from "../../packages/domain/zip";
import { recipeEvidence, snapshotBuild } from "./evidence";
import { popupRdpScript } from "./popup-rdp";

const root = resolve(import.meta.dir, "../..");
const temporary = await mkdtemp(join(tmpdir(), "signalement-firefox-qualification-"));
const output = join(root, "test-results/browser-check/firefox", crypto.randomUUID());
await mkdir(output, { recursive: true });
const fixture = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path !== "/" && path !== "/fixture.js") return new Response("Not found", { status: 404 });
    return new Response(
      Bun.file(
        join(root, "tests/fixtures/capture-app", path === "/" ? "index.html" : "fixture.js"),
      ),
    );
  },
});
const reservation = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch() {
    return new Response("");
  },
});
const port = reservation.port;
reservation.stop(true);
const driver = Bun.spawn(
  [
    process.env.GECKODRIVER_BINARY ?? "/tmp/signalement-browser-driver/geckodriver",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--allow-system-access",
    "--profile-root",
    temporary,
  ],
  { stdout: "ignore", stderr: "ignore" },
);
let session = "";
let bidi: WebSocket | null = null;
let bidiId = 0;
async function bidiCommand(
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const socketCandidate = bidi;
  if (!socketCandidate) throw new Error("BiDi unavailable");
  const socket: WebSocket = socketCandidate;
  const id = ++bidiId;
  return new Promise((resolveCommand, rejectCommand) => {
    const timer = setTimeout(() => {
      socket.removeEventListener("message", listener);
      rejectCommand(new Error("BiDi timeout"));
    }, 25000);
    function listener(event: MessageEvent) {
      const response = JSON.parse(String(event.data));
      if (response.id !== id) return;
      clearTimeout(timer);
      socket.removeEventListener("message", listener);
      if (response.type === "error")
        rejectCommand(new Error(`BiDi ${response.error}: ${response.message}`));
      else resolveCommand(response.result);
    }
    socket.addEventListener("message", listener);
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function request(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(25000),
  });
  const data = (await response.json()) as { value: unknown };
  if (!response.ok) throw new Error(JSON.stringify(data.value));
  return data.value;
}
async function command(path: string, body?: unknown, method?: string): Promise<unknown> {
  return request(`/session/${session}${path}`, body, method);
}
async function evaluate(script: string): Promise<unknown> {
  return command("/execute/sync", { script, args: [] });
}
async function evaluateAsync(expression: string): Promise<unknown> {
  const result = (await command("/execute/async", {
    script: `const done=arguments[arguments.length-1];Promise.resolve(${expression}).then(value=>done({value}),error=>done({error:String(error)}));`,
    args: [],
  })) as { value?: unknown; error?: string };
  if (result.error) throw new Error(`Async browser assertion failed: ${result.error}`);
  return result.value;
}
async function editorRdp(expression: string): Promise<unknown> {
  const editorUrl = await evaluate("return location.href;");
  await command("/moz/context", { context: "chrome" });
  try {
    const result = (await command("/execute/async", {
      args: [],
      script: `
        const done = arguments[arguments.length - 1];
        (async () => {
          const addonId = 'signalement@libre-ai.invalid';
          const { require } = ChromeUtils.importESModule('resource://devtools/shared/loader/Loader.sys.mjs');
          const { CommandsFactory } = require('resource://devtools/shared/commands/commands-factory.js');
          const commands = await CommandsFactory.forAddon(addonId);
          try {
            await commands.targetCommand.startListening();
            const targets = commands.targetCommand.getAllTargets(['frame']).filter(
              item => item.url === ${JSON.stringify(editorUrl)});
            if (targets.length !== 1) throw new Error('Editor target mismatch');
            const response = await commands.scriptCommand.execute(
              ${JSON.stringify(expression)}, { selectedTargetFront: targets[0] });
            if (response.exception) throw new Error('Editor observer failed');
            return { value: response.result };
          } finally {
            await commands.destroy();
          }
        })().then(done, () => done({ error: true }));
      `,
    })) as { value?: unknown; error?: boolean };
    if (result.error) throw new Error("Editor RDP observation failed");
    return result.value;
  } finally {
    await command("/moz/context", { context: "content" });
  }
}
async function waitFor(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 25000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Browser assertion timeout");
    await Bun.sleep(100);
  }
}
const evidence: Record<string, unknown> = {
  date: new Date().toISOString(),
  provider: "local-installed-firefox",
  model: null,
  profile: "fresh-temporary",
  mode:
    process.env.BROWSER_HEADLESS === "1"
      ? "headless-installed-extension"
      : "headed-installed-extension",
  steps: [],
};
const steps = evidence.steps as string[];
try {
  await waitFor(async () => {
    try {
      await request("/status");
      return true;
    } catch {
      return false;
    }
  });
  const started = (await request("/session", {
    capabilities: {
      alwaysMatch: {
        browserName: "firefox",
        webSocketUrl: true,
        "moz:firefoxOptions": {
          binary: process.env.FIREFOX_BINARY ?? "/Applications/Firefox.app/Contents/MacOS/firefox",
          args: process.env.BROWSER_HEADLESS === "1" ? ["-headless"] : [],
          prefs: {
            "browser.download.folderList": 2,
            "browser.download.dir": output,
            "browser.helperApps.neverAsk.saveToDisk": "application/zip",
          },
        },
      },
    },
  })) as { sessionId: string; capabilities: { browserVersion: string; webSocketUrl: string } };
  session = started.sessionId;
  bidi = new WebSocket(started.capabilities.webSocketUrl);
  await new Promise<void>((resolveSocket, rejectSocket) => {
    const timer = setTimeout(() => rejectSocket(new Error("BiDi connection timeout")), 25000);
    bidi?.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolveSocket();
      },
      { once: true },
    );
  });
  evidence.browser = started.capabilities.browserVersion;
  evidence.driver = "0.37.1";
  evidence.build = await snapshotBuild(
    join(root, "dist/extensions/firefox"),
    join(temporary, "unpacked"),
  );
  evidence.inputHashes = await recipeEvidence(import.meta.path, root);
  const addon = await command("/moz/addon/install", {
    path: join(temporary, "unpacked"),
    temporary: true,
  });
  if (addon !== "signalement@libre-ai.invalid") throw new Error("Unexpected installed addon");
  steps.push("extension-installed");
  await command("/url", { url: `http://127.0.0.1:${fixture.port}/` });
  await waitFor(
    async () =>
      (await evaluate("return document.title === 'Signalement synthetic fixture';")) === true,
  );
  await evaluate("document.getElementById('add').click();");
  await evaluate("document.title = 'Signalement qualification temporary fixture';");
  await command("/moz/context", { context: "chrome" });
  evidence.chromeUi = await evaluate(
    "return Array.from(document.querySelectorAll('toolbarbutton')).filter(n=>n.id.includes('signalement')||n.getAttribute('label')?.includes('Signalement')).map(n=>({id:n.id,label:n.getAttribute('label')}));",
  );
  await evaluate("document.getElementById('unified-extensions-button').click();");
  await waitFor(
    async () =>
      (await evaluate(
        "return !!document.querySelector('[data-extensionid=\"signalement@libre-ai.invalid\"]');",
      )) === true,
  );
  await evaluate(
    "document.querySelector('[data-extensionid=\"signalement@libre-ai.invalid\"] .unified-extensions-item-action-button').click();",
  );
  await waitFor(
    async () =>
      (await evaluate(
        "return !!document.querySelector('browser[webextension-view-type=popup]');",
      )) === true,
  );
  steps.push("action-popup-opened");
  if (((await command("/window/handles")) as string[]).length !== 1)
    throw new Error("Popup opening unexpectedly created an editor");
  steps.push("popup-open-no-editor-before-explicit-click");
  await waitFor(
    async () =>
      (await evaluate(
        "return document.querySelector('browser[webextension-view-type=popup]').currentURI.spec.startsWith('moz-extension:');",
      )) === true,
  );
  await waitFor(
    async () =>
      (await evaluate(
        "return document.querySelector('browser[webextension-view-type=popup]').closest('panel')?.state === 'open';",
      )) === true,
  );
  const screenshot = await command("/screenshot");
  if (typeof screenshot === "string")
    await Bun.write(join(output, "popup.png"), Buffer.from(screenshot, "base64"));

  evidence.popupState = await evaluate(
    "const b=document.querySelector('browser[webextension-view-type=popup]');return {uri:b.currentURI.spec,context:String(b.browsingContext.id),browserId:String(b.browsingContext.browserId),panel:b.closest('panel')?.state};",
  );
  evidence.bidiContexts = await bidiCommand("browsingContext.getTree", {});
  evidence.popupRectangle = await evaluate(
    "const b=document.querySelector('browser[webextension-view-type=popup]');const r=b.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,screenX:window.mozInnerScreenX,screenY:window.mozInnerScreenY};",
  );
  await command("/timeouts", { script: 15000 });
  evidence.popupInteraction = "native-action-activeTab-then-devtools-dom-click-no-permission-grant";
  evidence.popupRecipeSha256 = new Bun.CryptoHasher("sha256").update(popupRdpScript).digest("hex");
  try {
    evidence.popupDispatch = await command("/execute/async", { script: popupRdpScript, args: [] });
  } catch {
    evidence.popupDispatch = { status: "response-unavailable-reconcile-editor-before-any-retry" };
  }
  await command("/moz/context", { context: "content" });
  await waitFor(async () => ((await command("/window/handles")) as string[]).length > 1);
  const handles = (await command("/window/handles")) as string[];
  await command("/window", { handle: handles.at(-1) });
  await waitFor(
    async () =>
      (await evaluate(
        "return !document.getElementById('screenshot')?.hidden && document.getElementById('screenshot')?.naturalWidth>0;",
      )) === true,
  );
  steps.push("explicit-active-tab-capture-preview");
  const fill = async (id: string, value: string) =>
    evaluate(
      `document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(value)};document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event('input',{bubbles:true}));`,
    );
  const click = async (id: string) =>
    evaluate(`document.getElementById(${JSON.stringify(id)}).click();`);
  const status = async (text: string) =>
    waitFor(
      async () =>
        (await evaluate(
          `return document.getElementById('status')?.textContent?.includes(${JSON.stringify(text)});`,
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
  const pixelsMatch = await evaluateAsync(
    `(async()=>{const image=document.getElementById('screenshot');const bitmap=await createImageBitmap(image);const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);const pixels=context.getImageData(0,0,bitmap.width,bitmap.height).data;return bitmap.width===400&&bitmap.height===300&&pixels.every((value,index)=>value===(index%4===3?255:0));})()`,
  );
  if (pixelsMatch !== true) throw new Error("Decoded redaction pixel mismatch");
  steps.push("decoded-redaction-every-pixel-opaque-black");
  await fill("passphrase", "synthetic qualification phrase");
  await click("unlock");
  await status("Coffre déverrouillé");
  await click("save");
  await status("Brouillon chiffré enregistré");
  await click("lock");
  await status("Coffre verrouillé");
  await command("/refresh", {});
  await status("Aucune capture");
  await fill("passphrase", "synthetic qualification phrase");
  await click("unlock");
  await status("Coffre déverrouillé");
  await click("load");
  await status("Brouillon repris");
  if ((await evaluate("return document.getElementById('observed').value;")) !== "Counter shows 2")
    throw new Error("Resumed draft mismatch");
  steps.push("encrypted-draft-save-lock-page-reload-unlock-resume");
  await editorRdp(
    "globalThis.qualificationHashes=new Map();const native=URL.createObjectURL;URL.createObjectURL=function(blob){const url=native.call(this,blob);blob.arrayBuffer().then(bytes=>crypto.subtle.digest('SHA-256',bytes)).then(hash=>globalThis.qualificationHashes.set(url,Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('')));return url;};true",
  );
  await click("prepare");
  await status("Revue exacte prête");
  let reviewedHash: unknown;
  await waitFor(async () => {
    reviewedHash = await editorRdp(
      "globalThis.qualificationHashes.get(document.getElementById('review-image').src) || null",
    );
    return typeof reviewedHash === "string" && reviewedHash.length === 64;
  });
  await evaluate("document.getElementById('approved').checked=true;");
  await click("export");
  await status("Téléchargement");
  await waitFor(async () => (await readdir(output)).includes("signalement-dossier.zip"));
  const exportPath = join(output, "signalement-dossier.zip");
  const verification = Bun.spawn(
    [process.execPath, join(root, "tools/contracts/verify-export.ts"), exportPath],
    { stdout: "pipe", stderr: "pipe" },
  );
  const verdict = await new Response(verification.stdout).text();
  if ((await verification.exited) !== 0 || !JSON.parse(verdict).valid)
    throw new Error("Independent ZIP verifier rejected");
  const media = readZip(new Uint8Array(await Bun.file(exportPath).arrayBuffer())).filter((file) =>
    file.path.endsWith(".png"),
  );
  if (
    media.length !== 1 ||
    new Bun.CryptoHasher("sha256").update(media[0]?.bytes ?? new Uint8Array()).digest("hex") !==
      reviewedHash
  )
    throw new Error("Export differs from reviewed bytes");
  evidence.reviewedMediaSha256 = reviewedHash;
  steps.push("downloaded-zip-independent-verifier-and-exact-reviewed-media");
  evidence.status = "passed";
} catch (error) {
  evidence.status = "blocked";
  evidence.reason = error instanceof Error ? error.message : "Unknown failure";
  process.exitCode = 1;
} finally {
  bidi?.close();
  if (session)
    try {
      await command("", undefined, "DELETE");
    } catch {}
  driver.kill();
  await driver.exited;
  fixture.stop(true);
  await rm(temporary, { recursive: true, force: true });
  await Bun.write(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
}
