import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FILES = [
  "background.js",
  "popup.js",
  "editor.js",
  "popup.html",
  "editor.html",
  "styles.css",
  "manifest.json",
];
export async function snapshotBuild(source: string, destination: string): Promise<unknown> {
  const evidence: unknown = JSON.parse(await readFile(join(source, "build-evidence.json"), "utf8"));
  if (
    !evidence ||
    typeof evidence !== "object" ||
    !("files" in evidence) ||
    !Array.isArray(evidence.files) ||
    evidence.files.length < FILES.length ||
    evidence.files.length > 32
  )
    throw new Error("Build inventory mismatch");
  const entries = new Map<string, Uint8Array>();
  for (const entry of evidence.files) {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.path !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(entry.path) ||
      entries.has(entry.path) ||
      typeof entry.sha256 !== "string"
    )
      throw new Error("Build inventory mismatch");
    const metadata = await lstat(join(source, entry.path));
    if (!metadata.isFile() || metadata.size > 4 * 1024 * 1024)
      throw new Error("Build file rejected");
    const bytes = await readFile(join(source, entry.path));
    if (new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== entry.sha256)
      throw new Error("Build digest mismatch");
    entries.set(entry.path, bytes);
  }
  if (FILES.some((path) => !entries.has(path))) throw new Error("Build inventory mismatch");
  await mkdir(destination, { recursive: true });
  for (const [path, bytes] of entries) await writeFile(join(destination, path), bytes);
  return evidence;
}
export async function recipeEvidence(
  recipe: string,
  root: string,
  // Modules the recipe imports for its own control flow: without their hash the receipt would
  // bind a recipe whose behaviour can change underneath it.
  helpers: Readonly<Record<string, string>> = {},
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [label, path] of [
    ["recipe", recipe],
    ["buildVerifier", join(import.meta.dir, "evidence.ts")],
    ["fixtureHtml", join(root, "tests/fixtures/capture-app/index.html")],
    ["fixtureScript", join(root, "tests/fixtures/capture-app/fixture.js")],
    ...Object.entries(helpers),
  ]) {
    if (label === undefined || path === undefined) throw new Error("Evidence recipe missing");
    result[label] = new Bun.CryptoHasher("sha256").update(await readFile(path)).digest("hex");
  }
  return result;
}
