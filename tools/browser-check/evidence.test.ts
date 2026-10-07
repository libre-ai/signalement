import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { snapshotBuild } from "./evidence";

test("copies exactly the hashed extension build and rejects mutated bytes", async () => {
  const source = await mkdtemp(join(tmpdir(), "signalement-build-evidence-test-"));
  try {
    const files = [];
    for (const path of [
      "background.js",
      "popup.js",
      "editor.js",
      "popup.html",
      "editor.html",
      "styles.css",
      "manifest.json",
      "THIRD-PARTY-NOTICES.txt",
    ]) {
      const bytes = new TextEncoder().encode(path);
      await writeFile(join(source, path), bytes);
      files.push({ path, sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") });
    }
    await writeFile(join(source, "build-evidence.json"), JSON.stringify({ files }));
    const destination = join(source, "snapshot");
    expect(await snapshotBuild(source, destination)).toEqual({ files });
    expect(await readFile(join(destination, "editor.js"), "utf8")).toBe("editor.js");
    await writeFile(join(source, "editor.js"), "mutated");
    await expect(snapshotBuild(source, join(source, "changed"))).rejects.toThrow(
      "Build digest mismatch",
    );
  } finally {
    await rm(source, { recursive: true, force: true });
  }
});
