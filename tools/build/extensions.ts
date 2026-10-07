import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { extensionManifest } from "./manifest";

const root = resolve(import.meta.dir, "../..");
const source = join(root, "apps/extension-shared");
for (const browser of ["chrome", "firefox", "safari"] as const) {
  const outdir = join(root, "dist/extensions", browser);
  await mkdir(outdir, { recursive: true });
  const result = await Bun.build({
    entrypoints: ["background.ts", "popup.ts", "editor.ts"].map((file) => join(source, file)),
    outdir,
    target: "browser",
    format: "iife",
    minify: false,
    sourcemap: "none",
  });
  if (!result.success) throw new AggregateError(result.logs, "Extension build failed");
  for (const name of ["popup.html", "editor.html", "styles.css"])
    await Bun.write(join(outdir, name), Bun.file(join(source, name)));
  await Bun.write(
    join(outdir, "THIRD-PARTY-NOTICES.txt"),
    Bun.file(join(root, "LICENSES/MIT.txt")),
  );
  await Bun.write(join(outdir, "LICENSE.txt"), Bun.file(join(root, "LICENSES/EUPL-1.2.txt")));
  await Bun.write(
    join(outdir, "PROJECT-NOTICE.txt"),
    "Signalement\nCopyright 2026 Libre AI contributors\nLicensed under EUPL-1.2; see LICENSE.txt.\nSource: https://github.com/libre-ai/signalement\nGenerated Ajv validator: MIT; see THIRD-PARTY-NOTICES.txt.\n",
  );
  await Bun.write(
    join(outdir, "manifest.json"),
    `${JSON.stringify(extensionManifest(browser), null, 2)}\n`,
  );
  const files = await Promise.all(
    [
      "background.js",
      "popup.js",
      "editor.js",
      "popup.html",
      "editor.html",
      "styles.css",
      "manifest.json",
      "THIRD-PARTY-NOTICES.txt",
      "LICENSE.txt",
      "PROJECT-NOTICE.txt",
    ].map(async (path) => ({
      path,
      sha256: new Bun.CryptoHasher("sha256")
        .update(await Bun.file(join(outdir, path)).arrayBuffer())
        .digest("hex"),
    })),
  );
  await Bun.write(
    join(outdir, "build-evidence.json"),
    `${JSON.stringify({ browser, qualification: "unverified", runtime: Bun.version, files }, null, 2)}\n`,
  );
  console.info(
    `Built ${browser}: ${files.length} files; capability qualification remains separate`,
  );
}
