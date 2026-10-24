export const CONTRACT_PIN_SCHEMA_VERSION = "signalement.contract-pin.v2";

export interface PinnedContract {
  id: string;
  status: "locked" | "candidate";
  files: readonly string[];
}

export interface ContractPin {
  schemaVersion: typeof CONTRACT_PIN_SCHEMA_VERSION;
  repository: string;
  commit: string;
  contracts: readonly PinnedContract[];
  files: Readonly<Record<string, string>>;
}

const REPOSITORY = /^(https|file):\/\/\S+$/;
const COMMIT = /^[0-9a-f]{40}$/;
const CONTRACT_ID = /^[a-z][a-z0-9-]*-v[1-9][0-9]*$/;
const PATH = /^(contracts|tools)\/[A-Za-z0-9._/-]+$/;
const DIGEST = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

// A path reaches the filesystem and, through the pin, git argv: refuse empty,
// "." and ".." segments, not only the ".." substring the pattern could miss.
function isPinPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    PATH.test(value) &&
    value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

function parseContract(value: unknown): PinnedContract | null {
  if (!isRecord(value) || !hasExactKeys(value, ["id", "status", "files"])) return null;
  const { id, status, files } = value;
  if (typeof id !== "string" || !CONTRACT_ID.test(id)) return null;
  if (status !== "locked" && status !== "candidate") return null;
  if (!Array.isArray(files) || files.length === 0) return null;
  if (!files.every(isPinPath) || new Set(files).size !== files.length) return null;
  return { id, status, files: [...files] };
}

/** Strict reader of `vendor/contracts/pin.json`: any deviation is `null`, never a partial pin. */
export function parsePin(bytes: Uint8Array): ContractPin | null {
  let document: unknown;
  try {
    document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (
    !isRecord(document) ||
    !hasExactKeys(document, ["schemaVersion", "repository", "commit", "contracts", "files"])
  )
    return null;
  const { schemaVersion, repository, commit, contracts, files } = document;
  if (schemaVersion !== CONTRACT_PIN_SCHEMA_VERSION) return null;
  if (typeof repository !== "string" || !REPOSITORY.test(repository)) return null;
  if (typeof commit !== "string" || !COMMIT.test(commit)) return null;
  if (!Array.isArray(contracts) || contracts.length === 0) return null;
  const parsed: PinnedContract[] = [];
  for (const candidate of contracts) {
    const contract = parseContract(candidate);
    if (contract === null) return null;
    parsed.push(contract);
  }
  if (new Set(parsed.map((contract) => contract.id)).size !== parsed.length) return null;
  if (!isRecord(files)) return null;
  const table: Record<string, string> = {};
  for (const [path, digest] of Object.entries(files)) {
    if (!isPinPath(path) || typeof digest !== "string" || !DIGEST.test(digest)) return null;
    table[path] = digest;
  }
  return {
    schemaVersion: CONTRACT_PIN_SCHEMA_VERSION,
    repository,
    commit,
    contracts: parsed,
    files: table,
  };
}
