import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compareUtf8 } from "../ci/public-boundary";
import {
  inspectReachableHistory,
  type PublicGitIdentity,
  type PublicGitRef,
} from "../ci/public-history";

export const GITHUB_REPOSITORY = "libre-ai/signalement";
export const GITHUB_REMOTE_URL = "https://github.com/libre-ai/signalement.git";

const OBJECT_ID = /^[0-9a-f]{40,64}$/;
const SAFE_REF = /^refs\/[A-Za-z0-9][^\s~^:?*\\[]*$/;

export interface RemoteHead {
  readonly target: string;
  readonly objectId: string;
}

export interface PeeledRemoteRef {
  readonly name: string;
  readonly objectId: string;
}

export interface RemoteAdvertisement {
  readonly head: RemoteHead | null;
  readonly refs: readonly PublicGitRef[];
  readonly peeled: readonly PeeledRemoteRef[];
}

export interface RemoteAttestationResult {
  readonly headObjectId: string;
  readonly manifestSha256: string;
  readonly objectCount: number;
  readonly refCount: number;
}

interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
}

export interface RemoteAccessPolicy {
  readonly apiRefsCommand: readonly string[];
  readonly repositoryCommand: readonly string[];
  readonly commandEnvironment: Readonly<Record<string, string>> | null;
}

const CURL_GITHUB_ARGUMENTS = [
  "--config",
  "/dev/null",
  "--fail",
  "--silent",
  "--show-error",
  "--proto",
  "=https",
  "--tlsv1.2",
  "--connect-timeout",
  "10",
  "--max-time",
  "30",
  "--header",
  "Accept: application/vnd.github+json",
  "--header",
  "X-GitHub-Api-Version: 2022-11-28",
  "--header",
  "User-Agent: libre-ai-signalement-attestation",
] as const;

function publicGitHubApiCommand(path: string): readonly string[] {
  return ["curl", ...CURL_GITHUB_ARGUMENTS, `https://api.github.com/${path}`];
}

export function createRemoteAccessPolicy(
  visibility: "private" | "public",
  cleanHome: string,
  baseEnvironment: Readonly<Record<string, string | undefined>>,
): RemoteAccessPolicy {
  if (visibility === "private") {
    return {
      apiRefsCommand: [
        "gh",
        "api",
        "--paginate",
        "--slurp",
        `repos/${GITHUB_REPOSITORY}/git/matching-refs/?per_page=100`,
      ],
      repositoryCommand: [
        "gh",
        "api",
        `repos/${GITHUB_REPOSITORY}`,
        "--jq",
        "{full_name,private,archived,disabled}",
      ],
      commandEnvironment: null,
    };
  }

  return {
    apiRefsCommand: publicGitHubApiCommand(
      `repos/${GITHUB_REPOSITORY}/git/matching-refs/?per_page=100`,
    ),
    repositoryCommand: publicGitHubApiCommand(`repos/${GITHUB_REPOSITORY}`),
    commandEnvironment: {
      GCM_INTERACTIVE: "never",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      HOME: cleanHome,
      PATH: baseEnvironment.PATH ?? "/usr/bin:/bin",
      TMPDIR: cleanHome,
      XDG_CONFIG_HOME: join(cleanHome, ".config"),
    },
  };
}

