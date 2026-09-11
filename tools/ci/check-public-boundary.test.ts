import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseIndexEntries, readCounterproofFile, readIndexFiles } from "./check-public-boundary";

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

interface SyntheticIndexGitContext {
  readonly admittedObjectId: string;
  readonly requestLog: string;
  readonly root: string;
}

async function withSyntheticIndexGit(
  admittedType: "blob" | "tree",
  action: (context: SyntheticIndexGitContext) => Promise<void>,
): Promise<void> {
  const root = await createRepository();
  const executableDirectory = await mkdtemp(join(tmpdir(), "signalement-index-git-helper-"));
  temporaryDirectories.push(executableDirectory);
  const requestLog = join(executableDirectory, "body-request.txt");
  const executable = join(executableDirectory, "git");
  const largeObjectId = "a".repeat(40);
  const admittedObjectId = "b".repeat(40);
  await writeFile(
    executable,
    [
      "#!/bin/sh",
      'if [ "$1" = "ls-files" ]; then',
      `  printf '100644 ${largeObjectId} 0\\tlarge.txt\\000100644 ${admittedObjectId} 0\\tsafe.txt\\000'`,
      'elif [ "$1" = "cat-file" ] && [ "$2" = "--batch-check" ]; then',
      "  /bin/cat >/dev/null",
      `  printf '${largeObjectId} blob 5\\n${admittedObjectId} ${admittedType} 4\\n'`,
      'elif [ "$1" = "cat-file" ] && [ "$2" = "--batch" ]; then',
      '  /bin/cat >"$SIGNALEMENT_BODY_REQUEST_LOG"',
      `  printf '${admittedObjectId} ${admittedType} 4\\nsafe\\n'`,
      "else",
      "  exit 1",
      "fi",
    ].join("\n"),
  );
  await chmod(executable, 0o755);
  const originalPath = process.env.PATH;
  const originalLog = process.env.SIGNALEMENT_BODY_REQUEST_LOG;
  process.env.PATH = `${executableDirectory}:${originalPath ?? ""}`;
  process.env.SIGNALEMENT_BODY_REQUEST_LOG = requestLog;

  try {
    await action({ admittedObjectId, requestLog, root });
  } finally {
    process.env.PATH = originalPath;
    if (originalLog === undefined) {
      delete process.env.SIGNALEMENT_BODY_REQUEST_LOG;
    } else {
      process.env.SIGNALEMENT_BODY_REQUEST_LOG = originalLog;
    }
  }
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

  test("reads staged bytes by object ID when the working-tree file is absent", async () => {
    const root = await createRepository();
    const path = join(root, "removed-after-stage.txt");
    await writeFile(path, "approved staged content");
    await run(["git", "add", "removed-after-stage.txt"], root);
    await unlink(path);

    const files = await readIndexFiles(root);

    expect(files).toEqual([
      {
        path: "removed-after-stage.txt",
        content: new TextEncoder().encode("approved staged content"),
      },
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

  test("excludes over-limit object IDs from the batch body request", async () => {
    await withSyntheticIndexGit("blob", async ({ admittedObjectId, requestLog, root }) => {
      const files = await readIndexFiles(root, { maxFileBytes: 4 });

      expect(files).toEqual([
        { path: "large.txt", content: new Uint8Array(), declaredByteLength: 5 },
        { path: "safe.txt", content: new TextEncoder().encode("safe") },
      ]);
      expect(await readFile(requestLog, "utf8")).toBe(`${admittedObjectId}\n`);
    });
  });

  test("refuses an index object claimed as a non-blob", async () => {
    await withSyntheticIndexGit("tree", async ({ root }) => {
      await expect(readIndexFiles(root, { maxFileBytes: 4 })).rejects.toThrow(
        "Git data is invalid",
      );
    });
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

  test("shares one bounded object body across two index paths", async () => {
    const root = await createRepository();
    await writeFile(join(root, "first.txt"), "same");
    await writeFile(join(root, "second.txt"), "same");
    await run(["git", "add", "first.txt", "second.txt"], root);

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const files = await Promise.race([
        readIndexFiles(root, { maxTreeBytes: 8 }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error("bounded object read timed out")), 1_000);
        }),
      ]);

      expect(files).toHaveLength(2);
      expect(files[0]).toEqual({
        path: "first.txt",
        content: new TextEncoder().encode("same"),
      });
      expect(files[1]).toEqual({
        path: "second.txt",
        content: new TextEncoder().encode("same"),
      });
      expect(files[0]?.content).toBe(files[1]?.content);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  });

  test("does not follow a staged symlink outside the materialized index", async () => {
    const root = await createRepository();
    const target = join(root, "unstaged-private-source.txt");
    await writeFile(target, "must not be loaded");
    await symlink(target, join(root, "public-link.txt"));
    await run(["git", "add", "public-link.txt"], root);

    await expect(readIndexFiles(root)).rejects.toThrow("Git data is invalid");
  });

  test("refuses the index-entry bound before loading object bodies", async () => {
    const root = await createRepository();
    await writeFile(join(root, "first.txt"), "first");
    await writeFile(join(root, "second.txt"), "second");
    await run(["git", "add", "first.txt", "second.txt"], root);

    await expect(readIndexFiles(root, { maxIndexEntries: 1 })).rejects.toThrow(
      "Git data is invalid",
    );
  });

  test("refuses an overlong UTF-8 path component", async () => {
    const root = await createRepository();
    await writeFile(join(root, "é.txt"), "safe");
    await run(["git", "add", "é.txt"], root);

    await expect(readIndexFiles(root, { maxPathComponentBytes: 5 })).rejects.toThrow(
      "Git data is invalid",
    );
  });

  for (const testCase of [
    { name: "malformed stage", record: `100644 ${"a".repeat(40)} 1\tfile.txt\0` },
    { name: "malformed object ID", record: "100644 not-an-object 0\tfile.txt\0" },
    { name: "unsupported mode", record: `120000 ${"a".repeat(40)} 0\tfile.txt\0` },
    { name: "missing terminator", record: `100644 ${"a".repeat(40)} 0\tfile.txt` },
  ]) {
    test(`refuses ${testCase.name}`, () => {
      expect(() => parseIndexEntries(new TextEncoder().encode(testCase.record))).toThrow(
        "Git data is invalid",
      );
    });
  }
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
