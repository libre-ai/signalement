import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inspectDevelopmentHistory } from "./development-history";
import { APPROVED_DEVELOPMENT_AUTHOR_ALIASES, APPROVED_PUBLIC_IDENTITIES } from "./public-policy";

const roots: string[] = [];
async function git(root: string, ...args: string[]): Promise<string> {
  const child = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const output = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) throw new Error("Fixture Git failed");
  return output.trim();
}
async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "development-history-test-"));
  roots.push(root);
  await git(root, "init", "--quiet", "--initial-branch=feature");
  await git(root, "config", "user.name", APPROVED_PUBLIC_IDENTITIES[0].name);
  await git(root, "config", "user.email", APPROVED_PUBLIC_IDENTITIES[0].email);
  await commit(root, "safe");
  return root;
}
async function commit(root: string, content: string): Promise<void> {
  await writeFile(join(root, "fixture.txt"), content);
  await git(root, "add", "fixture.txt");
  await git(
    root,
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "--signoff",
    "-m",
    "test: fixture",
  );
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => rm(root, { recursive: true, force: true })),
  );
});
for (const detached of [false, true]) {
  test(`audits actual HEAD with detached=${detached} without changing source state`, async () => {
    const root = await repository();
    await git(root, "branch", "unrelated");
    if (detached) await git(root, "checkout", "--quiet", "--detach");
    await writeFile(join(root, "fixture.txt"), "uncommitted");
    const before = await git(root, "show-ref");
    const head = await readFile(join(root, ".git/HEAD"), "utf8");
    const sha = await git(root, "rev-parse", "HEAD");
    const result = await inspectDevelopmentHistory(root, sha);
    expect(result.findings).toEqual([]);
    expect(result.refs).toEqual([{ name: "refs/heads/main", objectId: sha }]);
    expect(await git(root, "show-ref")).toBe(before);
    expect(await readFile(join(root, ".git/HEAD"), "utf8")).toBe(head);
    expect(await readFile(join(root, "fixture.txt"), "utf8")).toBe("uncommitted");
  });
}
test("detects a removed historical secret", async () => {
  const root = await repository();
  await commit(root, ["Author", "ization: Bear", "er historical_secret"].join(""));
  await commit(root, "safe");
  const result = await inspectDevelopmentHistory(root);
  expect(result.findings.some(({ code }) => code === "captured-credential")).toBe(true);
});
test("rejects a mismatched expected SHA", async () => {
  const root = await repository();
  await expect(inspectDevelopmentHistory(root, "a".repeat(40))).rejects.toThrow(
    "Development history rejected",
  );
});
for (const contamination of ["shallow", "grafts", "replace"]) {
  test(`rejects ${contamination} history`, async () => {
    const root = await repository();
    const sha = await git(root, "rev-parse", "HEAD");
    if (contamination === "replace") await git(root, "update-ref", `refs/replace/${sha}`, sha);
    else
      await writeFile(
        join(root, ".git", contamination === "grafts" ? "info/grafts" : "shallow"),
        `${sha}\n`,
      );
    await expect(inspectDevelopmentHistory(root)).rejects.toThrow("Development history rejected");
  });
}

test("ignores ambient Git environment and global configuration in the CLI", async () => {
  const root = await repository();
  const config = join(root, "host-config");
  await writeFile(
    config,
    "[core]\n repositoryFormatVersion = 99\n[init]\n templateDir = /missing/template\n",
  );
  const sha = await git(root, "rev-parse", "HEAD");
  const configBefore = await readFile(join(root, ".git/config"), "utf8");
  const child = Bun.spawn(
    [process.execPath, join(import.meta.dir, "check-development-history.ts")],
    {
      cwd: root,
      env: {
        ...process.env,
        CI: "true",
        EXPECTED_HEAD_SHA: sha,
        GIT_DIR: "/missing/repository",
        GIT_WORK_TREE: "/missing/worktree",
        GIT_OBJECT_DIRECTORY: "/missing/objects",
        GIT_CONFIG_GLOBAL: config,
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "core.repositoryFormatVersion",
        GIT_CONFIG_VALUE_0: "99",
        GIT_NAMESPACE: "concealed",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const output = await new Response(child.stdout).text();
  expect(await child.exited).toBe(0);
  expect(output).toContain("0 findings");
  expect(await readFile(join(root, ".git/config"), "utf8")).toBe(configBefore);
});

test("CLI rejects historical findings with generic diagnostics", async () => {
  const root = await repository();
  await commit(root, ["Author", "ization: Bear", "er historical_secret"].join(""));
  const child = Bun.spawn(
    [process.execPath, join(import.meta.dir, "check-development-history.ts")],
    {
      cwd: root,
      env: { ...process.env, EXPECTED_HEAD_SHA: await git(root, "rev-parse", "HEAD") },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const output = await new Response(child.stdout).text();
  const error = await new Response(child.stderr).text();
  expect(await child.exited).toBe(1);
  expect(output).toBe("");
  expect(error).toBe("Development history check failed\n");
});

test("CI validates the integration tree before auditing immutable contributor history", async () => {
  const workflow = await readFile(join(import.meta.dir, "../../.github/workflows/ci.yml"), "utf8");
  // Scope to the required job; the non-required native quota job checks out
  // only its receipt verifier and audits no history.
  const [, afterQuality = ""] = workflow.split("\n  bun-quality:\n");
  const [bunQuality = ""] = afterQuality.split(/(?<=\n) {2}native-quota:\n/);
  expect(bunQuality).toContain("    name: Bun quality\n");
  const checkouts = bunQuality.split("      - uses: actions/checkout@").slice(1);
  expect(checkouts).toHaveLength(2);
  const integration = checkouts[0] ?? "";
  const history = checkouts[1] ?? "";
  expect(integration.split("      - name:")[0]).not.toContain("          ref:");
  expect(integration).toContain("      - run: bun run check:tree\n");
  expect(history).toContain(
    `          ref: \${{ github.event.pull_request.head.sha || github.sha }}\n`,
  );
  expect(history).toContain("      - run: bun install --frozen-lockfile\n");
  expect(history).toContain("      - run: bun run check:development-history\n");
  expect(history).toContain(
    `          EXPECTED_HEAD_SHA: \${{ github.event.pull_request.head.sha || github.sha }}\n`,
  );
  for (const checkout of checkouts) {
    expect(checkout).toStartWith("3d3c42e5aac5ba805825da76410c181273ba90b1\n");
    expect(checkout).toContain("          fetch-depth: 0\n");
    expect(checkout).toContain("          persist-credentials: false\n");
  }
});

test("audits forge-rendered author names with the canonical DCO", async () => {
  const root = await repository();
  const { alias } = APPROVED_DEVELOPMENT_AUTHOR_ALIASES[0];
  await git(
    root,
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--allow-empty",
    "--signoff",
    `--author=${alias.name} <${alias.email}>`,
    "-m",
    "test: forge author rendering",
  );
  expect((await inspectDevelopmentHistory(root)).findings).toEqual([]);
});
