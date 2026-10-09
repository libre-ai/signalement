import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pin from "../../vendor/contracts/pin.json";
import { generatedValidator } from "./generate-validator.ts";

const AUTHORITY_REPOSITORY = "https://github.com/libre-ai/schemas-and-contracts";
const AUTHORITY_COMMIT = "34c143373876e5cf13ecb781f16d773c41751c2d";
// Pin the inventory itself: editing a vendored file and its listed hash must
// not manufacture conformance to the immutable upstream revision.
const PIN_DIGEST = "5b02d5e7afe36a1396fa70e8c081f8e324f7611b11681acddacbab2f87e95107";

function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Offline checks over the vendored copy: pin identity, inventory, hashes, catalog, validator. */
export async function vendoredDriftFailures(): Promise<string[]> {
  const failures: string[] = [];
  const root = new URL("../../vendor/contracts/", import.meta.url);
  if (sha256(await readFile(new URL("pin.json", root))) !== PIN_DIGEST) return ["pin.digest"];
  if (
    pin.repository !== AUTHORITY_REPOSITORY ||
    pin.commit !== AUTHORITY_COMMIT ||
    pin.contract !== "signalement-local-export-v1" ||
    pin.status !== "locked"
  )
    failures.push("pin.identity");
  const declared = new Set(Object.keys(pin.files));
  async function walk(path: string, prefix: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) await walk(resolve(path, entry.name), `${relative}/`);
      else if (!entry.isFile() || (relative !== "pin.json" && !declared.has(relative)))
        failures.push("vendor.inventory");
    }
  }
  await walk(root.pathname, "");
  for (const [path, expected] of Object.entries(pin.files)) {
    if (sha256(await readFile(new URL(path, root))) !== expected)
      failures.push(`vendor.drift:${path}`);
  }
  const catalog = JSON.parse(await readFile(new URL("contracts/catalog.v1.json", root), "utf8"));
  const entry = catalog.contracts.find(
    (candidate: { id: string }) => candidate.id === pin.contract,
  );
  if (entry?.status !== "locked" || "review" in entry) failures.push("contract.not_locked");
  if (
    (await readFile(
      new URL("../../packages/domain/schema-validator.js", import.meta.url),
      "utf8",
    )) !== generatedValidator()
  )
    failures.push("validator.drift");
  return failures;
}

/** What the authority serves at the pinned commit; `null` bytes mean unreadable. */
export interface AuthoritySnapshot {
  servedBranch: string;
  pinOnServedLine: boolean;
  files: Map<string, Uint8Array | null>;
}
export type AuthorityReader = (
  repository: string,
  commit: string,
  paths: readonly string[],
) => Promise<AuthoritySnapshot | { failure: string }>;

async function git(cwd: string, ...args: string[]): Promise<{ code: number; stdout: Uint8Array }> {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const stdout = new Uint8Array(await new Response(child.stdout).arrayBuffer());
  return { code: await child.exited, stdout };
}

/**
 * Asks the git protocol, not a quota-bound API: the served branch through
 * `ls-remote --symref`, containment through `merge-base --is-ancestor`, and
 * each file through a blob-filtered fetch of the pinned commit.
 */
export const readAuthorityWithGit: AuthorityReader = async (repository, commit, paths) => {
  // Both values reach git argv: refuse anything that could parse as an option.
  // file:// serves the local test authority; pin.identity admits only the real URL.
  if (!/^(https|file):\/\/[^\s]+$/.test(repository) || !/^[0-9a-f]{40}$/.test(commit))
    return { failure: "authority.identity" };
  const directory = await mkdtemp(join(tmpdir(), "signalement-contract-authority-"));
  try {
    const symref = await git(directory, "ls-remote", "--symref", repository, "HEAD");
    const served = /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m.exec(
      new TextDecoder().decode(symref.stdout),
    )?.[1];
    if (symref.code !== 0 || served === undefined) return { failure: "authority.unreachable" };
    for (const args of [
      ["init", "-q"],
      ["remote", "add", "authority", repository],
      ["config", "remote.authority.promisor", "true"],
      ["config", "remote.authority.partialclonefilter", "blob:none"],
      [
        "fetch",
        "-q",
        "--filter=blob:none",
        "authority",
        `+refs/heads/${served}:refs/remotes/authority/served`,
      ],
      ["fetch", "-q", "--filter=blob:none", "authority", commit],
    ])
      if ((await git(directory, ...args)).code !== 0) return { failure: "authority.unreadable" };
    const ancestry = await git(
      directory,
      "merge-base",
      "--is-ancestor",
      commit,
      "refs/remotes/authority/served",
    );
    if (ancestry.code > 1) return { failure: "authority.unreadable" };
    const files = new Map<string, Uint8Array | null>();
    for (const path of paths) {
      const blob = await git(directory, "cat-file", "blob", `${commit}:${path}`);
      files.set(path, blob.code === 0 ? blob.stdout : null);
    }
    return { servedBranch: served, pinOnServedLine: ancestry.code === 0, files };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

/** Every declared file must be read from the authority and match its pinned hash. */
export async function authorityDriftFailures(
  reader: AuthorityReader = readAuthorityWithGit,
): Promise<{ failures: string[]; verified: number; servedBranch: string | null }> {
  const paths = Object.keys(pin.files);
  const snapshot = await reader(pin.repository, pin.commit, paths);
  if ("failure" in snapshot)
    return { failures: [snapshot.failure], verified: 0, servedBranch: null };
  const failures: string[] = [];
  if (!snapshot.pinOnServedLine) failures.push("authority.unmerged");
  let verified = 0;
  for (const [path, expected] of Object.entries(pin.files)) {
    const bytes = snapshot.files.get(path);
    if (bytes === undefined || bytes === null) failures.push(`authority.missing:${path}`);
    else if (sha256(bytes) !== expected) failures.push(`authority.drift:${path}`);
    else verified += 1;
  }
  return { failures, verified, servedBranch: snapshot.servedBranch };
}

if (import.meta.main) {
  const vendored = await vendoredDriftFailures();
  const authority = await authorityDriftFailures();
  const failures = [...vendored, ...authority.failures];
  const volume = `${authority.verified}/${Object.keys(pin.files).length} vendored files matched ${pin.repository}@${pin.commit} (served branch: ${authority.servedBranch ?? "unreadable"})`;
  if (failures.length) {
    console.error(`${volume}\n${failures.join("\n")}`);
    process.exitCode = 1;
  } else
    console.log(
      `${volume}; pin on the served line, byte-exact vendor and generated validator verified.`,
    );
}
