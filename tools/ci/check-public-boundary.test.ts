import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readCounterproofFile, readIndexFiles } from "./check-public-boundary";

const temporaryDirectories: string[] = [];

async function run(command: readonly string[], cwd: string): Promise<void> {
  const process = Bun.spawn([...command], { cwd, stdout: "pipe", stderr: "pipe" });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`command failed with exit code ${exitCode}`);
  }
}

async function createRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "signalement-boundary-test-"));
  temporaryDirectories.push(root);
  await run(["git", "init", "--quiet"], root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("readIndexFiles", () => {
  test("reads staged bytes rather than modified working-tree bytes", async () => {
    const root = await createRepository();
    const path = join(root, "report.txt");
    await writeFile(path, "approved staged content");
    await run(["git", "add", "report.txt"], root);
    await writeFile(path, ["Author", "ization: ", "Bear", "er changed_after_stage"].join(""));

    const files = await readIndexFiles(root);

    expect(files).toEqual([
      { path: "report.txt", content: new TextEncoder().encode("approved staged content") },
    ]);
  });

  test("fails closed when the index is empty", async () => {
    const root = await createRepository();

    await expect(readIndexFiles(root)).rejects.toThrow("Git index contains no files");
  });

  test("does not load a staged file beyond the configured per-file bound", async () => {
    const root = await createRepository();
    await writeFile(join(root, "large.txt"), "12345");
    await run(["git", "add", "large.txt"], root);

    const files = await readIndexFiles(root, { maxFileBytes: 4 });

    expect(files).toEqual([
      { path: "large.txt", content: new Uint8Array(), declaredByteLength: 5 },
    ]);
  });

  test("stops loading bytes after the configured cumulative tree bound", async () => {
    const root = await createRepository();
    await writeFile(join(root, "first.txt"), "1234");
    await writeFile(join(root, "second.txt"), "5678");
    await run(["git", "add", "first.txt", "second.txt"], root);

    const files = await readIndexFiles(root, { maxTreeBytes: 4 });

    expect(files).toEqual([
      { path: "first.txt", content: new TextEncoder().encode("1234") },
      { path: "second.txt", content: new Uint8Array(), declaredByteLength: 4 },
    ]);
  });

  test("does not follow a staged symlink outside the materialized index", async () => {
    const root = await createRepository();
    const target = join(root, "unstaged-private-source.txt");
    await writeFile(target, "must not be loaded");
    await symlink(target, join(root, "public-link.txt"));
    await run(["git", "add", "public-link.txt"], root);

    await expect(readIndexFiles(root)).rejects.toThrow("Unsupported Git index mode");
  });
});

describe("readCounterproofFile", () => {
  test("does not expose the ambient absolute path in the public file label", async () => {
    const root = await createRepository();
    const path = join(root, "counterproof.txt");
    await writeFile(path, "synthetic canary");

    const file = await readCounterproofFile(path);

    expect(file.path).toBe("counterproof/counterproof.txt");
    expect(file.path).not.toContain(root);
  });

  test("rejects a canary without leaking ambient paths or captured bytes", async () => {
    const root = await createRepository();
    const path = join(root, "counterproof.txt");
    const canary = ["Author", "ization: ", "Bear", "er synthetic-cli-canary"].join("");
    await writeFile(path, canary);

    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, "check-public-boundary.ts"), "--path", path],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    const output = `${stdout}${stderr}`;

    expect(exitCode).toBe(1);
    expect(output).toContain("counterproof/counterproof.txt: captured-credential");
    expect(output).not.toContain(process.cwd());
    expect(output).not.toContain(root);
    expect(output).not.toContain(canary);
  });
});
