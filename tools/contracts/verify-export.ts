import { readZip } from "../../packages/domain/zip.ts";
import { rawLocalExportFailures } from "../../vendor/contracts/tools/quality/signalement-local-export-v1.ts";

/** Fresh consumer: no application draft/state, no network and no filesystem extraction. */
export function verifyExport(bytes: Uint8Array<ArrayBuffer>): string[] {
  let files: ReturnType<typeof readZip>;
  try {
    files = readZip(bytes);
  } catch {
    return ["archive.invalid"];
  }
  const manifest = files.find((file) => file.path === "manifest.json");
  if (!manifest) return ["manifest.missing"];
  return rawLocalExportFailures(
    manifest.bytes,
    files
      .filter((file) => file.path !== "manifest.json")
      .map((file) => ({ ...file, kind: "file" as const })),
  );
}

interface ImportResult {
  exitCode: number;
  report: { valid: boolean; failures?: string[]; scope?: string };
}
export async function inspectExportFile(path: string | undefined): Promise<ImportResult> {
  if (!path) return { exitCode: 2, report: { valid: false, failures: ["archive.path_required"] } };
  try {
    const file = Bun.file(path);
    const limit = 269500416;
    if (file.size > limit) throw new Error("archive.size");
    // Bound every chunk as well as the initial size: a growing input must not
    // bypass the budget between stat and read.
    const reader = file.stream().getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > limit) throw new Error("archive.size");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const failures = verifyExport(bytes);
    return failures.length
      ? { exitCode: 1, report: { valid: false, failures } }
      : { exitCode: 0, report: { valid: true, scope: "local-export-integrity-only" } };
  } catch {
    return { exitCode: 1, report: { valid: false, failures: ["archive.unreadable"] } };
  }
}
if (import.meta.main) {
  const result = await inspectExportFile(process.argv[2]);
  console.log(JSON.stringify(result.report));
  process.exitCode = result.exitCode;
}
