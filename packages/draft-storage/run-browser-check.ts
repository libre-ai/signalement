import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const build = await Bun.build({
  entrypoints: [join(import.meta.dir, "browser-fixture.ts")],
  target: "browser",
});
if (!build.success || !build.outputs[0]) throw new Error("Build failed");
const script = await build.outputs[0].text();
const profile = await mkdtemp(join(tmpdir(), "signalement-synthetic-idb-"));
let result: unknown = null;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/script.js")
      return new Response(script, { headers: { "Content-Type": "application/javascript" } });
    if (path === "/result" && request.method === "POST") {
      result = await request.json();
      return new Response("ok");
    }
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
  { stdout: "ignore", stderr: "ignore" },
);
try {
  const deadline = Date.now() + 20000;
  while (result === null && Date.now() < deadline) await Bun.sleep(100);
  console.info(JSON.stringify(result ?? { status: "unverified", reason: "20-second timeout" }));
  if (result === null || (result as { status: string }).status !== "passed") process.exitCode = 1;
} finally {
  child.kill();
  await child.exited;
  server.stop(true);
  await rm(profile, { recursive: true, force: true });
}
