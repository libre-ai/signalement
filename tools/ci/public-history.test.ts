import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  inspectGitMetadata,
  inspectReachableHistory,
  type PublicHistoryResult,
  renderPublicHistoryManifest,
} from "./public-history";

const temporaryDirectories: string[] = [];
const TEST_IDENTITIES = [{ name: "Signalement Test", email: "tester@signalement.test" }] as const;
const TEST_GITHUB_IDENTITY = {
  name: "Signalement Test",
  email: ["12345+signalement-test", "@users.noreply.github.com"].join(""),
} as const;

function dco(
  identity: { readonly name: string; readonly email: string } = TEST_IDENTITIES[0],
): string {
  return `Signed-off-by: ${identity.name} <${identity.email}>`;
}

async function run(command: readonly string[], cwd: string): Promise<void> {
  const process = Bun.spawn([...command], { cwd, stdout: "pipe", stderr: "pipe" });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`command failed with exit code ${exitCode}`);
  }
}

async function runWithInput(
  command: readonly string[],
  cwd: string,
  input?: string,
): Promise<string> {
  const process = Bun.spawn([...command], {
    cwd,
    stdin: input === undefined ? undefined : new Blob([input]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
  ]);
  await new Response(process.stderr).bytes();
  if (exitCode !== 0) {
    throw new Error(`command failed with exit code ${exitCode}`);
  }
  return stdout.trim();
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
  await run(["git", "commit", "--quiet", "--signoff", "-m", `test: add ${path}`], root);
}

async function replaceMainWithRawCommit(root: string, rawCommit: string): Promise<void> {
  const objectId = await runWithInput(
    ["git", "hash-object", "--literally", "-t", "commit", "-w", "--stdin"],
    root,
    rawCommit,
  );
  await run(["git", "update-ref", "refs/heads/main", objectId], root);
}

async function currentTree(root: string): Promise<string> {
  return runWithInput(["git", "rev-parse", "HEAD^{tree}"], root);
}

function rawCommit(
  tree: string,
  options: {
    readonly headers?: readonly string[];
    readonly message?: string;
  } = {},
): string {
  const identity = "Signalement Test <tester@signalement.test> 1770000000 +0000";
  const headers = options.headers ?? [`author ${identity}`, `committer ${identity}`];
  const message = options.message ?? `test: raw commit\n\n${dco()}`;
  return [`tree ${tree}`, ...headers, "", message, ""].join("\n");
}

interface RawCommitContext {
  readonly parent: string;
  readonly tree: string;
}

type RawCommitOptions = Parameters<typeof rawCommit>[1];

async function inspectRawCommit(
  rawOptions: RawCommitOptions | ((context: RawCommitContext) => RawCommitOptions),
  allowedIdentities: readonly { readonly name: string; readonly email: string }[] = TEST_IDENTITIES,
): Promise<PublicHistoryResult> {
  const root = await createRepository();
  await commitFile(root, "safe.txt", "safe");
  const context = {
    parent: await runWithInput(["git", "rev-parse", "HEAD"], root),
    tree: await currentTree(root),
  };
  const resolvedOptions = typeof rawOptions === "function" ? rawOptions(context) : rawOptions;
  await replaceMainWithRawCommit(root, rawCommit(context.tree, resolvedOptions));
  return inspectReachableHistory(root, { allowedIdentities });
}

function rawTag(objectId: string, message: string): string {
  const identity = "Signalement Test <tester@signalement.test> 1770000000 +0000";
  return [
    `object ${objectId}`,
    "type commit",
    "tag v1",
    `tagger ${identity}`,
    "",
    message,
    "",
  ].join("\n");
}

async function writeRawTag(root: string, rawTag: string, ref = "refs/tags/v1"): Promise<void> {
  const objectId = await runWithInput(
    ["git", "hash-object", "--literally", "-t", "tag", "-w", "--stdin"],
    root,
    rawTag,
  );
  await run(["git", "update-ref", ref, objectId], root);
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

  test("sorts ref names by UTF-8 bytes rather than host locale", () => {
    const rendered = renderPublicHistoryManifest({
      schemaVersion: "libre-ai.git-object-manifest.v1",
      refs: [
        { name: "refs/heads/ä", objectId: "a".repeat(40) },
        { name: "refs/heads/z", objectId: "b".repeat(40) },
      ],
      objects: [],
    });

    expect(rendered.indexOf("refs/heads/z")).toBeLessThan(rendered.indexOf("refs/heads/ä"));
  });

  test("finds a sensitive blob deleted from the current tree", async () => {
    const root = await createRepository();
    await commitFile(root, "safe.txt", "safe");
    const capturedHeader = ["Author", "ization: ", "Bear", "er signalement_test_old"].join("");
    await commitFile(root, "leak.txt", capturedHeader);
    await unlink(join(root, "leak.txt"));
    await run(["git", "add", "--all"], root);
    await run(["git", "commit", "--quiet", "--signoff", "-m", "test: delete leak"], root);

    const result = await inspectReachableHistory(root, { allowedIdentities: TEST_IDENTITIES });

    expect(result.findings).toContainEqual({ path: "leak.txt", code: "captured-credential" });
    expect(JSON.stringify(result.findings)).not.toContain("signalement_test_old");
  });

  test("finds a provider token deleted from the current tree", async () => {
    const root = await createRepository();
    await commitFile(root, "safe.txt", "safe");
    const providerToken = ["gh", "p_", "A".repeat(24)].join("");
    await commitFile(root, "provider-token.txt", providerToken);
    await unlink(join(root, "provider-token.txt"));
    await run(["git", "add", "--all"], root);
    await run(["git", "commit", "--quiet", "-m", "test: delete provider token"], root);

    const result = await inspectReachableHistory(root, { allowedIdentities: TEST_IDENTITIES });

    expect(result.findings).toContainEqual({
      path: "provider-token.txt",
      code: "captured-credential",
    });
    expect(JSON.stringify(result.findings)).not.toContain(providerToken);
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

    const result = await inspectReachableHistory(root, { allowedIdentities: TEST_IDENTITIES });

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
    await run(
      ["git", "commit", "--allow-empty", "--quiet", "--signoff", "-m", capturedHeader],
      root,
    );

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
    await run(
      ["git", "commit", "--quiet", "--signoff", "--author", author, "-m", "test: private author"],
      root,
    );

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
        "--signoff",
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

    const result = await inspectReachableHistory(root, {
      allowedIdentities: [{ name: "Signalement Test", email: allowed }],
    });

    expect(result.findings).toEqual([]);
  });

  test("scans an approved commit address when it is copied into prose", async () => {
    const root = await createRepository();
    await run(["git", "config", "user.email", TEST_GITHUB_IDENTITY.email], root);
    await commitFile(root, "safe.txt", "safe");
    await run(
      [
        "git",
        "commit",
        "--allow-empty",
        "--quiet",
        "--signoff",
        "-m",
        `Contact ${TEST_GITHUB_IDENTITY.email} outside the identity metadata`,
      ],
      root,
    );

    const result = await inspectReachableHistory(root, {
      allowedIdentities: [TEST_GITHUB_IDENTITY],
    });

    expect(result.findings).toContainEqual({
      path: expect.stringMatching(/^metadata\/commits\/[0-9a-f]+\.txt$/),
      code: "personal-email",
    });
  });

  const otherIdentity = {
    name: "Other Approved",
    email: ["67890+other-approved", "@users.noreply.github.com"].join(""),
  };
  for (const testCase of [
    { name: "a canonical DCO followed by content", message: `${dco()}\nnot terminal` },
    { name: "a commit without a DCO", message: "test: missing DCO" },
    {
      name: "a DCO tuple absent from object identities",
      message: `test: mismatch\n\n${dco(otherIdentity)}`,
      identities: [...TEST_IDENTITIES, otherIdentity],
    },
  ] as const) {
    test(`rejects ${testCase.name}`, async () => {
      const result = await inspectRawCommit(
        { message: testCase.message },
        "identities" in testCase ? testCase.identities : TEST_IDENTITIES,
      );

      expect(result.findings).toContainEqual({
        path: expect.stringMatching(/^metadata\/commits\/[0-9a-f]+\.txt$/),
        code: "unapproved-identity",
      });
    });
  }

  const githubIdentity = `Signalement Test <${TEST_GITHUB_IDENTITY.email}> 1770000000 +0000`;
  for (const testCase of [
    {
      name: "duplicate identity headers",
      headers: [
        `author ${githubIdentity}`,
        `author ${githubIdentity}`,
        `committer ${githubIdentity}`,
      ],
      expectedCodes: ["unapproved-identity", "personal-email"],
    },
    {
      name: "a malformed identity timestamp and timezone",
      headers: [
        `author Signalement Test <${TEST_GITHUB_IDENTITY.email}> 01770000000 +1460`,
        `committer ${githubIdentity}`,
      ],
      expectedCodes: ["unapproved-identity", "personal-email"],
    },
    {
      name: "committer before author",
      headers: [`committer ${githubIdentity}`, `author ${githubIdentity}`],
      expectedCodes: ["unapproved-identity", "personal-email"],
    },
    {
      name: "a negative timestamp",
      headers: [
        `author Signalement Test <${TEST_GITHUB_IDENTITY.email}> -1 +0000`,
        `committer ${githubIdentity}`,
      ],
      expectedCodes: ["unapproved-identity", "personal-email"],
    },
    {
      name: "a timestamp above Git's signed 64-bit time_t bound",
      headers: [
        `author Signalement Test <${TEST_GITHUB_IDENTITY.email}> 9223372036854775808 +0000`,
        `committer ${githubIdentity}`,
      ],
      expectedCodes: ["unapproved-identity", "personal-email"],
    },
    {
      name: "identity text in a continuation line",
      headers: [
        `author ${githubIdentity}`,
        `committer ${githubIdentity}`,
        "gpgsig synthetic-signature",
        ` author ${githubIdentity}`,
      ],
      expectedCodes: ["personal-email"],
    },
    {
      name: "an identity manufactured by a continuation line",
      headers: [
        "gpgsig synthetic-signature",
        ` author ${githubIdentity}`,
        `committer ${githubIdentity}`,
      ],
      expectedCodes: ["unapproved-identity", "personal-email"],
    },
  ] as const) {
    test(`rejects ${testCase.name}`, async () => {
      const result = await inspectRawCommit(
        {
          headers: testCase.headers,
          message: `test: header attack\n\n${dco(TEST_GITHUB_IDENTITY)}`,
        },
        [TEST_GITHUB_IDENTITY],
      );

      for (const code of testCase.expectedCodes) {
        expect(result.findings).toContainEqual({
          path: expect.stringMatching(/^metadata\/commits\/[0-9a-f]+\.txt$/),
          code,
        });
      }
    });
  }

  test("rejects a parent header after author", async () => {
    const result = await inspectRawCommit(
      ({ parent }) => ({
        headers: [`author ${githubIdentity}`, `parent ${parent}`, `committer ${githubIdentity}`],
        message: `test: late parent\n\n${dco(TEST_GITHUB_IDENTITY)}`,
      }),
      [TEST_GITHUB_IDENTITY],
    );

    expect(result.findings).toContainEqual({
      path: expect.stringMatching(/^metadata\/commits\/[0-9a-f]+\.txt$/),
      code: "unapproved-identity",
    });
  });

  test("rejects a synthetic-domain identity in real history", async () => {
    const root = await createRepository();
    await commitFile(root, "safe.txt", "safe");

    const result = await inspectReachableHistory(root, {
      allowedIdentities: [
        {
          name: "Approved Contributor",
          email: ["approved", "@users.noreply.github.com"].join(""),
        },
      ],
    });

    expect(result.findings).toContainEqual({
      path: expect.stringMatching(/^metadata\/commits\/[0-9a-f]+\.txt$/),
      code: "unapproved-identity",
    });
  });

  test("rejects an unapproved name paired with an approved email", async () => {
    const root = await createRepository();
    const email = ["12345+signalement-test", "@users.noreply.github.com"].join("");
    await run(["git", "config", "user.name", "Unapproved Name"], root);
    await run(["git", "config", "user.email", email], root);
    await commitFile(root, "safe.txt", "safe");

    const result = await inspectReachableHistory(root, {
      allowedIdentities: [{ name: "Approved Name", email }],
    });

    expect(result.findings).toContainEqual({
      path: expect.stringMatching(/^metadata\/commits\/[0-9a-f]+\.txt$/),
      code: "unapproved-identity",
    });
  });

  test("does not grant an approved commit email a blanket blob exemption", async () => {
    const root = await createRepository();
    const email = ["12345+signalement-test", "@users.noreply.github.com"].join("");
    await run(["git", "config", "user.email", email], root);
    await commitFile(root, "copied-identity.txt", email);

    const result = await inspectReachableHistory(root, {
      allowedIdentities: [{ name: "Signalement Test", email }],
    });

    expect(result.findings).toContainEqual({
      path: "copied-identity.txt",
      code: "personal-email",
    });
  });

  test("does not grant future policy blobs the root policy identity exception", async () => {
    const root = await createRepository();
    const email = ["12345+signalement-test", "@users.noreply.github.com"].join("");
    await run(["git", "config", "user.email", email], root);
    await mkdir(join(root, "tools/ci"), { recursive: true });
    await commitFile(root, "tools/ci/public-policy.ts", `export const identity = "${email}";`);

    const result = await inspectReachableHistory(root, {
      allowedIdentities: [{ name: "Signalement Test", email }],
    });

    expect(result.findings).toContainEqual({
      path: "tools/ci/public-policy.ts",
      code: "personal-email",
    });
  });

  test("scans annotated tag metadata when the tag ref is explicitly authorized", async () => {
    const root = await createRepository();
    await commitFile(root, "safe.txt", "safe");
    const tagMessage = ["Author", "ization: ", "Bear", "er tag_only_secret"].join("");
    await run(["git", "tag", "-a", "v1", "-m", `${tagMessage}\n\n${dco()}`], root);

    const result = await inspectReachableHistory(root, {
      allowedIdentities: TEST_IDENTITIES,
      authorizedRefs: ["refs/heads/main", "refs/tags/v1"],
    });

    expect(result.findings).toContainEqual({
      path: expect.stringMatching(/^metadata\/tags\/[0-9a-f]+\.txt$/),
      code: "captured-credential",
    });
    expect(JSON.stringify(result.findings)).not.toContain("tag_only_secret");
    expect(result.findings.some(({ code }) => code === "unapproved-identity")).toBe(false);
  });

  test("rejects a personal annotated-tag tagger identity", async () => {
    const root = await createRepository();
    await commitFile(root, "safe.txt", "safe");
    await run(["git", "config", "user.email", ["tagger", "@customer.company"].join("")], root);
    const privateDco = ["Signed-off-by: Signalement Test <tagger", "@customer.company>"].join("");
    await run(["git", "tag", "-a", "v1", "-m", `test: private tagger\n\n${privateDco}`], root);

    const result = await inspectReachableHistory(root, {
      authorizedRefs: ["refs/heads/main", "refs/tags/v1"],
    });

    expect(result.findings).toContainEqual({
      path: expect.stringMatching(/^metadata\/tags\/[0-9a-f]+\.txt$/),
      code: "personal-email",
    });
  });

  test("rejects an annotated tag without a terminal DCO", async () => {
    const root = await createRepository();
    await commitFile(root, "safe.txt", "safe");
    const head = await runWithInput(["git", "rev-parse", "HEAD"], root);
    await writeRawTag(root, rawTag(head, "test: missing tag DCO"));

    const result = await inspectReachableHistory(root, {
      allowedIdentities: TEST_IDENTITIES,
      authorizedRefs: ["refs/heads/main", "refs/tags/v1"],
    });

    expect(result.findings).toContainEqual({
      path: expect.stringMatching(/^metadata\/tags\/[0-9a-f]+\.txt$/),
      code: "unapproved-identity",
    });
  });

  test("rejects reordered required annotated-tag headers", async () => {
    const head = "a".repeat(40);
    const identity = "Signalement Test <tester@signalement.test> 1770000000 +0000";
    const inspection = inspectGitMetadata(
      new TextEncoder().encode(
        [
          "type commit",
          `object ${head}`,
          "tag v1",
          `tagger ${identity}`,
          "",
          `test: reordered tag\n\n${dco()}`,
          "",
        ].join("\n"),
      ),
      "tag",
      TEST_IDENTITIES,
    );

    expect(inspection.approved).toBe(false);
  });

  test("rejects an arbitrary annotated-tag extension header", () => {
    const identity = "Signalement Test <tester@signalement.test> 1770000000 +0000";
    const inspection = inspectGitMetadata(
      new TextEncoder().encode(
        [
          `object ${"a".repeat(40)}`,
          "type commit",
          "tag v1",
          `tagger ${identity}`,
          "custom unsupported",
          "",
          `test: tag extension\n\n${dco()}`,
          "",
        ].join("\n"),
      ),
      "tag",
      TEST_IDENTITIES,
    );

    expect(inspection.approved).toBe(false);
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
    await run(["git", "commit", "--quiet", "--signoff", "-m", "test: add symlink"], root);

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
