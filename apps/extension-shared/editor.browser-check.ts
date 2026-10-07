import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/fixture.js")
      return new Response(script, { headers: { "Content-Type": "application/javascript" } });
    if (path === "/styles.css") return new Response(Bun.file(join(import.meta.dir, "styles.css")));
    if (path === "/result" && request.method === "POST") {
      result = await request.json();
      return new Response("ok");
    }
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
  { stdout: "ignore", stderr: "ignore" },
);
try {
  const end = Date.now() + 20000;
  while (result === null && Date.now() < end) await Bun.sleep(100);
  console.info(JSON.stringify(result ?? { status: "unverified", reason: "20-second timeout" }));
  if (result === null || (result as { status: string }).status !== "passed") process.exitCode = 1;
} finally {
  child.kill();
  await child.exited;
  server.stop(true);
  await rm(profile, { recursive: true, force: true });
}
