import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  batchOutputByteLength,
  type GitObjectMetadata,
  GitProcessError,
  parseBatchCheckOutput,
  parseBatchOutput,
  runGitBounded,
} from "./git-process";

const temporaryDirectories: string[] = [];
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

async function createRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "signalement-git-process-test-"));
  temporaryDirectories.push(root);
  const process = Bun.spawn(["git", "init", "--quiet"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await process.exited).toBe(0);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("runGitBounded", () => {
  test("terminates overflowing stdout without returning a prefix or sensitive diagnostics", async () => {
    const root = await createRepository();
    const sensitiveContent = `private-marker-${"x".repeat(128 * 1024)}`;
    const object = Bun.spawn(["git", "hash-object", "-w", "--stdin"], {
      cwd: root,
      stdin: new Blob([sensitiveContent]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const objectId = (await new Response(object.stdout).text()).trim();
    expect(await object.exited).toBe(0);

    let failure: unknown;
    try {
      await runGitBounded(["cat-file", "blob", objectId], {
        cwd: root,
        maxStdoutBytes: 32,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(GitProcessError);
    expect((failure as GitProcessError).code).toBe("stdout-overflow");
    expect(String(failure)).toBe("GitProcessError: Git process failed");
    expect(String(failure)).not.toContain(root);
    expect(String(failure)).not.toContain(objectId);
    expect(String(failure)).not.toContain("private-marker");
  });

  test("preserves a non-zero exit code as data", async () => {
    const root = await createRepository();

    const result = await runGitBounded(["rev-parse", "--verify", "refs/heads/absent"], {
      cwd: root,
      maxStdoutBytes: 32,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toEqual(new Uint8Array());
  });

  test("drains stderr concurrently when it exceeds pipe capacity", async () => {
    const root = await createRepository();
    const executableDirectory = await mkdtemp(join(tmpdir(), "signalement-git-helper-"));
    temporaryDirectories.push(executableDirectory);
    const executable = join(executableDirectory, "emit-stderr");
    await writeFile(
      executable,
      ["#!/bin/sh", "/bin/dd if=/dev/zero bs=1048576 count=2 2>/dev/null >&2", 'printf "ok"'].join(
        "\n",
      ),
    );
    await chmod(executable, 0o755);
    const configured = await runGitBounded(
      ["config", "alias.synthetic-command", `!${executable}`],
      { cwd: root, maxStdoutBytes: 0 },
    );
    expect(configured.exitCode).toBe(0);

    const result = await runGitBounded(["synthetic-command"], {
      cwd: root,
      maxStdoutBytes: 2,
    });
    expect(result).toEqual({ exitCode: 0, stdout: new TextEncoder().encode("ok") });
  });
});

describe("Git batch parsers", () => {
  test("accepts exact metadata for the requested object set", () => {
    const output = new TextEncoder().encode(`${SHA_B} tree 12\n${SHA_A} blob 4\n`);

    expect(parseBatchCheckOutput(output, [SHA_A, SHA_B])).toEqual([
      { objectId: SHA_A, type: "blob", size: 4 },
      { objectId: SHA_B, type: "tree", size: 12 },
    ]);
  });

  for (const testCase of [
    { name: "missing metadata", value: `${SHA_A} blob 4\n`, requested: [SHA_A, SHA_B] },
    {
      name: "duplicate metadata",
      value: `${SHA_A} blob 4\n${SHA_A} blob 4\n`,
      requested: [SHA_A],
    },
    { name: "extra metadata", value: `${SHA_A} blob 4\n${SHA_B} blob 4\n`, requested: [SHA_A] },
    { name: "invalid type", value: `${SHA_A} mystery 4\n`, requested: [SHA_A] },
    { name: "unsafe size", value: `${SHA_A} blob 9007199254740992\n`, requested: [SHA_A] },
    { name: "missing result", value: `${SHA_A} missing\n`, requested: [SHA_A] },
  ] as const) {
    test(`refuses ${testCase.name}`, () => {
      expect(() =>
        parseBatchCheckOutput(new TextEncoder().encode(testCase.value), testCase.requested),
      ).toThrow("Git data is invalid");
    });
  }

  test("parses exact ordered batch bodies and computes their raw framing bound", () => {
    const metadata = [
      { objectId: SHA_A, type: "blob", size: 4 },
      { objectId: SHA_B, type: "commit", size: 3 },
    ] as const;
    const output = new TextEncoder().encode(`${SHA_A} blob 4\nsafe\n${SHA_B} commit 3\nraw\n`);

    expect(batchOutputByteLength(metadata)).toBe(output.byteLength);
    expect(parseBatchOutput(output, metadata)).toEqual(
      new Map([
        [SHA_A, new TextEncoder().encode("safe")],
        [SHA_B, new TextEncoder().encode("raw")],
      ]),
    );
  });

  for (const testCase of [
    {
      name: "wrong order",
      output: `${SHA_B} blob 3\nraw\n${SHA_A} blob 4\nsafe\n`,
    },
    { name: "missing body delimiter", output: `${SHA_A} blob 4\nsafeX` },
    { name: "truncated body", output: `${SHA_A} blob 4\nsaf` },
    { name: "trailing bytes", output: `${SHA_A} blob 4\nsafe\nextra` },
  ] as const) {
    test(`refuses ${testCase.name}`, () => {
      const metadata: readonly GitObjectMetadata[] = [
        { objectId: SHA_A, type: "blob", size: 4 },
        ...(testCase.name === "wrong order"
          ? [{ objectId: SHA_B, type: "blob" as const, size: 3 }]
          : []),
      ];

      expect(() => parseBatchOutput(new TextEncoder().encode(testCase.output), metadata)).toThrow(
        "Git data is invalid",
      );
    });
  }
});
