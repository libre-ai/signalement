import { lstat, mkdtemp, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { GIT_METADATA_STDOUT_LIMIT, runGitBounded } from "./git-process";
import { inspectReachableHistory, type PublicHistoryResult } from "./public-history";
import {
  APPROVED_DEVELOPMENT_AUTHOR_ALIASES,
  APPROVED_FORGE_COMMITTER_IDENTITIES,
  APPROVED_PUBLIC_IDENTITIES,
} from "./public-policy";

const OBJECT_ID = /^[0-9a-f]{40}$/;
const decoder = new TextDecoder("utf-8", { fatal: true });

function reject(): never {
  throw new Error("Development history rejected");
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    return reject();
  }
}

/** Audit the full ancestry of HEAD without rewriting source refs, index, or worktree. */
export async function inspectDevelopmentHistory(
  root: string,
  expectedSha?: string,
): Promise<PublicHistoryResult> {
  if (expectedSha !== undefined && !OBJECT_ID.test(expectedSha)) reject();
  const temporary = await mkdtemp(join(tmpdir(), "signalement-development-audit-"));
  // An allowlist excludes ambient Git directory, namespace, config, shallow and object overrides.
  const env: Readonly<Record<string, string>> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: temporary,
    XDG_CONFIG_HOME: temporary,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
  };
  async function git(
    cwd: string,
    args: readonly string[],
    input?: Uint8Array,
  ): Promise<Uint8Array> {
    const result = await runGitBounded(args, {
      cwd,
      env,
      maxStdoutBytes: GIT_METADATA_STDOUT_LIMIT,
      ...(input === undefined
        ? {}
        : { stdin: { data: input, maxBytes: GIT_METADATA_STDOUT_LIMIT } }),
    });
    if (result.exitCode !== 0) reject();
    return result.stdout;
  }
  async function text(cwd: string, args: readonly string[]): Promise<string> {
    return decoder.decode(await git(cwd, args)).trim();
  }
  try {
    const source = await realpath(root);
    const head = await text(source, ["rev-parse", "--verify", "HEAD"]);
    if (!OBJECT_ID.test(head) || (expectedSha !== undefined && head !== expectedSha)) reject();
    const commonRaw = await text(source, ["rev-parse", "--git-common-dir"]);
    const common = await realpath(isAbsolute(commonRaw) ? commonRaw : resolve(source, commonRaw));
    if (
      (await exists(join(common, "shallow"))) ||
      (await exists(join(common, "info/grafts"))) ||
      (await text(source, ["for-each-ref", "--format=%(refname)", "refs/replace/"])) !== ""
    )
      reject();
    if ((await text(source, ["rev-parse", "--show-object-format"])) !== "sha1") reject();

    const snapshot = join(temporary, "snapshot.git");
    await git(temporary, [
      "init",
      "--bare",
      "--quiet",
      "--template=",
      "--object-format=sha1",
      snapshot,
    ]);
    const objects = await realpath(join(common, "objects"));
    if (/[\r\n]/u.test(objects)) reject();
    const alternates = join(snapshot, "objects/info/alternates");
    await writeFile(alternates, `${objects}\n`);
    // Pack through an isolated repository: source config cannot hide parents or execute helpers.
    const pack = await git(
      snapshot,
      ["pack-objects", "--stdout", "--revs"],
      new TextEncoder().encode(`${head}\n`),
    );
    await unlink(alternates);
    await git(snapshot, ["index-pack", "--stdin", "--strict"], pack);
    await git(snapshot, ["update-ref", "refs/heads/main", head]);
    const result = await inspectReachableHistory(snapshot, {
      allowedIdentities: APPROVED_PUBLIC_IDENTITIES,
      allowedAuthorAliases: APPROVED_DEVELOPMENT_AUTHOR_ALIASES,
      allowedCommitterIdentities: APPROVED_FORGE_COMMITTER_IDENTITIES,
      gitEnvironment: env,
    });
    if ((await text(source, ["rev-parse", "--verify", "HEAD"])) !== head) reject();
    return result;
  } catch {
    return reject();
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
