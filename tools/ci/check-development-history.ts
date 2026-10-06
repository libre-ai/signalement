import { inspectDevelopmentHistory } from "./development-history";

if (import.meta.main) {
  try {
    if (Bun.argv.length !== 2) throw new Error("Unexpected arguments");
    const expectedSha = process.env.EXPECTED_HEAD_SHA;
    if (process.env.CI && expectedSha === undefined) throw new Error("Expected SHA required");
    const result = await inspectDevelopmentHistory(process.cwd(), expectedSha);
    if (result.findings.length > 0) throw new Error("Development history rejected");
    console.log(
      `Development history verified: ${result.commitCount} commit(s), ${result.objectCount} object(s), 0 findings`,
    );
  } catch {
    console.error("Development history check failed");
    process.exitCode = 1;
  }
}
