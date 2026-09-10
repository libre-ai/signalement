import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("check-qualification CLI", () => {
  test("reports an empty-index refusal without an ambient stack path", async () => {
    const root = await mkdtemp(join(tmpdir(), "signalement-qualification-test-"));
    temporaryDirectories.push(root);
    const initialize = Bun.spawn(["git", "init", "--quiet"], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await initialize.exited).toBe(0);

    const child = Bun.spawn([process.execPath, join(import.meta.dir, "check-qualification.ts")], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    const output = `${stdout}${stderr}`;

    expect(exitCode).toBe(1);
    expect(output).toContain("Qualification check failed");
    expect(output).not.toContain(process.cwd());
    expect(output).not.toContain(root);
  });
});
