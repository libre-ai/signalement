import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  awaitProgress,
  BROWSER_FIXTURE_BUDGETS,
  browserLogTail,
  startStageClock,
} from "../../apps/extension-shared/browser-check-watchdog.ts";

const build = await Bun.build({
  entrypoints: [join(import.meta.dir, "browser-fixture.ts")],
  target: "browser",
});
if (!build.success || !build.outputs[0]) throw new Error("Build failed");
const script = await build.outputs[0].text();
const profile = await mkdtemp(join(tmpdir(), "signalement-synthetic-idb-"));
let result: unknown = null;
// Browser startup and each storage check are bounded separately, as for the editor and video
// checks: a cold first launch alone has been measured past the former 20 s clock from spawn.
const clock = startStageClock();
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/script.js") {
      clock.mark("fixture-requested");
      return new Response(script, { headers: { "Content-Type": "application/javascript" } });
    }
    if (path === "/progress" && request.method === "POST") {
      clock.mark(await request.text());
      return new Response("ok");
    }
    if (path === "/result" && request.method === "POST") {
      result = await request.json();
      clock.mark("result");
      return new Response("ok");
    }
    if (path === "/") clock.mark("page-requested");
    return new Response(
      '<!doctype html><title>Synthetic IDB check</title><script type="module" src="/script.js"></script>',
      { headers: { "Content-Type": "text/html" } },
    );
  },
});
const child = Bun.spawn(
  [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "--headless=new",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    `http://127.0.0.1:${server.port}/`,
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
