import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  awaitProgress,
  browserLogTail,
  startStageClock,
  VIDEO_CHECK_BUDGETS,
} from "./browser-check-watchdog.ts";

const chromeBinary =
  process.env.CHROME_BINARY ??
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "google-chrome");
// Resolve before allocating the server/profile so a missing executable leaves no resources.
if (!Bun.which(chromeBinary)) {
  console.error("Chrome executable unavailable; set CHROME_BINARY to the installed browser.");
  process.exit(1);
}

const build = await Bun.build({
  entrypoints: [join(import.meta.dir, "video.browser-fixture.ts")],
  target: "browser",
});
if (!build.success || !build.outputs[0]) {
  console.error("Editor fixture build failed", build.logs);
  process.exit(1);
}
const script = await build.outputs[0].text();
const html = '<!doctype html><script type="module" src="fixture.js"></script>';
let result: unknown = null;
// Stage beacons replace a single wall clock: the fixture's duration is a sum of real-time media
// clocks plus browser startup, so only the silence between beacons separates a stall from a slow
// cold start (see VIDEO_CHECK_BUDGETS for the measurements).
const clock = startStageClock();
const mark = clock.mark;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/fixture.js") {
      mark("fixture-requested");
      return new Response(script, { headers: { "Content-Type": "application/javascript" } });
    }
    if (path === "/progress" && request.method === "POST") {
      mark(await request.text());
      return new Response("ok");
    }
    if (path === "/styles.css") return new Response(Bun.file(join(import.meta.dir, "styles.css")));
    if (path === "/result" && request.method === "POST") {
      result = await request.json();
      mark("result");
      return new Response("ok");
    }
    if (path === "/") mark("page-requested");
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  },
});
const profile = await mkdtemp(join(tmpdir(), "signalement-synthetic-video-"));
const child = Bun.spawn(
  [
    chromeBinary,
    "--headless=new",
    "--autoplay-policy=no-user-gesture-required",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    `http://127.0.0.1:${server.port}/`,
  ],
  // Drained concurrently: an unread pipe that fills would block Chrome itself.
  { stdout: "ignore", stderr: "pipe" },
);
const browserLog = new Response(child.stderr).text();
mark("browser-spawned");
try {
  const stall = await awaitProgress(() => result !== null, clock, VIDEO_CHECK_BUDGETS);
  const verdict = result ?? { status: "unverified", reason: stall };
  console.info(JSON.stringify({ ...(verdict as object), timeline: clock.timeline }));
  if (result === null || (result as { status: string }).status !== "passed") process.exitCode = 1;
} finally {
  child.kill();
  await child.exited;
  if (process.exitCode === 1) {
    const tail = browserLogTail(await browserLog);
    if (tail !== null) console.error(tail);
  }
  server.stop(true);
  await rm(profile, { recursive: true, force: true });
}
