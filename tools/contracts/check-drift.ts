import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pin from "../../vendor/contracts/pin.json";
import { generatedValidator } from "./generate-validator.ts";

export async function driftFailures(): Promise<string[]> {
  const failures: string[] = [];
  const root = new URL("../../vendor/contracts/", import.meta.url);
  // Pin the inventory itself: editing a vendored file and its listed hash must
  // not manufacture conformance to the immutable upstream revision.
  if (
    createHash("sha256")
      .update(await readFile(new URL("pin.json", root)))
      .digest("hex") !== "84f5e4d8ca32193439947775dff04759508878677329d471d1e4f1772db60c97"
  )
    return ["pin.digest"];
  if (
    pin.repository !== "https://github.com/libre-ai/contracts" ||
    pin.commit !== "812c7d8b64976054201a0da6a3af2ce93bf9cc0b" ||
    pin.contract !== "signalement-local-export-v1" ||
    pin.status !== "locked"
  )
    failures.push("pin.identity");
  const declared = new Set(Object.keys(pin.files));
  async function walk(path: string, prefix: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) await walk(resolve(path, entry.name), `${relative}/`);
      else if (!entry.isFile() || (relative !== "pin.json" && !declared.has(relative)))
        failures.push("vendor.inventory");
    }
  }
  await walk(root.pathname, "");
  for (const [path, expected] of Object.entries(pin.files)) {
    const bytes = await readFile(new URL(path, root));
    if (createHash("sha256").update(bytes).digest("hex") !== expected)
      failures.push(`vendor.drift:${path}`);
  }
  const catalog = JSON.parse(await readFile(new URL("contracts/catalog.v1.json", root), "utf8"));
  const entry = catalog.contracts.find(
    (candidate: { id: string }) => candidate.id === pin.contract,
  );
  if (entry?.status !== "locked" || "review" in entry) failures.push("contract.not_locked");
  if (
    (await readFile(
      new URL("../../packages/domain/schema-validator.js", import.meta.url),
      "utf8",
    )) !== generatedValidator()
  )
    failures.push("validator.drift");
  return failures;
}
if (import.meta.main) {
  const failures = await driftFailures();
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else console.log("Locked contract pin, byte-exact vendor and generated validator verified.");
}
