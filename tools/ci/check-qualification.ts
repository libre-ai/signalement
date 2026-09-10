import { readIndexFiles } from "./check-public-boundary";
import { validateQualificationDocuments } from "./qualification";

async function main(): Promise<void> {
  const root = process.cwd();
  const indexFiles = await readIndexFiles(root);
  const availablePaths = new Set(indexFiles.map(({ path }) => path));
  const qualificationFiles = indexFiles.filter(
    ({ path }) => path.startsWith("qualification/") && path.endsWith(".yaml"),
  );
  const documents = new Map<string, unknown>();
  for (const file of qualificationFiles) {
    try {
      const content =
        typeof file.content === "string"
          ? file.content
          : new TextDecoder("utf-8", { fatal: true }).decode(file.content);
      documents.set(file.path, Bun.YAML.parse(content));
    } catch {
      documents.set(file.path, null);
    }
  }

  const findings = validateQualificationDocuments(documents, availablePaths);
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`${finding.path}: ${finding.code} (${finding.detail})`);
    }
    throw new Error(`Qualification baseline rejected ${findings.length} finding(s)`);
  }
  console.log(`Qualification baseline verified: ${documents.size} document(s), 0 findings`);
}

if (import.meta.main) {
  try {
    await main();
  } catch {
    console.error("Qualification check failed");
    process.exitCode = 1;
  }
}
