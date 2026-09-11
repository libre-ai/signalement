import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parsePublicHistoryArguments } from "./check-public-history";

async function run(
  command: readonly string[],
  cwd: string,
): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const child = Bun.spawn([...command], { cwd, stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stderr, stdout };
}

async function createCliRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "signalement-history-cli-"));
  for (const command of [
    ["git", "init", "--quiet", "--initial-branch=main"],
    ["git", "config", "user.name", "Constantin Jais"],
    [
      "git",
      "config",
      "user.email",
      ["74049135+constantin-jais", "@users.noreply.github.com"].join(""),
    ],
  ]) {
    const result = await run(command, root);
    if (result.exitCode !== 0) throw new Error("Unable to create CLI test repository");
  }
  return root;
}

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
    const result = await run(
      [process.execPath, join(import.meta.dir, "check-public-history.ts"), "--unknown"],
      process.cwd(),
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.exitCode).toBe(1);
    expect(output).toContain("Public history check failed");
    expect(output).not.toContain(process.cwd());
  });

  test("prints one canonical v2 manifest line and reports the tree-entry count", async () => {
    const root = await createCliRepository();
    try {
      expect(
        (
          await run(
            ["git", "commit", "--quiet", "--allow-empty", "--signoff", "-m", "test: empty"],
            root,
          )
        ).exitCode,
      ).toBe(0);
      const result = await run(
        [process.execPath, join(import.meta.dir, "check-public-history.ts"), "--print-manifest"],
        root,
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim().split("\n")).toHaveLength(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        gitObjectFormat: "sha1",
        repository: "libre-ai/signalement",
        schemaVersion: "libre-ai.git-object-manifest.v2",
        treeEntries: expect.any(Array),
      });
      expect(result.stderr).toMatch(/\d+ tree entr(?:y|ies)/);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  test("keeps a rejected tree name and object ID out of CLI diagnostics", async () => {
    const root = await createCliRepository();
    const privateTreeName = "confidential-tree-name.jsonl";
    try {
      await writeFile(join(root, privateTreeName), "synthetic");
      for (const command of [
        ["git", "add", privateTreeName],
        ["git", "commit", "--quiet", "--signoff", "-m", "test: rejected tree"],
      ]) {
        expect((await run(command, root)).exitCode).toBe(0);
      }
      const objectIdResult = await run(["git", "rev-parse", "HEAD"], root);
      const objectId = objectIdResult.stdout.trim();
      expect(objectIdResult.exitCode).toBe(0);

      const result = await run(
        [process.execPath, join(import.meta.dir, "check-public-history.ts"), "--print-manifest"],
        root,
      );
      const output = `${result.stdout}${result.stderr}`;

      expect(result.exitCode).toBe(1);
      expect(output.trim()).toBe("Public history check failed");
      expect(output).not.toContain(privateTreeName);
      expect(output).not.toContain(objectId);
      expect(output).not.toContain(root);
    } finally {
      await rm(root, { recursive: true });
    }
  });
});
