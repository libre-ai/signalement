import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inspectReachableHistory, renderPublicHistoryManifest } from "./public-history";

const temporaryDirectories: string[] = [];

async function run(command: readonly string[], cwd: string): Promise<void> {
  const process = Bun.spawn([...command], { cwd, stdout: "pipe", stderr: "pipe" });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`command failed with exit code ${exitCode}`);
  }
}

async function createRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "signalement-history-test-"));
  temporaryDirectories.push(root);
  await run(["git", "init", "--quiet", "--initial-branch=main"], root);
  await run(["git", "config", "user.name", "Signalement Test"], root);
  await run(["git", "config", "user.email", "tester@signalement.test"], root);
  return root;
}

async function commitFile(root: string, path: string, content: string): Promise<void> {
  await writeFile(join(root, path), content);
  await run(["git", "add", path], root);
  await run(["git", "commit", "--quiet", "-m", `test: add ${path}`], root);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("inspectReachableHistory", () => {
  test("renders the object manifest with RFC 8785 lexical key order and no whitespace", () => {
    expect(
      renderPublicHistoryManifest({
        schemaVersion: "libre-ai.git-object-manifest.v1",
        refs: [{ name: "refs/heads/main", objectId: "a".repeat(40) }],
        objects: [{ objectId: "b".repeat(40), type: "blob", size: 4 }],
      }),
    ).toBe(
      `{"objects":[{"objectId":"${"b".repeat(40)}","size":4,"type":"blob"}],"refs":[{"name":"refs/heads/main","objectId":"${"a".repeat(40)}"}],"schemaVersion":"libre-ai.git-object-manifest.v1"}`,
    );
  });

  test("finds a sensitive blob deleted from the current tree", async () => {
    const root = await createRepository();
    await commitFile(root, "safe.txt", "safe");
    const capturedHeader = ["Author", "ization: ", "Bear", "er signalement_test_old"].join("");
    await commitFile(root, "leak.txt", capturedHeader);
    await unlink(join(root, "leak.txt"));
    await run(["git", "add", "--all"], root);
    await run(["git", "commit", "--quiet", "-m", "test: delete leak"], root);

    const result = await inspectReachableHistory(root);

    expect(result.findings).toContainEqual({ path: "leak.txt", code: "captured-credential" });
    expect(JSON.stringify(result.findings)).not.toContain("signalement_test_old");
  });

  test("does not exclude evidence and review paths", async () => {
    const root = await createRepository();
    await run(["mkdir", "-p", "docs/evidence", "docs/reviews"], root);
    const credentialUrl = [
      "https://operator:",
      "signalement_test_password",
      "@tracker.invalid",
    ].join("");
    await commitFile(root, "docs/evidence/audit.txt", credentialUrl);
    await commitFile(root, "docs/reviews/review.txt", ["reporter", "@customer.company"].join(""));

    const result = await inspectReachableHistory(root);

    expect(result.findings).toContainEqual({
      path: "docs/evidence/audit.txt",
      code: "credential-url",
    });
    expect(result.findings).toContainEqual({
      path: "docs/reviews/review.txt",
      code: "personal-email",
    });
  });

  test("accepts a clean reachable history and reports its coverage", async () => {
    const root = await createRepository();
    await commitFile(root, "safe.txt", "safe synthetic fixture");

    const result = await inspectReachableHistory(root);

    expect(result.findings).toEqual([]);
    expect(result.commitCount).toBe(1);
    expect(result.blobCount).toBe(1);
    expect(result.objectCount).toBeGreaterThanOrEqual(3);
    expect(result.objectManifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.refs).toEqual([
      { name: "refs/heads/main", objectId: expect.stringMatching(/^[0-9a-f]{40,64}$/) },
    ]);
    expect(result.manifest.schemaVersion).toBe("libre-ai.git-object-manifest.v1");
    expect(result.manifest.refs).toEqual(result.refs);
    expect(result.manifest.objects).toHaveLength(result.objectCount);
    expect(result.manifest.objects).toEqual(
      [...result.manifest.objects].sort((left, right) =>
        left.objectId.localeCompare(right.objectId),
      ),
    );
  });

  test("rejects a secret embedded only in a commit message", async () => {
    const root = await createRepository();
    await commitFile(root, "safe.txt", "safe");
    const capturedHeader = ["Author", "ization: ", "Bear", "er history_only_secret"].join("");
    await run(["git", "commit", "--allow-empty", "--quiet", "-m", capturedHeader], root);

    const result = await inspectReachableHistory(root);

    expect(result.findings).toContainEqual({
      path: expect.stringMatching(/^metadata\/commits\/[0-9a-f]+\.txt$/),
      code: "captured-credential",
    });
    expect(JSON.stringify(result.findings)).not.toContain("history_only_secret");
  });

  test("rejects a personal author identity even with a public committer", async () => {
    const root = await createRepository();
    await writeFile(join(root, "safe.txt"), "safe");
    await run(["git", "add", "safe.txt"], root);
    const author = ["Private Reporter <reporter", "@customer.company>"].join("");
    await run(["git", "commit", "--quiet", "--author", author, "-m", "test: private author"], root);

    const result = await inspectReachableHistory(root);

    expect(result.findings).toContainEqual({
      path: expect.stringMatching(/^metadata\/commits\/[0-9a-f]+\.txt$/),
      code: "personal-email",
    });
  });

  test("rejects a personal committer identity even with a synthetic author", async () => {
    const root = await createRepository();
    await run(["git", "config", "user.email", ["committer", "@customer.company"].join("")], root);
    await writeFile(join(root, "safe.txt"), "safe");
    await run(["git", "add", "safe.txt"], root);
    await run(
      [
        "git",
        "commit",
        "--quiet",
        "--author",
        "Synthetic Author <author@signalement.test>",
        "-m",
        "test: private committer",
      ],
      root,
    );

    const result = await inspectReachableHistory(root);

    expect(result.findings).toContainEqual({
      path: expect.stringMatching(/^metadata\/commits\/[0-9a-f]+\.txt$/),
      code: "personal-email",
    });
  });

  test("allows an explicitly public GitHub noreply commit identity", async () => {
    const root = await createRepository();
    const allowed = ["12345+signalement-test", "@users.noreply.github.com"].join("");
    await run(["git", "config", "user.email", allowed], root);
    await commitFile(root, "safe.txt", "safe");

    const result = await inspectReachableHistory(root, { allowedEmails: [allowed] });

    expect(result.findings).toEqual([]);
  });

  test("scans annotated tag metadata when the tag ref is explicitly authorized", async () => {
    const root = await createRepository();
    await commitFile(root, "safe.txt", "safe");
    const tagMessage = ["Author", "ization: ", "Bear", "er tag_only_secret"].join("");
    await run(["git", "tag", "-a", "v1", "-m", tagMessage], root);

    const result = await inspectReachableHistory(root, {
      authorizedRefs: ["refs/heads/main", "refs/tags/v1"],
    });

    expect(result.findings).toContainEqual({
      path: expect.stringMatching(/^metadata\/tags\/[0-9a-f]+\.txt$/),
      code: "captured-credential",
    });
    expect(JSON.stringify(result.findings)).not.toContain("tag_only_secret");
  });

  test("rejects a personal annotated-tag tagger identity", async () => {
    const root = await createRepository();
    await commitFile(root, "safe.txt", "safe");
    await run(["git", "config", "user.email", ["tagger", "@customer.company"].join("")], root);
    await run(["git", "tag", "-a", "v1", "-m", "test: private tagger"], root);

    const result = await inspectReachableHistory(root, {
      authorizedRefs: ["refs/heads/main", "refs/tags/v1"],
    });

    expect(result.findings).toContainEqual({
      path: expect.stringMatching(/^metadata\/tags\/[0-9a-f]+\.txt$/),
      code: "personal-email",
    });
  });

  test("rejects every local branch or tag outside the authorized ref set", async () => {
    const root = await createRepository();
    await commitFile(root, "safe.txt", "safe");
    await run(["git", "branch", "unreviewed"], root);
    await run(["git", "tag", "unreviewed-tag"], root);

    const result = await inspectReachableHistory(root);

    expect(result.findings.filter(({ code }) => code === "unexpected-ref")).toHaveLength(2);
    expect(JSON.stringify(result.findings)).not.toContain("unreviewed");
  });

  test("rejects a non-branch and non-tag ref outside the exact allowlist", async () => {
    const root = await createRepository();
    await commitFile(root, "safe.txt", "safe");
    await run(["git", "update-ref", "refs/notes/review", "HEAD"], root);

    const result = await inspectReachableHistory(root);

    expect(result.findings).toContainEqual({
      path: expect.stringMatching(/^metadata\/refs\/unexpected-[0-9]+\.txt$/),
      code: "unexpected-ref",
    });
  });

  test("scans authorized ref names and historical tree paths without echoing them", async () => {
    const root = await createRepository();
    const sensitive = ["reporter", "@customer.company"].join("");
    await commitFile(root, `${sensitive}.txt`, "safe");
    await run(["git", "branch", sensitive], root);

    const result = await inspectReachableHistory(root, {
      authorizedRefs: ["refs/heads/main", `refs/heads/${sensitive}`],
    });

    expect(result.findings.some(({ code }) => code === "personal-email")).toBe(true);
    expect(JSON.stringify(result.findings)).not.toContain("reporter");
  });

  test("returns stable exact ref tips and a digest of every reachable object", async () => {
    const root = await createRepository();
    await commitFile(root, "safe.txt", "safe");

    const first = await inspectReachableHistory(root);
    const repeated = await inspectReachableHistory(root);
    await commitFile(root, "next.txt", "next");
    const changed = await inspectReachableHistory(root);

    expect(repeated.refs).toEqual(first.refs);
    expect(repeated.objectManifestSha256).toBe(first.objectManifestSha256);
    expect(changed.refs).not.toEqual(first.refs);
    expect(changed.objectManifestSha256).not.toBe(first.objectManifestSha256);
    expect(changed.objectCount).toBeGreaterThan(first.objectCount);
  });

  test("fails closed on oversized historical blobs", async () => {
    const root = await createRepository();
    await commitFile(root, "large.txt", "x".repeat(65));

    const result = await inspectReachableHistory(root, { maxFileBytes: 64 });

    expect(result.findings).toContainEqual({ path: "large.txt", code: "oversized-file" });
  });

  test("rejects a symlink in reachable history without following it", async () => {
    const root = await createRepository();
    await writeFile(join(root, "target.txt"), "safe");
    await symlink("target.txt", join(root, "link.txt"));
    await run(["git", "add", "target.txt", "link.txt"], root);
    await run(["git", "commit", "--quiet", "-m", "test: add symlink"], root);

    const result = await inspectReachableHistory(root);

    expect(result.findings).toContainEqual({
      path: expect.stringMatching(/^metadata\/paths\/unsafe-[0-9]+\.txt$/),
      code: "unsafe-history-mode",
    });
  });

  test("refuses a repository without reachable commits", async () => {
    const root = await createRepository();

    await expect(inspectReachableHistory(root)).rejects.toThrow("no reachable commit");
  });
});
