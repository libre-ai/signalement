import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  awaitProgress,
  startStageClock,
  VIDEO_CHECK_BUDGETS,
} from "../../apps/extension-shared/browser-check-watchdog";

const root = resolve(import.meta.dir, "../..");
const build = await Bun.build({
  entrypoints: [join(root, "apps/extension-shared/video.browser-fixture.ts")],
  target: "browser",
  plugins: [
    {
      name: "synthetic-container-diagnostics",
      setup(builder) {
        builder.onLoad({ filter: /video\.browser-fixture\.ts$/ }, async (args) => {
          const original = await Bun.file(args.path).text();
          const contents = original
            .replace("import { sanitizeWebm }", "import { sanitizeWebm, webmStructure }")
            .replace(
              "bytes: sanitizeWebm(raw.bytes, audio)",
              'bytes: (()=>{try{return sanitizeWebm(raw.bytes,audio);}catch{throw new Error("Synthetic container structure: "+webmStructure(raw.bytes).join(","));}})()',
            );
          if (contents === original) throw new Error("Diagnostic fixture transform unavailable");
          return { contents, loader: "ts" };
        });
      },
    },
  ],
});
if (!build.success || !build.outputs[0]) throw new Error("Video fixture build failed");
const script = await build.outputs[0].text();
const profile = await mkdtemp(join(tmpdir(), "signalement-firefox-video-"));
const output = join(root, "test-results/browser-check/firefox-video", crypto.randomUUID());
await mkdir(output, { recursive: true });
await writeFile(
  join(profile, "user.js"),
  'user_pref("media.autoplay.default", 0);\nuser_pref("media.autoplay.block-webaudio", false);\n',
);
let result: unknown = null;
const stages: string[] = [];
// Same fixture and the same real-time media clocks as the Chrome video check: startup and each
// media stage are bounded separately rather than by one clock from spawn.
const clock = startStageClock();
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/progress" && request.method === "POST") {
      const stage = await request.text();
      if (stages.length < 256) stages.push(stage);
      clock.mark(stage);
      return new Response("ok");
    }
    if (path === "/fixture.js") {
      clock.mark("fixture-requested");
      return new Response(script, { headers: { "Content-Type": "application/javascript" } });
    }
    if (path === "/result" && request.method === "POST") {
      result = await request.json();
      clock.mark("result");
      return new Response("ok");
    }
    if (path === "/") {
      clock.mark("page-requested");
      return new Response(
        `<!doctype html><title>Synthetic video qualification</title><script>const ids=new WeakMap();let next=0;function report(object,event){if(!ids.has(object)){ids.set(object,++next);for(const type of ['playing','pause','seeking','seeked','ended','stop','error'])object.addEventListener(type,()=>fetch('/progress',{method:'POST',body:ids.get(object)+':'+type}));}fetch('/progress',{method:'POST',body:ids.get(object)+':'+event});}for(const [prototype,name] of [[HTMLVideoElement.prototype,'play'],[HTMLVideoElement.prototype,'requestVideoFrameCallback'],[MediaRecorder.prototype,'start'],[MediaRecorder.prototype,'stop'],[AudioContext.prototype,'resume']]){const original=prototype[name];prototype[name]=function(...args){report(this,name);return original.apply(this,args);};}</script><script type="module" src="fixture.js"></script>`,
        { headers: { "Content-Type": "text/html" } },
      );
    }
    return new Response("Not found", { status: 404 });
  },
});
const binary = process.env.FIREFOX_BINARY ?? "/Applications/Firefox.app/Contents/MacOS/firefox";
const version = Bun.spawn([binary, "--version"], { stdout: "pipe", stderr: "ignore" });
const browser = (await new Response(version.stdout).text()).trim();
if ((await version.exited) !== 0) throw new Error("Browser identity unavailable");
const child = Bun.spawn(
  [binary, "-no-remote", "-headless", "-profile", profile, `http://127.0.0.1:${server.port}/`],
  { stdout: "ignore", stderr: "ignore" },
);
clock.mark("browser-spawned");
const evidence: Record<string, unknown> = {
  date: new Date().toISOString(),
  browser,
  provider: "local-installed-firefox",
  model: null,
  profile: "fresh-temporary",
  scope: "synthetic-video-pipeline-only-not-extension-permissions",
  autoplay: "allowed-only-in-disposable-fixture-profile",
  bundleSha256: new Bun.CryptoHasher("sha256").update(script).digest("hex"),
  recipeSha256: new Bun.CryptoHasher("sha256")
    .update(await Bun.file(import.meta.path).arrayBuffer())
    .digest("hex"),
};
try {
  const stall = await awaitProgress(() => result !== null, clock, VIDEO_CHECK_BUDGETS);
  evidence.stages = stages;
  evidence.timeline = clock.timeline;
  evidence.result = result ?? { status: "unverified", reason: stall };
  if (result === null || (result as { status?: string }).status !== "passed") process.exitCode = 1;
} finally {
  child.kill();
  await child.exited;
  server.stop(true);
  await rm(profile, { recursive: true, force: true });
  await Bun.write(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
}