async function run(
  command: readonly string[],
  cwd?: string,
  environment: Readonly<Record<string, string>> | null = null,
): Promise<CommandResult> {
  const child = Bun.spawn([...command], {
    ...(cwd === undefined ? {} : { cwd }),
    ...(environment === null ? {} : { env: { ...environment } }),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout };
}

function assertObjectId(value: string): void {
  if (!OBJECT_ID.test(value)) throw new Error("Remote returned a malformed object ID");
}

function assertRef(value: string): void {
  if (!SAFE_REF.test(value) || value.includes("..") || value.endsWith(".")) {
    throw new Error("Remote returned an unsafe ref name");
  }
}

export function parseRemoteAdvertisement(output: string): RemoteAdvertisement {
  let headTarget: string | null = null;
  let headObjectId: string | null = null;
  const refs = new Map<string, string>();
  const peeled = new Map<string, string>();

  for (const line of output.split("\n").filter(Boolean)) {
    const fields = line.split("\t");
    if (fields.length !== 2) throw new Error("Remote returned a malformed advertisement line");
    const [value, rawName] = fields;
    if (!value || !rawName) throw new Error("Remote returned an incomplete advertisement line");

    if (value.startsWith("ref: ")) {
      if (rawName !== "HEAD" || headTarget !== null) {
        throw new Error("Remote returned an ambiguous HEAD symref");
      }
      headTarget = value.slice("ref: ".length);
      assertRef(headTarget);
      continue;
    }
    assertObjectId(value);
    if (rawName === "HEAD") {
      if (headObjectId !== null) throw new Error("Remote returned duplicate HEAD metadata");
      headObjectId = value;
      continue;
    }
    if (rawName.endsWith("^{}")) {
      const name = rawName.slice(0, -3);
      assertRef(name);
      if (!name.startsWith("refs/tags/") || peeled.has(name)) {
        throw new Error("Remote returned an invalid peeled ref");
      }
      peeled.set(name, value);
      continue;
    }
    assertRef(rawName);
    if (refs.has(rawName)) throw new Error("Remote returned a duplicate ref");
    refs.set(rawName, value);
  }

  if ((headTarget === null) !== (headObjectId === null)) {
    throw new Error("Remote returned incomplete HEAD metadata");
  }
  for (const name of peeled.keys()) {
    if (!refs.has(name)) throw new Error("Remote returned a peeled line without its tag ref");
  }

  const sortedRefs = [...refs].map(([name, objectId]) => ({ name, objectId }));
  sortedRefs.sort((left, right) => compareUtf8(left.name, right.name));
  const sortedPeeled = [...peeled].map(([name, objectId]) => ({ name, objectId }));
  sortedPeeled.sort((left, right) => compareUtf8(left.name, right.name));
  return {
    head:
      headTarget === null || headObjectId === null
        ? null
        : { target: headTarget, objectId: headObjectId },
    refs: sortedRefs,
    peeled: sortedPeeled,
  };
}

export function parseGitHubApiRefs(output: string): readonly PublicGitRef[] {
  const parsed: unknown = JSON.parse(output);
  if (!Array.isArray(parsed)) throw new Error("GitHub returned a malformed ref inventory");
  const flattened = parsed.flatMap((page) => (Array.isArray(page) ? page : [page]));
  const refs = new Map<string, string>();
  for (const item of flattened) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error("GitHub returned a malformed ref entry");
    }
    const record = item as { ref?: unknown; object?: { sha?: unknown } };
    if (typeof record.ref !== "string" || typeof record.object?.sha !== "string") {
      throw new Error("GitHub returned an incomplete ref entry");
    }
    assertRef(record.ref);
    assertObjectId(record.object.sha);
    if (refs.has(record.ref)) throw new Error("GitHub returned a duplicate ref");
    refs.set(record.ref, record.object.sha);
  }
  return [...refs]
    .map(([name, objectId]) => ({ name, objectId }))
    .sort((left, right) => compareUtf8(left.name, right.name));
}

function compareRefs(
  expectedRefs: readonly PublicGitRef[],
  actualRefs: readonly PublicGitRef[],
  missingPrefix: string,
  unexpectedPrefix: string,
  mismatchPrefix: string,
): string[] {
  const findings: string[] = [];
  const expected = new Map(expectedRefs.map((ref) => [ref.name, ref.objectId]));
  const actual = new Map(actualRefs.map((ref) => [ref.name, ref.objectId]));
  for (const ref of [...expected.keys()].sort(compareUtf8)) {
    if (!actual.has(ref)) findings.push(`${missingPrefix}:${ref}`);
    else if (actual.get(ref) !== expected.get(ref)) findings.push(`${mismatchPrefix}:${ref}`);
  }
  for (const ref of [...actual.keys()].sort(compareUtf8)) {
    if (!expected.has(ref)) findings.push(`${unexpectedPrefix}:${ref}`);
  }
  return findings;
}

export function compareRemoteAdvertisement(
  advertisement: RemoteAdvertisement,
  expectedRefs: readonly PublicGitRef[],
): readonly string[] {
  const findings: string[] = [];
  const expectedMain = expectedRefs.find(({ name }) => name === "refs/heads/main");
  if (expectedRefs.length === 0) {
    if (advertisement.head !== null) findings.push("unexpected-head");
  } else if (advertisement.head === null) {
    findings.push("missing-head");
  } else {
    if (advertisement.head.objectId !== expectedMain?.objectId) {
      findings.push("head-object-mismatch");
    }
    if (advertisement.head.target !== "refs/heads/main") {
      findings.push("head-target-mismatch");
    }
  }
  findings.push(
    ...compareRefs(
      expectedRefs,
      advertisement.refs,
      "missing-ref",
      "unexpected-ref",
      "ref-object-mismatch",
    ),
  );
  return findings;
}

export function compareGitHubApiRefs(
  advertisedRefs: readonly PublicGitRef[],
  apiRefs: readonly PublicGitRef[],
): readonly string[] {
  return compareRefs(
    advertisedRefs,
    apiRefs,
    "git-only-ref",
    "api-only-ref",
    "api-object-mismatch",
  );
}

