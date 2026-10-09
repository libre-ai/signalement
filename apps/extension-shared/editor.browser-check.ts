import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  awaitProgress,
  BROWSER_FIXTURE_BUDGETS,
  browserLogTail,
  startStageClock,
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
  entrypoints: [join(import.meta.dir, "editor.browser-fixture.ts")],
  target: "browser",
});
if (!build.success || !build.outputs[0]) {
  console.error("Editor fixture build failed", build.logs);
  process.exit(1);
}
const script = await build.outputs[0].text();
const html = (await Bun.file(join(import.meta.dir, "editor.html")).text()).replace(
  'src="editor.js"',
  'src="fixture.js"',
);
let result: unknown = null;
// This check runs warm in CI only because the video check pays the cold Chrome launch before it;
// one 20 s clock from spawn would fail it whenever it ran first. Startup and each fixture check
// are bounded separately instead (see BROWSER_FIXTURE_BUDGETS).
const clock = startStageClock();
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/fixture.js") {
      clock.mark("fixture-requested");
      return new Response(script, { headers: { "Content-Type": "application/javascript" } });
    }
    if (path === "/progress" && request.method === "POST") {
      clock.mark(await request.text());
      return new Response("ok");
    }
    if (path === "/styles.css") return new Response(Bun.file(join(import.meta.dir, "styles.css")));
    if (path === "/result" && request.method === "POST") {
      result = await request.json();
      clock.mark("result");
      return new Response("ok");
    }
    if (path === "/") clock.mark("page-requested");
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  },
});
const profile = await mkdtemp(join(tmpdir(), "signalement-synthetic-editor-"));
const child = Bun.spawn(
  [
    chromeBinary,
    "--headless=new",
    ...(process.argv.includes("--audio-fixture")
      ? ["--autoplay-policy=no-user-gesture-required"]
      : []),
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    `http://127.0.0.1:${server.port}/${process.argv.includes("--init-lock") ? "?init-lock" : process.argv.includes("--audio-fixture") ? "?audio-fixture" : ""}`,
  ],
  // Drained concurrently: an unread pipe that fills would block Chrome itself.
  { stdout: "ignore", stderr: "pipe" },
);
const browserLog = new Response(child.stderr).text();
clock.mark("browser-spawned");
try {
  const stall = await awaitProgress(() => result !== null, clock, BROWSER_FIXTURE_BUDGETS);
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
