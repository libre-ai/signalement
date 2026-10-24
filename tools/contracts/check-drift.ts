import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatedValidator } from "./generate-validator.ts";
import { type ContractPin, parsePin } from "./pin.ts";

const AUTHORITY_REPOSITORY = "https://github.com/libre-ai/schemas-and-contracts";
const AUTHORITY_COMMIT = "5b3f940c550800a9ce13f73f4bfcfdb8eba08925";
// Pin the inventory itself: editing a vendored file and its listed hash must
// not manufacture conformance to the immutable upstream revision.
const PIN_DIGEST = "44460452520dc6fdfe30de206b4faabd44ad16e157cfd6ba8f328fe37c558d94";
/** Contract ids this repository consumes, in pin order: the pin must list exactly these. */
export const CONSUMED_CONTRACTS: readonly string[] = ["signalement-local-export-v1"];

const VENDOR_ROOT = new URL("../../vendor/contracts/", import.meta.url);

function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** What the vendored copy is expected to be; tests substitute a synthetic vendor. */
export interface VendorExpectation {
  root: URL;
  pinDigest: string;
  repository: string;
  commit: string;
  /** Contract ids, pin order. */
  consumed: readonly string[];
  validator: { committed: URL; generated: () => string } | null;
}

export const PRODUCTION_VENDOR: VendorExpectation = {
  root: VENDOR_ROOT,
  pinDigest: PIN_DIGEST,
  repository: AUTHORITY_REPOSITORY,
  commit: AUTHORITY_COMMIT,
  consumed: CONSUMED_CONTRACTS,
  validator: {
    committed: new URL("../../packages/domain/schema-validator.js", import.meta.url),
    generated: generatedValidator,
  },
};

async function readOrNull(url: URL): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(url));
  } catch {
    return null;
  }
}

const DUPLICATE = "duplicate" as const;

/**
 * Catalog entries by id; an unreadable or malformed catalog yields no entry at all.
 * An id listed twice maps to `DUPLICATE`: neither entry is trusted, so a candidate
 * cannot hide behind a locked twin (or the reverse) whichever one a lookup would pick.
 */
async function catalogEntries(
  root: URL,
): Promise<Map<string, Record<string, unknown> | typeof DUPLICATE>> {
  const entries = new Map<string, Record<string, unknown> | typeof DUPLICATE>();
  const bytes = await readOrNull(new URL("contracts/catalog.v1.json", root));
  if (bytes === null) return entries;
  let catalog: unknown;
  try {
    catalog = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return entries;
  }
  const contracts = (catalog as { contracts?: unknown } | null)?.contracts;
  if (!Array.isArray(contracts)) return entries;
  for (const entry of contracts)
    if (typeof entry === "object" && entry !== null && typeof entry.id === "string")
      entries.set(entry.id, entries.has(entry.id) ? DUPLICATE : entry);
  return entries;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** `path`, `profiles` and `vectors` of a catalog entry that the contract's own files do not vendor. */
function authorityUnvendored(entry: Record<string, unknown>, files: readonly string[]): boolean {
  const vendored = new Set(files);
  if (typeof entry.path !== "string" || !vendored.has(entry.path)) return true;
  for (const field of ["profiles", "vectors"]) {
    if (!(field in entry)) continue;
    const listed = entry[field];
    if (!isStringArray(listed) || !listed.every((path) => vendored.has(path))) return true;
  }
  return false;
}

async function inventoryFailures(root: URL, declared: ReadonlySet<string>): Promise<string[]> {
  const failures: string[] = [];
  async function walk(path: string, prefix: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) await walk(join(path, entry.name), `${relative}/`);
      else if (!entry.isFile() || (relative !== "pin.json" && !declared.has(relative)))
        failures.push("vendor.inventory");
    }
  }
  try {
    await walk(fileURLToPath(root), "");
  } catch {
    return ["vendor.inventory"];
  }
  return failures;
}

