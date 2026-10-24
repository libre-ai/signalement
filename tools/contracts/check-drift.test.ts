import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type AuthorityReader,
  authorityDriftFailures,
  CONSUMED_CONTRACTS,
  PRODUCTION_VENDOR,
  readAuthorityWithGit,
  type VendorExpectation,
  vendoredDriftFailures,
} from "./check-drift.ts";
import { type ContractPin, parsePin } from "./pin.ts";

const vendor = new URL("../../vendor/contracts/", import.meta.url);
const pin = parsePin(await readFile(new URL("pin.json", vendor)));
if (pin === null) throw new Error("vendor/contracts/pin.json is not a v2 pin");
const paths = Object.keys(pin.files);

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

// --- Offline vendored checks over synthetic multi-contract vendors -----------------------------

const SYNTHETIC_REPOSITORY = "https://example.invalid/authority";
const SYNTHETIC_COMMIT = "1".repeat(40);
const CATALOG = "contracts/catalog.v1.json";
const schemaPath = (name: string) => `contracts/schemas/${name}.v1.schema.json`;

interface SyntheticContract {
  id: string;
  status: "locked" | "candidate";
  files: string[];
}
interface SyntheticSpec {
  catalog: Record<string, unknown>[];
  contracts: SyntheticContract[];
  /** Vendored files other than the catalog; each one is written and hashed into the pin. */
  disk: Record<string, string>;
  consumed: string[];
}

function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function lockedContract(name: string): SyntheticContract {
  return {
    id: `${name}-v1`,
    status: "locked",
    files: [CATALOG, schemaPath(name)],
  };
}
function lockedEntry(name: string): Record<string, unknown> {
  return {
    id: `${name}-v1`,
    kind: "json-schema",
    path: schemaPath(name),
    status: "locked",
  };
}
function twoLocked(): SyntheticSpec {
  return {
    catalog: [lockedEntry("a"), lockedEntry("b")],
    contracts: [lockedContract("a"), lockedContract("b")],
    disk: { [schemaPath("a")]: '{"title":"a"}', [schemaPath("b")]: '{"title":"b"}' },
    consumed: ["a-v1", "b-v1"],
  };
}
function withCatalogStatus(
  id: string,
  catalogStatus: "locked" | "candidate",
  pinStatus: "locked" | "candidate",
): SyntheticSpec {
  const spec = twoLocked();
  spec.catalog = spec.catalog.map((entry) =>
    entry.id === id
      ? {
          ...entry,
          status: catalogStatus,
          ...(catalogStatus === "candidate"
            ? {
                review: {
                  state: "pending-independent-agent-review",
                  required: ["architecture", "security"],
                },
              }
            : {}),
        }
      : entry,
  );
  spec.contracts = spec.contracts.map((contract) =>
    contract.id === id ? { ...contract, status: pinStatus } : contract,
  );
  return spec;
}

const syntheticRoots: string[] = [];
afterAll(async () => {
  for (const root of syntheticRoots) await rm(root, { recursive: true, force: true });
});

/** Writes catalog, files and pin under a temporary root; expected values are set by the spec. */
async function syntheticVendor(
  spec: SyntheticSpec,
  mutatePin: (pin: Record<string, unknown>) => Record<string, unknown> = (pin) => pin,
): Promise<VendorExpectation> {
  const directory = await mkdtemp(join(tmpdir(), "signalement-synthetic-vendor-"));
  syntheticRoots.push(directory);
  const root = new URL(`${pathToFileURL(directory).href}/`);
  const bytes: Record<string, string> = {
    ...spec.disk,
    [CATALOG]: JSON.stringify({ contracts: spec.catalog }),
  };
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(bytes)) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), content);
    files[path] = sha256(content);
  }
  const pinBytes = JSON.stringify(
    mutatePin({
      schemaVersion: "signalement.contract-pin.v2",
      repository: SYNTHETIC_REPOSITORY,
      commit: SYNTHETIC_COMMIT,
      contracts: spec.contracts,
      files,
    }),
  );
  await writeFile(join(directory, "pin.json"), pinBytes);
  return {
    root,
    pinDigest: sha256(pinBytes),
    repository: SYNTHETIC_REPOSITORY,
    commit: SYNTHETIC_COMMIT,
    consumed: spec.consumed,
    validator: null,
  };
}

test("a clean synthetic vendor of two locked contracts passes", async () =>
  expect(await vendoredDriftFailures(await syntheticVendor(twoLocked()))).toEqual([]));

test("a candidate at the pinned commit is contract.not_locked, never a pass", async () =>
  expect(
    await vendoredDriftFailures(
      await syntheticVendor(withCatalogStatus("b-v1", "candidate", "candidate")),
    ),
  ).toEqual(["contract.not_locked:b-v1"]));

