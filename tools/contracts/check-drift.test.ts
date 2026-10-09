import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import pin from "../../vendor/contracts/pin.json";
import {
  type AuthorityReader,
  authorityDriftFailures,
  readAuthorityWithGit,
} from "./check-drift.ts";

const paths = Object.keys(pin.files);
const vendor = new URL("../../vendor/contracts/", import.meta.url);

async function run(cwd: string, ...args: string[]): Promise<string> {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Synthetic",
      GIT_AUTHOR_EMAIL: "synthetic@example.invalid",
      GIT_COMMITTER_NAME: "Synthetic",
      GIT_COMMITTER_EMAIL: "synthetic@example.invalid",
    },
  });
  const output = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) throw new Error(`git ${args[0]} failed`);
  return output.trim();
}

/** A local authority serving the vendored bytes: a pinned commit and a later one on `main`. */
async function localAuthority(): Promise<{ root: string; url: string; commit: string }> {
  const root = await mkdtemp(join(tmpdir(), "signalement-authority-test-"));
  const work = join(root, "work");
  await mkdir(work);
  await run(work, "init", "-q", "-b", "main");
  for (const path of paths) {
    await mkdir(dirname(join(work, path)), { recursive: true });
    await writeFile(join(work, path), await readFile(new URL(path, vendor)));
  }
  await run(work, "add", "-A");
  await run(work, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "authority");
  const commit = await run(work, "rev-parse", "HEAD");
  await run(work, "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "later");
  await run(work, "checkout", "-q", "-b", "unmerged", commit);
  await writeFile(join(work, "unmerged.txt"), "side");
  await run(work, "add", "-A");
  await run(work, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "side");
  await run(work, "checkout", "-q", "main");
  const bare = join(root, "authority.git");
  await run(root, "clone", "-q", "--bare", work, bare);
  await run(bare, "config", "uploadpack.allowFilter", "true");
  await run(bare, "config", "uploadpack.allowAnySHA1InWant", "true");
  return { root, url: `file://${bare}`, commit };
}

test("reads every pinned file from the served line of a real git authority", async () => {
  const authority = await localAuthority();
  try {
    const snapshot = await readAuthorityWithGit(authority.url, authority.commit, [
      ...paths,
      "absent/file.json",
    ]);
    if ("failure" in snapshot) throw new Error(snapshot.failure);
    expect(snapshot.servedBranch).toBe("main");
    expect(snapshot.pinOnServedLine).toBe(true);
    expect(snapshot.files.get("absent/file.json")).toBeNull();
    const reader: AuthorityReader = async () => snapshot;
    expect(await authorityDriftFailures(reader)).toEqual({
      failures: [],
      verified: paths.length,
      servedBranch: "main",
    });
    const side = await run(join(authority.root, "work"), "rev-parse", "unmerged");
    const unmerged = await readAuthorityWithGit(authority.url, side, paths);
    if ("failure" in unmerged) throw new Error(unmerged.failure);
    expect(unmerged.pinOnServedLine).toBe(false);
  } finally {
    await rm(authority.root, { recursive: true, force: true });
  }
});

test("an unreachable or unreadable authority is a failure, never an empty pass", async () => {
  const root = await mkdtemp(join(tmpdir(), "signalement-authority-absent-"));
  try {
    expect(await readAuthorityWithGit(`file://${root}/none.git`, "a".repeat(40), paths)).toEqual({
      failure: "authority.unreachable",
    });
    const authority = await localAuthority();
    try {
      expect(await readAuthorityWithGit(authority.url, "b".repeat(40), paths)).toEqual({
        failure: "authority.unreadable",
      });
    } finally {
      await rm(authority.root, { recursive: true, force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  const unreachable: AuthorityReader = async () => ({ failure: "authority.unreachable" });
  expect(await authorityDriftFailures(unreachable)).toEqual({
    failures: ["authority.unreachable"],
    verified: 0,
    servedBranch: null,
  });
});

test("refuses option-shaped or malformed authority identities before invoking git", async () => {
  for (const [repository, commit] of [
    ["--upload-pack=touch", "a".repeat(40)],
    ["https://github.com/libre-ai/schemas-and-contracts", "--all"],
    ["ssh://example.invalid/repo", "a".repeat(40)],
    ["https://github.com/libre-ai/schemas-and-contracts", "A".repeat(40)],
  ] as const)
    expect(await readAuthorityWithGit(repository, commit, paths)).toEqual({
      failure: "authority.identity",
    });
});

test("unmerged pins, missing files and changed bytes each fail the authority gate", async () => {
  const files = new Map<string, Uint8Array | null>();
  for (const path of paths) files.set(path, await readFile(new URL(path, vendor)));
  const [first = "", second = ""] = paths;
  files.set(first, null);
  files.set(second, new TextEncoder().encode("changed"));
  const reader: AuthorityReader = async () => ({
    servedBranch: "main",
    pinOnServedLine: false,
    files,
  });
  expect(await authorityDriftFailures(reader)).toEqual({
    failures: ["authority.unmerged", `authority.missing:${first}`, `authority.drift:${second}`],
    verified: paths.length - 2,
    servedBranch: "main",
  });
});