/** Offline checks over the vendored copy: pin identity, inventory, hashes, per-contract lock, validator. */
export async function vendoredDriftFailures(
  expectation: VendorExpectation = PRODUCTION_VENDOR,
): Promise<string[]> {
  const { root } = expectation;
  const pinBytes = await readOrNull(new URL("pin.json", root));
  if (pinBytes === null || sha256(pinBytes) !== expectation.pinDigest) return ["pin.digest"];
  const pin = parsePin(pinBytes);
  if (pin === null) return ["pin.schema"];
  const failures: string[] = [];
  if (pin.repository !== expectation.repository || pin.commit !== expectation.commit)
    failures.push("pin.identity");

  const pinned = new Set(pin.contracts.map((contract) => contract.id));
  for (const id of expectation.consumed)
    if (!pinned.has(id)) failures.push(`pin.contract_missing:${id}`);
  for (const id of pinned)
    if (!expectation.consumed.includes(id)) failures.push(`pin.contract_unexpected:${id}`);

  const declared = new Set(Object.keys(pin.files));
  const cited = new Set(pin.contracts.flatMap((contract) => contract.files));
  for (const path of cited) if (!declared.has(path)) failures.push(`pin.file_undeclared:${path}`);
  for (const path of declared) if (!cited.has(path)) failures.push(`pin.file_orphan:${path}`);

  failures.push(...(await inventoryFailures(root, declared)));
  for (const [path, expected] of Object.entries(pin.files)) {
    const bytes = await readOrNull(new URL(path, root));
    if (bytes === null) failures.push(`vendor.missing:${path}`);
    else if (sha256(bytes) !== expected) failures.push(`vendor.drift:${path}`);
  }

  const catalog = await catalogEntries(root);
  for (const contract of pin.contracts) {
    const entry = catalog.get(contract.id);
    if (entry === undefined) {
      failures.push(`contract.missing:${contract.id}`);
      continue;
    }
    if (entry === DUPLICATE) {
      failures.push(`catalog.duplicate_id:${contract.id}`);
      continue;
    }
    if (entry.status !== contract.status) failures.push(`contract.status_mismatch:${contract.id}`);
    if (entry.status !== "locked" || "review" in entry)
      failures.push(`contract.not_locked:${contract.id}`);
    if (authorityUnvendored(entry, contract.files))
      failures.push(`contract.authority_unvendored:${contract.id}`);
  }

  if (expectation.validator !== null) {
    const committed = await readOrNull(expectation.validator.committed);
    if (
      committed === null ||
      new TextDecoder().decode(committed) !== expectation.validator.generated()
    )
      failures.push("validator.drift");
  }
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

async function productionPin(): Promise<ContractPin | null> {
  const bytes = await readOrNull(new URL("pin.json", VENDOR_ROOT));
  return bytes === null ? null : parsePin(bytes);
}

/** Every declared file must be read from the authority and match its pinned hash. */
export async function authorityDriftFailures(
  reader: AuthorityReader = readAuthorityWithGit,
  pin?: ContractPin,
): Promise<{ failures: string[]; verified: number; servedBranch: string | null }> {
  const pinned = pin ?? (await productionPin());
  if (pinned === null) return { failures: ["pin.schema"], verified: 0, servedBranch: null };
  const paths = Object.keys(pinned.files);
  const snapshot = await reader(pinned.repository, pinned.commit, paths);
  if ("failure" in snapshot)
    return { failures: [snapshot.failure], verified: 0, servedBranch: null };
  const failures: string[] = [];
  if (!snapshot.pinOnServedLine) failures.push("authority.unmerged");
  let verified = 0;
  for (const [path, expected] of Object.entries(pinned.files)) {
    const bytes = snapshot.files.get(path);
    if (bytes === undefined || bytes === null) failures.push(`authority.missing:${path}`);
    else if (sha256(bytes) !== expected) failures.push(`authority.drift:${path}`);
    else verified += 1;
  }
  return { failures, verified, servedBranch: snapshot.servedBranch };
}

if (import.meta.main) {
  const vendored = await vendoredDriftFailures();
  const pin = await productionPin();
  if (pin === null) {
    // No parsable pin: nothing to verify against the authority, and vendored already says why.
    console.error(vendored.join("\n"));
    process.exitCode = 1;
  } else {
    const authority = await authorityDriftFailures(readAuthorityWithGit, pin);
    const failures = [...vendored, ...authority.failures];
    const locked = pin.contracts.filter((contract) => contract.status === "locked").length;
    const volume = `${authority.verified}/${Object.keys(pin.files).length} vendored files matched ${pin.repository}@${pin.commit} (served branch: ${authority.servedBranch ?? "unreadable"}); ${pin.contracts.length} contracts (${locked} locked): ${pin.contracts.map((contract) => contract.id).join(", ")}`;
    if (failures.length) {
      console.error(`${volume}\n${failures.join("\n")}`);
      process.exitCode = 1;
    } else console.log(volume);
  }
}
