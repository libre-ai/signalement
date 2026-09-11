import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  inspectGitMetadata,
  inspectReachableHistory,
  type PublicHistoryManifest,
  type PublicHistoryResult,
  parseRawGitTree,
  renderPublicHistoryManifest,
} from "./public-history";

const temporaryDirectories: string[] = [];
const TEST_IDENTITIES = [{ name: "Signalement Test", email: "tester@signalement.test" }] as const;
const TEST_GITHUB_IDENTITY = {
  name: "Signalement Test",
  email: ["12345+signalement-test", "@users.noreply.github.com"].join(""),
} as const;
const OBJECT_A = "a".repeat(40);
const OBJECT_B = "b".repeat(40);

function manifestFixture(treeEntries: PublicHistoryManifest["treeEntries"]): PublicHistoryManifest {
  return {
    gitObjectFormat: "sha1",
    objects: [{ objectId: OBJECT_B, size: 4, type: "blob" }],
    repository: "libre-ai/signalement",
    refs: [{ name: "refs/heads/main", objectId: OBJECT_A }],
    schemaVersion: "libre-ai.git-object-manifest.v2",
    treeEntries,
  };
}

async function sha256(source: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return Buffer.from(digest).toString("hex");
}

function bytesFromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}

function concatenate(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function rawTreeEntry(mode: string, name: string, objectId = OBJECT_B): Uint8Array {
  return concatenate(new TextEncoder().encode(`${mode} ${name}\0`), bytesFromHex(objectId));
}

const TEST_TREE_OBJECT_ID = "c".repeat(40);
const TEST_OBJECT_TYPES = new Map([
  [OBJECT_A, "tree"],
  [OBJECT_B, "blob"],
] as const);

interface SchemaObjectShape {
  readonly additionalProperties: boolean;
  readonly properties: Readonly<
    Record<string, { readonly minimum?: number; readonly pattern?: string }>
  >;
  readonly required: readonly string[];
  readonly type: string;
}

interface TreeEntrySchemaAlternative {
  readonly additionalProperties: boolean;
  readonly properties: {
    readonly mode: { readonly const?: string; readonly enum?: readonly string[] };
    readonly type: { readonly const: string };
  };
}

interface ManifestSchema {
  readonly $id: string;
  readonly $schema: string;
  readonly type: string;
  readonly additionalProperties: boolean;
  readonly required: readonly string[];
  readonly properties: {
    readonly gitObjectFormat: { readonly const: string };
    readonly objects: { readonly maxItems: number };
    readonly repository: { readonly const: string };
    readonly refs: { readonly maxItems: number };
    readonly schemaVersion: { readonly const: string };
    readonly treeEntries: { readonly maxItems: number };
  };
  readonly $defs: {
    readonly gitObject: SchemaObjectShape;
    readonly gitRef: SchemaObjectShape;
    readonly sha1: { readonly pattern: string };
    readonly treeEntry: { readonly oneOf: readonly TreeEntrySchemaAlternative[] };
    readonly treeEntryName: {
      readonly maxLength: number;
      readonly minLength: number;
      readonly type: string;
    };
  };
}

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
  test("renders the v2 manifest with lexical key order and no whitespace", () => {
    expect(
      renderPublicHistoryManifest(
        manifestFixture([
          {
            mode: "100644",
            name: "safe.txt",
            objectId: OBJECT_B,
            treeObjectId: OBJECT_A,
            type: "blob",
          },
        ]),
      ),
    ).toBe(
      `{"gitObjectFormat":"sha1","objects":[{"objectId":"${OBJECT_B}","size":4,"type":"blob"}],"repository":"libre-ai/signalement","refs":[{"name":"refs/heads/main","objectId":"${OBJECT_A}"}],"schemaVersion":"libre-ai.git-object-manifest.v2","treeEntries":[{"mode":"100644","name":"safe.txt","objectId":"${OBJECT_B}","treeObjectId":"${OBJECT_A}","type":"blob"}]}`,
    );
  });

  test("sorts ref names by UTF-8 bytes rather than host locale", () => {
    const rendered = renderPublicHistoryManifest({
      gitObjectFormat: "sha1",
      repository: "libre-ai/signalement",
      schemaVersion: "libre-ai.git-object-manifest.v2",
      refs: [
        { name: "refs/heads/ä", objectId: "a".repeat(40) },
        { name: "refs/heads/z", objectId: "b".repeat(40) },
      ],
      objects: [],
      treeEntries: [],
    });

    expect(rendered.indexOf("refs/heads/z")).toBeLessThan(rendered.indexOf("refs/heads/ä"));
  });

  test("sorts tree entries by tree ID and direct UTF-8 name bytes", () => {
    const rendered = JSON.parse(
      renderPublicHistoryManifest(
        manifestFixture([
          {
            mode: "100644",
            name: "ä.txt",
            objectId: OBJECT_B,
            treeObjectId: OBJECT_B,
            type: "blob",
          },
          {
            mode: "100644",
            name: "z.txt",
            objectId: OBJECT_B,
            treeObjectId: OBJECT_B,
            type: "blob",
          },
          {
            mode: "100644",
            name: "last-by-name.txt",
            objectId: OBJECT_B,
            treeObjectId: OBJECT_A,
            type: "blob",
          },
        ]),
      ),
    ) as PublicHistoryManifest;

    expect(rendered.treeEntries.map(({ treeObjectId, name }) => [treeObjectId, name])).toEqual([
      [OBJECT_A, "last-by-name.txt"],
      [OBJECT_B, "z.txt"],
      [OBJECT_B, "ä.txt"],
    ]);
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
      { name: "refs/heads/main", objectId: expect.stringMatching(/^[0-9a-f]{40}$/) },
    ]);
    expect(result.manifest.schemaVersion).toBe("libre-ai.git-object-manifest.v2");
    expect(result.manifest.repository).toBe("libre-ai/signalement");
    expect(result.manifest.gitObjectFormat).toBe("sha1");
    expect(result.manifest.refs).toEqual(result.refs);
    expect(result.manifest.objects).toHaveLength(result.objectCount);
    expect(result.manifest.objects).toEqual(
      [...result.manifest.objects].sort((left, right) =>
        left.objectId.localeCompare(right.objectId),
      ),
    );
    expect(result.manifest.treeEntries.length).toBeGreaterThan(0);
  });

  test("inventories nested tree entries retained only in deleted history", async () => {
    const root = await createRepository();
    await mkdir(join(root, "nested"));
    await commitFile(root, "nested/old.txt", "historical");
    await unlink(join(root, "nested/old.txt"));
    await run(["git", "add", "--all"], root);
    await run(["git", "commit", "--quiet", "--signoff", "-m", "test: delete nested file"], root);

    const result = await inspectReachableHistory(root, { allowedIdentities: TEST_IDENTITIES });

    expect(result.manifest.treeEntries.some(({ name }) => name === "nested")).toBe(true);
    expect(result.manifest.treeEntries.some(({ name }) => name === "old.txt")).toBe(true);
  });

  test("changes the manifest digest when only a tree entry changes", async () => {
    const first = manifestFixture([
      {
        mode: "100644",
        name: "first.txt",
        objectId: OBJECT_B,
        treeObjectId: OBJECT_A,
        type: "blob",
      },
    ]);
    const second = manifestFixture([
      {
        mode: "100644",
        name: "second.txt",
        objectId: OBJECT_B,
        treeObjectId: OBJECT_A,
        type: "blob",
      },
    ]);

    expect(await sha256(renderPublicHistoryManifest(first))).not.toBe(
      await sha256(renderPublicHistoryManifest(second)),
    );
  });

  test.each([
    {
      name: "a truncated object ID",
      content: rawTreeEntry("100644", "safe.txt").subarray(0, -1),
    },
    {
      name: "an empty direct name",
      content: rawTreeEntry("100644", ""),
    },
    {
      name: "an invalid UTF-8 direct name",
      content: concatenate(
        new TextEncoder().encode("100644 "),
        new Uint8Array([0xff, 0]),
        bytesFromHex(OBJECT_B),
      ),
    },
    {
      name: "an invalid UTF-8 raw mode",
      content: concatenate(
        new Uint8Array([0xff, 32]),
        new TextEncoder().encode("safe.txt\0"),
        bytesFromHex(OBJECT_B),
      ),
    },
    {
      name: "a padded non-canonical tree mode",
      content: rawTreeEntry("040000", "nested", OBJECT_A),
    },
  ])("refuses $name with one generic parser error", ({ content }) => {
    expect(() => parseRawGitTree(content, TEST_TREE_OBJECT_ID, TEST_OBJECT_TYPES)).toThrow(
      "Git data is invalid",
    );
  });

  test("refuses duplicate direct names inside one tree", () => {
    const content = concatenate(
      rawTreeEntry("100644", "same.txt", OBJECT_A),
      rawTreeEntry("100644", "same.txt", OBJECT_B),
    );

    expect(() =>
      parseRawGitTree(
        content,
        TEST_TREE_OBJECT_ID,
        new Map([
          [OBJECT_A, "blob"],
          [OBJECT_B, "blob"],
        ]),
      ),
    ).toThrow("Git data is invalid");
  });

  test.each([
    {
      name: "mode and target type differ",
      content: rawTreeEntry("40000", "nested", OBJECT_B),
      objectTypes: TEST_OBJECT_TYPES,
    },
    {
      name: "the referenced target is absent",
      content: rawTreeEntry("100644", "missing.txt", "d".repeat(40)),
      objectTypes: TEST_OBJECT_TYPES,
    },
  ])("refuses when $name", ({ content, objectTypes }) => {
    expect(() => parseRawGitTree(content, TEST_TREE_OBJECT_ID, objectTypes)).toThrow(
      "Git data is invalid",
    );
  });

  test("refuses the direct-entry bound before collecting another entry", () => {
    const content = concatenate(
      rawTreeEntry("100644", "first.txt"),
      rawTreeEntry("100644", "second.txt"),
    );

    expect(() =>
      parseRawGitTree(content, TEST_TREE_OBJECT_ID, TEST_OBJECT_TYPES, { maxEntries: 1 }),
    ).toThrow("Git data is invalid");
  });

  test("accepts 4,096 UTF-8 bytes and refuses the next byte", () => {
    const boundedName = "a".repeat(4_096);
    expect(
      parseRawGitTree(
        rawTreeEntry("100644", boundedName),
        TEST_TREE_OBJECT_ID,
        TEST_OBJECT_TYPES,
      )[0]?.name,
    ).toBe(boundedName);
    expect(() =>
      parseRawGitTree(
        rawTreeEntry("100644", `${boundedName}a`),
        TEST_TREE_OBJECT_ID,
        TEST_OBJECT_TYPES,
      ),
    ).toThrow("Git data is invalid");
  });

  test.each([
    ".",
    "..",
    "nested/name",
    `hidden\u2060name`,
    "line\nbreak",
  ])("refuses the unsafe direct component %s", (name) => {
    expect(() =>
      parseRawGitTree(rawTreeEntry("100644", name), TEST_TREE_OBJECT_ID, TEST_OBJECT_TYPES),
    ).toThrow("Git data is invalid");
  });

  test.each([
    ".git",
    ".GIT",
    ".git.",
    ".git ",
    ".git~1",
    ".git::$INDEX_ALLOCATION",
  ])("refuses the strict-fsck dot-git alias %s", (name) => {
    expect(() =>
      parseRawGitTree(rawTreeEntry("100644", name), TEST_TREE_OBJECT_ID, TEST_OBJECT_TYPES),
    ).toThrow("Git data is invalid");
  });

  test.each([
    {
      name: "descending byte names",
      content: concatenate(rawTreeEntry("100644", "z.txt"), rawTreeEntry("100644", "a.txt")),
    },
    {
      name: "a directory before a file sharing its prefix",
      content: concatenate(
        rawTreeEntry("40000", "foo", OBJECT_A),
        rawTreeEntry("100644", "foo.bar", OBJECT_B),
      ),
    },
  ])("refuses non-canonical Git tree order: $name", ({ content }) => {
    expect(() => parseRawGitTree(content, TEST_TREE_OBJECT_ID, TEST_OBJECT_TYPES)).toThrow(
      "Git data is invalid",
    );
  });

  test("accepts Git's canonical file-before-directory prefix order", () => {
    const content = concatenate(
      rawTreeEntry("100644", "foo.bar", OBJECT_B),
      rawTreeEntry("40000", "foo", OBJECT_A),
    );

    expect(parseRawGitTree(content, TEST_TREE_OBJECT_ID, TEST_OBJECT_TYPES)).toHaveLength(2);
  });

  test("publishes a closed v2 schema with constants, maxima, and mode coherence", async () => {
    const schemaFile = Bun.file(
      join(import.meta.dir, "../../schemas/git-object-manifest.v2.schema.json"),
    );
    const exists = await schemaFile.exists();
    expect(exists).toBe(true);
    if (!exists) return;
    const schema = (await schemaFile.json()) as ManifestSchema;

    expect(schema).toMatchObject({
      $id: "https://raw.githubusercontent.com/libre-ai/signalement/main/schemas/git-object-manifest.v2.schema.json",
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      required: [
        "gitObjectFormat",
        "objects",
        "repository",
        "refs",
        "schemaVersion",
        "treeEntries",
      ],
    });
    expect(schema.properties.gitObjectFormat.const).toBe("sha1");
    expect(schema.properties.repository.const).toBe("libre-ai/signalement");
    expect(schema.properties.schemaVersion.const).toBe("libre-ai.git-object-manifest.v2");
    expect(schema.properties.objects.maxItems).toBe(100_000);
    expect(schema.properties.refs.maxItems).toBe(1_024);
    expect(schema.properties.treeEntries.maxItems).toBe(100_000);
    expect(schema.$defs.gitObject).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["objectId", "size", "type"],
    });
    expect(schema.$defs.gitObject.properties.size?.minimum).toBe(0);
    expect(schema.$defs.gitRef).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["name", "objectId"],
    });
    expect(schema.$defs.treeEntryName).toEqual({
      type: "string",
      minLength: 1,
      maxLength: 4_096,
    });
    expect(schema.$defs.sha1.pattern).toBe("^[0-9a-f]{40}$");
    const coherentPairs = schema.$defs.treeEntry.oneOf.map(
      (alternative: TreeEntrySchemaAlternative) => ({
        additionalProperties: alternative.additionalProperties,
        modes: alternative.properties.mode.enum ?? [alternative.properties.mode.const],
        type: alternative.properties.type.const,
      }),
    );
    expect(coherentPairs).toEqual([
      { additionalProperties: false, modes: ["040000"], type: "tree" },
      { additionalProperties: false, modes: ["100644", "100755", "120000"], type: "blob" },
      { additionalProperties: false, modes: ["160000"], type: "commit" },
    ]);
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

  for (const extensionHeader of [
    "custom unsupported",
    "gpgsig synthetic-signature",
    "gpgsig-sha256 synthetic-signature",
  ]) {
    test(`rejects annotated-tag extension header ${extensionHeader.split(" ")[0]}`, () => {
      const identity = "Signalement Test <tester@signalement.test> 1770000000 +0000";
      const inspection = inspectGitMetadata(
        new TextEncoder().encode(
          [
            `object ${"a".repeat(40)}`,
            "type commit",
            "tag v1",
            `tagger ${identity}`,
            extensionHeader,
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
  }

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

  test("refuses a non-SHA-1 Git object format", async () => {
    const root = await mkdtemp(join(tmpdir(), "signalement-history-sha256-"));
    temporaryDirectories.push(root);
    await run(["git", "init", "--quiet", "--initial-branch=main", "--object-format=sha256"], root);

    await expect(inspectReachableHistory(root)).rejects.toThrow("Unsupported Git object format");
  });

  test("refuses the local ref bound before dependent history reads", async () => {
    const root = await createRepository();
    await commitFile(root, "safe.txt", "safe");
    await run(["git", "branch", "second"], root);

    await expect(inspectReachableHistory(root, { maxRefs: 1 })).rejects.toThrow(
      "Git data is invalid",
    );
  });

  test("refuses the commit bound before raw history reads", async () => {
    const root = await createRepository();
    await commitFile(root, "first.txt", "first");
    await commitFile(root, "second.txt", "second");

    await expect(inspectReachableHistory(root, { maxCommits: 1 })).rejects.toThrow(
      "Git data is invalid",
    );
  });

  test("refuses the reachable-object bound before metadata and body reads", async () => {
    const root = await createRepository();
    await commitFile(root, "safe.txt", "safe");

    await expect(inspectReachableHistory(root, { maxObjects: 2 })).rejects.toThrow(
      "Git data is invalid",
    );
  });

  test("refuses an overlong UTF-8 historical path component", async () => {
    const root = await createRepository();
    await commitFile(root, "é.txt", "safe");

    await expect(inspectReachableHistory(root, { maxPathComponentBytes: 5 })).rejects.toThrow(
      "Git data is invalid",
    );
  });
});
