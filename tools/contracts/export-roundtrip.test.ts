import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildReview } from "../../packages/domain/export.ts";
import { readZip, writeZip } from "../../packages/domain/zip.ts";
import { vendoredDriftFailures } from "./check-drift.ts";
import { writeValidator } from "./generate-validator.ts";
import { inspectExportFile, verifyExport } from "./verify-export.ts";

async function review() {
  return buildReview(
    {
      id: "synthetic-dossier",
      revision: 1,
      createdAt: "2026-10-07T10:00:00Z",
      expected: "Panel é 😀",
      observed: "No panel",
      application: "Synthetic",
      environment: "Synthetic browser",
      steps: ["Open panel"],
      media: [],
    },
    "2026-10-07T10:01:00Z",
  );
}
// Invariant B5: the local export contract v1 is frozen. These digests were read from the v1
// pin and from the committed validator before the pin was generalized to several contracts
// (`shasum -a 256`); they are not derived from pin.json, so editing a vendored file together
// with its pin entry cannot make this test follow it.
const LOCAL_EXPORT_NORMATIVE_BYTES: Record<string, string> = {
  "vendor/contracts/contracts/schemas/signalement-local-export.v1.schema.json":
    "ddb63e43cfa76253079df8b10cb31ee4575927cfc22226d4a7942e4c51d83d0e",
  "vendor/contracts/contracts/fixtures/signalement-local-export-v1/synthetic.json":
    "c763a48514fb0a41c436ad676aec69ede52a7c71013f7540aa988bca2cdff051",
  "vendor/contracts/contracts/fixtures/signalement-local-export-v1/schema-fixtures.json":
    "8a16b467ecf29f37d2f92ed85ab622685e2ce89988d9fd9b9b43819973d51049",
  "vendor/contracts/tools/quality/signalement-local-export-v1.ts":
    "b330fa75b4f7a647740476f6bcde7f1ca5d28d987e533553e683a77d645a7d00",
  "vendor/contracts/tools/quality/authorized-execution.ts":
    "5fa4744a5a80a1de8ea44e22fce03abce89dde39e16b09ae364a85a31be63f0e",
  "vendor/contracts/tools/quality/policy-core-raw-inputs.ts":
    "94fc29b0b479be581c063a6c8a566f076319d1f4bd372c82291b7a71b7dcc389",
  "packages/domain/schema-validator.js":
    "f472cc21b5aafec75019d1f5e95be614f2955af9e70259aa0ad28b2c789bed3a",
};
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("local export normative files keep their bytes", async () => {
  expect(Object.keys(LOCAL_EXPORT_NORMATIVE_BYTES)).toHaveLength(7);
  for (const [path, expected] of Object.entries(LOCAL_EXPORT_NORMATIVE_BYTES))
    expect([path, sha256(await Bun.file(path).bytes())]).toEqual([path, expected]);
});
test("vendor is pinned byte-exact and generated schema is reproducible", async () =>
  expect(await vendoredDriftFailures()).toEqual([]));
test("fresh independent authority consumer accepts ZIP and rejects changed inventory/content", async () => {
  const bytes = await (await review()).toZip();
  expect(verifyExport(bytes)).toEqual([]);
  const files = readZip(bytes);
  const document = files.find((file) => file.path === "README.md");
  if (!document) throw new Error("Missing fixture");
  document.bytes[0] = 0;
  expect(verifyExport(writeZip(files))).toContain("file.digest_mismatch");
  const extra = readZip(bytes);
  extra.push({ path: "media/unapproved.png", bytes: new Uint8Array([1]) });
  expect(verifyExport(writeZip(extra))).toContain("file.inventory_mismatch");
  expect(verifyExport(new Uint8Array())).toEqual(["archive.invalid"]);
});
test("Python zipfile and independent canonical SHA oracle validate actual archive", async () => {
  const directory = await mkdtemp(join(tmpdir(), "signalement-synthetic-zip-"));
  try {
    const generated = join(directory, "validator.js");
    await writeValidator(pathToFileURL(generated));
    expect(await Bun.file(generated).text()).toBe(
      await Bun.file("packages/domain/schema-validator.js").text(),
    );
    expect((await inspectExportFile(undefined)).exitCode).toBe(2);
    expect((await inspectExportFile(join(directory, "missing.zip"))).report.failures).toEqual([
      "archive.unreadable",
    ]);
    const bad = join(directory, "bad.zip");
    await Bun.write(bad, "not an archive");
    expect((await inspectExportFile(bad)).report.failures).toEqual(["archive.invalid"]);
    const path = join(directory, "synthetic.zip");
    await Bun.write(path, await (await review()).toZip());
    expect((await inspectExportFile(path)).exitCode).toBe(0);
    const recipe = `import zipfile,json,hashlib,sys\nwith zipfile.ZipFile(sys.argv[1]) as z:\n assert z.testzip() is None\n assert all(i.compress_type==zipfile.ZIP_STORED for i in z.infolist())\n m=json.loads(z.read('manifest.json'))\n assert sorted(z.namelist())==sorted(['manifest.json']+[f['path'] for f in m['payload']['files']])\n assert len(z.namelist())==len(set(z.namelist()))\n for f in m['payload']['files']:\n  b=z.read(f['path']); assert len(b)==f['byteLength']; assert hashlib.sha256(b).hexdigest()==f['sha256']\n assert z.read('README.md')==m['payload']['document']['text'].encode('utf-8')\n canonical=json.dumps(m['payload'],ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf-8')\n assert hashlib.sha256(canonical).hexdigest()==m['approval']['payloadDigest']\n assert m['payload']['reviewedAt']==m['approval']['approvedAt']==m['exportedAt']\nprint('independent-oracle-ok')`;
    const process = Bun.spawn(["python3", "-c", recipe, path], { stdout: "pipe", stderr: "pipe" });
    expect(await process.exited).toBe(0);
    expect(await new Response(process.stdout).text()).toBe("independent-oracle-ok\n");
    const cli = Bun.spawn(["bun", "tools/contracts/verify-export.ts", path], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await cli.exited).toBe(0);
    expect(JSON.parse(await new Response(cli.stdout).text())).toEqual({
      valid: true,
      scope: "local-export-integrity-only",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
