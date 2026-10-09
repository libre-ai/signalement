import { expect, test } from "bun:test";
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
