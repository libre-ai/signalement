import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];

interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface CheckoutFixture {
  readonly root: string;
  readonly sha: string;
}

async function run(cwd: string, command: string[], env = process.env): Promise<CommandResult> {
  const child = Bun.spawn(command, { cwd, env, stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

async function git(root: string, ...args: string[]): Promise<string> {
  const result = await run(root, ["git", ...args]);
  expect(result.exitCode).toBe(0);
  return result.stdout.trim();
}

async function fixture(): Promise<CheckoutFixture> {
  const root = await mkdtemp(join(tmpdir(), "signalement-bootstrap-checkout-"));
  roots.push(root);
  await git(root, "init", "--quiet", "--initial-branch=main");
  await git(root, "config", "user.name", "Constantin Jais");
  await git(
    root,
    "config",
    "user.email",
    ["74049135+constantin-jais", "@users.noreply.github.com"].join(""),
  );
  await git(root, "commit", "--quiet", "--allow-empty", "--signoff", "-m", "test: bootstrap");
  const sha = await git(root, "rev-parse", "HEAD");
  await git(root, "update-ref", "refs/remotes/origin/main", sha);
  return { root, sha };
}

async function prepare(
  root: string,
  sha: string,
  overrides: Readonly<Record<string, string>> = {},
): Promise<CommandResult> {
  return await run(root, ["sh", join(import.meta.dir, "prepare-bootstrap-checkout.sh")], {
    ...process.env,
    GITHUB_ACTIONS: "true",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: sha,
    ...overrides,
  });
}

async function inventory(root: string): Promise<string> {
  return await git(root, "for-each-ref", "--format=%(refname) %(objectname) %(symref)");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("bootstrap checkout preparation", () => {
  test("restores the unchanged exact-main history policy after a synthetic checkout", async () => {
    const { root, sha } = await fixture();
    const command = [process.execPath, join(import.meta.dir, "check-public-history.ts")];
    expect((await run(root, command)).exitCode).toBe(1);
    expect((await prepare(root, sha)).exitCode).toBe(0);
    expect(await inventory(root)).toBe(`refs/heads/main ${sha}`);
    expect(await git(root, "rev-parse", "HEAD")).toBe(sha);
    expect((await run(root, command)).exitCode).toBe(0);
  });

  for (const ref of [
    "refs/heads/other",
    "refs/tags/extra",
    "refs/remotes/origin/other",
    "refs/notes/extra",
  ]) {
    test(`rejects an unexpected ${ref} without deleting any ref`, async () => {
      const { root, sha } = await fixture();
      await git(root, "update-ref", ref, sha);
      const before = await inventory(root);
      expect((await prepare(root, sha)).exitCode).toBe(1);
      expect(await inventory(root)).toBe(before);
    });
  }

  test("rejects a mismatched tracking ref without deleting it", async () => {
    const { root, sha } = await fixture();
    await git(root, "commit", "--quiet", "--allow-empty", "--signoff", "-m", "test: second");
    const before = await inventory(root);
    expect((await prepare(root, await git(root, "rev-parse", "HEAD"))).exitCode).toBe(1);
    expect(await inventory(root)).toBe(before);
    expect(await git(root, "rev-parse", "refs/remotes/origin/main")).toBe(sha);
  });

  for (const overrides of [
    { GITHUB_SHA: "a".repeat(40) },
    { GITHUB_SHA: "invalid" },
    { GITHUB_ACTIONS: "false" },
    { GITHUB_REF: "refs/pull/1/merge" },
  ]) {
    test(`rejects an invalid environment ${JSON.stringify(overrides)} without mutation`, async () => {
      const { root, sha } = await fixture();
      const before = await inventory(root);
      expect((await prepare(root, sha, overrides)).exitCode).toBe(1);
      expect(await inventory(root)).toBe(before);
    });
  }

  test("rejects detached HEAD without mutation", async () => {
    const { root, sha } = await fixture();
    await git(root, "checkout", "--quiet", "--detach", sha);
    const before = await inventory(root);
    expect((await prepare(root, sha)).exitCode).toBe(1);
    expect(await inventory(root)).toBe(before);
  });

  test("rejects a symbolic tracking ref without mutation", async () => {
    const { root, sha } = await fixture();
    await git(root, "symbolic-ref", "refs/remotes/origin/main", "refs/heads/main");
    const before = await inventory(root);
    expect((await prepare(root, sha)).exitCode).toBe(1);
    expect(await inventory(root)).toBe(before);
  });
});