test("a pin status that disagrees with the catalog is contract.status_mismatch", async () =>
  expect(
    await vendoredDriftFailures(
      await syntheticVendor(withCatalogStatus("b-v1", "candidate", "locked")),
    ),
  ).toEqual(["contract.status_mismatch:b-v1", "contract.not_locked:b-v1"]));

test("a locked catalog entry that still carries a review is contract.not_locked", async () => {
  const spec = twoLocked();
  spec.catalog = spec.catalog.map((entry) =>
    entry.id === "a-v1" ? { ...entry, review: { state: "pending" } } : entry,
  );
  expect(await vendoredDriftFailures(await syntheticVendor(spec))).toEqual([
    "contract.not_locked:a-v1",
  ]);
});

test("a consumed contract absent from the pin is pin.contract_missing", async () =>
  expect(
    await vendoredDriftFailures({
      ...(await syntheticVendor(twoLocked())),
      consumed: ["a-v1", "b-v1", "c-v1"],
    }),
  ).toEqual(["pin.contract_missing:c-v1"]));

test("a pinned contract nobody consumes is pin.contract_unexpected", async () =>
  expect(
    await vendoredDriftFailures({ ...(await syntheticVendor(twoLocked())), consumed: ["a-v1"] }),
  ).toEqual(["pin.contract_unexpected:b-v1"]));

test("a declared vendored file that is missing is vendor.missing, not a thrown error", async () => {
  const v = await syntheticVendor(twoLocked());
  await unlink(new URL("contracts/schemas/b.v1.schema.json", v.root));
  expect(await vendoredDriftFailures(v)).toEqual([
    "vendor.missing:contracts/schemas/b.v1.schema.json",
  ]);
});

test("a vendored file whose bytes changed is vendor.drift", async () => {
  const v = await syntheticVendor(twoLocked());
  await writeFile(new URL("contracts/schemas/b.v1.schema.json", v.root), '{"title":"changed"}');
  expect(await vendoredDriftFailures(v)).toEqual([
    "vendor.drift:contracts/schemas/b.v1.schema.json",
  ]);
});

test("an undeclared file under the vendor root is vendor.inventory", async () => {
  const v = await syntheticVendor(twoLocked());
  await writeFile(new URL("contracts/stray.md", v.root), "stray");
  expect(await vendoredDriftFailures(v)).toEqual(["vendor.inventory"]);
});

test("a catalog without the pinned contract is contract.missing", async () => {
  const spec = twoLocked();
  spec.catalog = spec.catalog.filter((entry) => entry.id !== "b-v1");
  expect(await vendoredDriftFailures(await syntheticVendor(spec))).toEqual([
    "contract.missing:b-v1",
  ]);
});

test("an unreadable catalog fails every pinned contract instead of passing", async () => {
  const spec = twoLocked();
  const v = await syntheticVendor(spec, (pin) => ({
    ...pin,
    files: { ...(pin.files as Record<string, string>), [CATALOG]: sha256("not json") },
  }));
  await writeFile(new URL(CATALOG, v.root), "not json");
  expect(await vendoredDriftFailures(v)).toEqual([
    "contract.missing:a-v1",
    "contract.missing:b-v1",
  ]);
});

test("a catalog path, profile or vector the contract does not vendor is contract.authority_unvendored", async () => {
  for (const field of ["profiles", "vectors"] as const) {
    const spec = twoLocked();
    spec.catalog = spec.catalog.map((entry) =>
      entry.id === "b-v1" ? { ...entry, [field]: ["contracts/b/EXTRA.md"] } : entry,
    );
    expect([field, await vendoredDriftFailures(await syntheticVendor(spec))]).toEqual([
      field,
      ["contract.authority_unvendored:b-v1"],
    ]);
  }
  const unvendoredPath = twoLocked();
  unvendoredPath.catalog = unvendoredPath.catalog.map((entry) =>
    entry.id === "b-v1" ? { ...entry, path: "contracts/schemas/elsewhere.json" } : entry,
  );
  expect(await vendoredDriftFailures(await syntheticVendor(unvendoredPath))).toEqual([
    "contract.authority_unvendored:b-v1",
  ]);
});

test("vendoring a profile for another contract does not vendor it for this one", async () => {
  const spec = twoLocked();
  const profile = "contracts/a/PROFILE.md";
  spec.disk[profile] = "profile";
  spec.contracts = spec.contracts.map((contract) =>
    contract.id === "a-v1" ? { ...contract, files: [...contract.files, profile] } : contract,
  );
  spec.catalog = spec.catalog.map((entry) =>
    entry.id === "b-v1" ? { ...entry, profiles: [profile] } : entry,
  );
  expect(await vendoredDriftFailures(await syntheticVendor(spec))).toEqual([
    "contract.authority_unvendored:b-v1",
  ]);
});

