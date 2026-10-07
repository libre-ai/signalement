import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../tests/fixtures/capture-app");
Bun.serve({
  hostname: "127.0.0.1",
  port: 43187,
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    const file = pathname === "/" ? "index.html" : pathname === "/fixture.js" ? "fixture.js" : null;
    if (file === null) return new Response("Not found", { status: 404 });
    return new Response(Bun.file(resolve(root, file)), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'",
      },
    });
  },
});
console.info("Synthetic fixture listening on loopback port 43187");
