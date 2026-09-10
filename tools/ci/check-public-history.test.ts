import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { parsePublicHistoryArguments } from "./check-public-history";

describe("parsePublicHistoryArguments", () => {
  test("uses the main-ref policy by default", () => {
    expect(parsePublicHistoryArguments([])).toEqual({
      authorizedRefs: undefined,
      printManifest: false,
    });
  });

  test("accepts repeated exact refs and manifest output", () => {
    expect(
      parsePublicHistoryArguments([
        "--ref",
        "refs/heads/main",
        "--ref",
        "refs/tags/v1",
        "--print-manifest",
      ]),
    ).toEqual({
      authorizedRefs: ["refs/heads/main", "refs/tags/v1"],
      printManifest: true,
    });
  });

  const malformedArguments: Array<readonly string[]> = [
    ["--ref"],
    ["--unknown"],
    ["--print-manifest", "extra"],
  ];

  test.each(malformedArguments)("rejects malformed arguments", (arguments_: readonly string[]) => {
    expect(() => parsePublicHistoryArguments(arguments_)).toThrow("Usage:");
  });

  test("reports a CLI refusal without an ambient stack path", async () => {
    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, "check-public-history.ts"), "--unknown"],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    const output = `${stdout}${stderr}`;

    expect(exitCode).toBe(1);
    expect(output).toContain("Public history check failed");
    expect(output).not.toContain(process.cwd());
  });
});