test("a file in the table that no contract cites is pin.file_orphan", async () => {
  const spec = twoLocked();
  spec.disk["contracts/orphan.md"] = "orphan";
  expect(await vendoredDriftFailures(await syntheticVendor(spec))).toEqual([
    "pin.file_orphan:contracts/orphan.md",
  ]);
});

test("a file a contract cites but the table lacks is pin.file_undeclared", async () => {
  const spec = twoLocked();
  spec.contracts = spec.contracts.map((contract) =>
    contract.id === "b-v1"
      ? { ...contract, files: [...contract.files, "contracts/ghost.md"] }
      : contract,
  );
  expect(await vendoredDriftFailures(await syntheticVendor(spec))).toEqual([
    "pin.file_undeclared:contracts/ghost.md",
  ]);
});

test("pin.digest stops the run alone, before the pin is even parsed", async () => {
  const v = await syntheticVendor(twoLocked());
  expect(await vendoredDriftFailures({ ...v, pinDigest: "0".repeat(64) })).toEqual(["pin.digest"]);
  await unlink(new URL("pin.json", v.root));
  expect(await vendoredDriftFailures(v)).toEqual(["pin.digest"]);
});

test("a pin that is not the v2 format stops the run alone as pin.schema", async () => {
  const v = await syntheticVendor(twoLocked(), (pin) => ({
    ...pin,
    schemaVersion: "signalement.contract-pin.v1",
  }));
  expect(await vendoredDriftFailures(v)).toEqual(["pin.schema"]);
});

test("a pin naming another repository or commit than the reviewed constants is pin.identity", async () => {
  const v = await syntheticVendor(twoLocked());
  expect(
    await vendoredDriftFailures({ ...v, repository: "https://example.invalid/other" }),
  ).toEqual(["pin.identity"]);
  expect(await vendoredDriftFailures({ ...v, commit: "2".repeat(40) })).toEqual(["pin.identity"]);
});

test("a committed validator that differs from the generated one is validator.drift", async () => {
  const v = await syntheticVendor(twoLocked());
  // Outside the vendor root: a validator file inside it would be an undeclared vendored file.
  const directory = await mkdtemp(join(tmpdir(), "signalement-synthetic-validator-"));
  syntheticRoots.push(directory);
  const committed = pathToFileURL(join(directory, "validator.js"));
  await writeFile(committed, "committed");
  expect(
    await vendoredDriftFailures({ ...v, validator: { committed, generated: () => "committed" } }),
  ).toEqual([]);
  expect(
    await vendoredDriftFailures({ ...v, validator: { committed, generated: () => "other" } }),
  ).toEqual(["validator.drift"]);
  await unlink(committed);
  expect(
    await vendoredDriftFailures({ ...v, validator: { committed, generated: () => "committed" } }),
  ).toEqual(["validator.drift"]);
});

test("codes come in the documented order across categories", async () => {
  const spec = twoLocked();
  spec.disk["contracts/orphan.md"] = "orphan";
  spec.catalog = spec.catalog.filter((entry) => entry.id !== "b-v1");
  const v = await syntheticVendor(spec);
  await writeFile(new URL("contracts/stray.md", v.root), "stray");
  await writeFile(new URL("contracts/schemas/a.v1.schema.json", v.root), "changed");
  expect(await vendoredDriftFailures({ ...v, consumed: ["a-v1", "c-v1"] })).toEqual([
    "pin.contract_missing:c-v1",
    "pin.contract_unexpected:b-v1",
    "pin.file_orphan:contracts/orphan.md",
    "vendor.inventory",
    "vendor.drift:contracts/schemas/a.v1.schema.json",
    "contract.missing:b-v1",
  ]);
});

test("the production vendor consumes exactly the contracts it pins", () => {
  expect(PRODUCTION_VENDOR.consumed).toEqual(CONSUMED_CONTRACTS);
  expect(CONSUMED_CONTRACTS).toEqual(["signalement-local-export-v1"]);
  expect(pin.contracts.map((contract) => contract.id)).toEqual([...CONSUMED_CONTRACTS]);
});

test("the authority gate verifies the whole file table of a multi-contract pin", async () => {
  const multi: ContractPin = {
    ...pin,
    contracts: [
      { id: "a-v1", status: "locked", files: [paths[0] ?? ""] },
      { id: "b-v1", status: "locked", files: paths.slice(1) },
    ],
  };
  const files = new Map<string, Uint8Array | null>();
  for (const path of paths) files.set(path, await readFile(new URL(path, vendor)));
  const requested: string[][] = [];
  const reader: AuthorityReader = async (_repository, _commit, requestedPaths) => {
    requested.push([...requestedPaths]);
    return { servedBranch: "main", pinOnServedLine: true, files };
  };
  expect(await authorityDriftFailures(reader, multi)).toEqual({
    failures: [],
    verified: paths.length,
    servedBranch: "main",
  });
  expect(requested).toEqual([paths]);
});