export async function verifyRemoteAttestation(
  expectedHead: string,
  expectedManifestSha256: string,
  expectedVisibility: "private" | "public",
  allowedIdentities: readonly PublicGitIdentity[],
): Promise<RemoteAttestationResult> {
  assertObjectId(expectedHead);
  if (!/^[0-9a-f]{64}$/.test(expectedManifestSha256)) {
    throw new Error("Expected manifest digest is malformed");
  }

  const root = await mkdtemp(join(tmpdir(), "signalement-remote-attestation-"));
  const cleanHome = join(root, "home");
  const mirror = join(root, "mirror.git");
  const checkout = join(root, "checkout");
  try {
    await mkdir(cleanHome, { recursive: true });
    const access = createRemoteAccessPolicy(expectedVisibility, cleanHome, process.env);
    const environment = access.commandEnvironment;

    const advertisementResult = await run(
      ["git", "ls-remote", "--symref", GITHUB_REMOTE_URL],
      undefined,
      environment,
    );
    if (advertisementResult.exitCode !== 0) throw new Error("Unable to read remote Git refs");
    const advertisement = parseRemoteAdvertisement(advertisementResult.stdout);
    const expectedRefs = [{ name: "refs/heads/main", objectId: expectedHead }] as const;
    const advertisementFindings = compareRemoteAdvertisement(advertisement, expectedRefs);
    if (advertisementFindings.length > 0) {
      throw new Error(`Remote Git advertisement differs: ${advertisementFindings.join(", ")}`);
    }

    const apiResult = await run(access.apiRefsCommand, undefined, environment);
    if (apiResult.exitCode !== 0) throw new Error("Unable to read GitHub API refs");
    const apiFindings = compareGitHubApiRefs(
      advertisement.refs,
      parseGitHubApiRefs(apiResult.stdout),
    );
    if (apiFindings.length > 0) {
      throw new Error(`GitHub API refs differ: ${apiFindings.join(", ")}`);
    }

    const repositoryResult = await run(access.repositoryCommand, undefined, environment);
    if (repositoryResult.exitCode !== 0) {
      throw new Error("Unable to read GitHub repository state");
    }
    const repository = JSON.parse(repositoryResult.stdout) as {
      full_name?: unknown;
      private?: unknown;
      archived?: unknown;
      disabled?: unknown;
    };
    if (
      repository.full_name !== GITHUB_REPOSITORY ||
      repository.private !== (expectedVisibility === "private") ||
      repository.archived !== false ||
      repository.disabled !== false
    ) {
      throw new Error("GitHub repository state differs from the expected publication phase");
    }

    const initialized = await run(
      ["git", "init", "--bare", "--quiet", mirror],
      undefined,
      environment,
    );
    if (initialized.exitCode !== 0) throw new Error("Unable to initialize clean-room mirror");
    const refspecs = advertisement.refs.map(({ name }) => `+${name}:${name}`);
    const fetched = await run(
      ["git", "fetch", "--no-tags", GITHUB_REMOTE_URL, ...refspecs],
      mirror,
      environment,
    );
    if (fetched.exitCode !== 0) throw new Error("Unable to fetch every advertised remote ref");
    const fsck = await run(["git", "fsck", "--full", "--strict"], mirror, environment);
    if (fsck.exitCode !== 0) throw new Error("Remote mirror failed strict object verification");

    const history = await inspectReachableHistory(mirror, {
      allowedIdentities,
      authorizedRefs: advertisement.refs.map(({ name }) => name),
    });
    if (history.findings.length > 0) {
      throw new Error(`Remote mirror history rejected ${history.findings.length} finding(s)`);
    }
    if (history.objectManifestSha256 !== expectedManifestSha256) {
      throw new Error("Remote mirror manifest digest differs from the expected digest");
    }

    const checkedOut = await run(
      [
        "git",
        `--git-dir=${mirror}`,
        "worktree",
        "add",
        "--detach",
        "--quiet",
        checkout,
        expectedHead,
      ],
      undefined,
      environment,
    );
    if (checkedOut.exitCode !== 0) throw new Error("Unable to create clean-room checkout");
    const installed = await run(
      [process.execPath, "install", "--frozen-lockfile"],
      checkout,
      environment,
    );
    if (installed.exitCode !== 0) throw new Error("Clean-room dependency installation failed");
    const checked = await run([process.execPath, "run", "check"], checkout, environment);
    if (checked.exitCode !== 0) throw new Error("Clean-room product gate failed");

    return {
      headObjectId: expectedHead,
      manifestSha256: history.objectManifestSha256,
      objectCount: history.objectCount,
      refCount: history.refs.length,
    };
  } finally {
    await rm(root, { recursive: true });
  }
}
