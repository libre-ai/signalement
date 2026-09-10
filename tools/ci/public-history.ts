import {
  inspectPublicTree,
  type PublicBoundaryCode,
  type PublicBoundaryOptions,
  type PublicFile,
} from "./public-boundary";

export type PublicHistoryCode =
  | PublicBoundaryCode
  | "history-volume-exceeded"
  | "missing-authorized-ref"
  | "unexpected-object-type"
  | "unexpected-ref"
  | "unsafe-history-mode";

export interface PublicHistoryFinding {
  readonly path: string;
  readonly code: PublicHistoryCode;
}

export interface PublicGitRef {
  readonly name: string;
  readonly objectId: string;
}

export interface PublicGitObject {
  readonly objectId: string;
  readonly type: string;
  readonly size: number;
}

export interface PublicHistoryManifest {
  readonly schemaVersion: "libre-ai.git-object-manifest.v1";
  readonly refs: readonly PublicGitRef[];
  readonly objects: readonly PublicGitObject[];
}

export interface PublicHistoryResult {
  readonly commitCount: number;
  readonly blobCount: number;
  readonly objectCount: number;
  readonly objectManifestSha256: string;
  readonly refs: readonly PublicGitRef[];
  readonly manifest: PublicHistoryManifest;
  readonly findings: readonly PublicHistoryFinding[];
}

export interface PublicHistoryOptions extends PublicBoundaryOptions {
  readonly authorizedRefs?: readonly string[];
  readonly maxHistoryBytes?: number;
}

interface CommandResult {
  readonly exitCode: number;
  readonly stdout: Uint8Array;
}

interface HistoricalIndex {
  readonly blobPaths: ReadonlyMap<string, ReadonlySet<string>>;
  readonly findings: readonly PublicHistoryFinding[];
}

interface GitRef extends PublicGitRef {
  readonly objectType: string;
}

interface ObjectMetadata {
  readonly sha: string;
  readonly type: string;
  readonly size: number;
}

const DEFAULT_AUTHORIZED_REFS = ["refs/heads/main"] as const;
const DEFAULT_MAX_FILE_BYTES = 1_048_576;
const DEFAULT_MAX_HISTORY_BYTES = 67_108_864;
const OBJECT_ID = /^[0-9a-f]{40,64}$/;
const ZERO_OBJECT = /^0+$/;
const REGULAR_MODES = new Set(["100644", "100755"]);
const SUPPORTED_OBJECT_TYPES = new Set(["blob", "commit", "tag", "tree"]);
const RAW_HEADER = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) ([A-Z][0-9]*)$/;
const SAFE_REF = /^refs\/[A-Za-z0-9][^\s~^:?*\\[]*$/;

async function runGit(
  arguments_: readonly string[],
  cwd: string,
  input?: string,
): Promise<CommandResult> {
  const process = Bun.spawn(["git", ...arguments_], {
    cwd,
    stdin: input === undefined ? undefined : new Blob([input]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout] = await Promise.all([
    process.exited,
    new Response(process.stdout).bytes(),
  ]);
  await new Response(process.stderr).bytes();
  return { exitCode, stdout };
}

function decode(output: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(output);
}

function validateAuthorizedRefs(refs: readonly string[]): readonly string[] {
  const unique = [...new Set(refs)].sort();
  if (
    unique.length === 0 ||
    unique.length !== refs.length ||
    unique.some((ref) => !SAFE_REF.test(ref) || ref.includes("..") || ref.endsWith("."))
  ) {
    throw new Error("Authorized refs must be unique canonical full refs");
  }
  return unique;
}

function parseRefs(output: Uint8Array): readonly GitRef[] {
  const value = decode(output).trim();
  if (value.length === 0) {
    return [];
  }

  return value
    .split("\n")
    .map((line) => {
      const [name, objectId, objectType, extra] = line.split("\0");
      if (
        !name ||
        !SAFE_REF.test(name) ||
        !objectId ||
        !OBJECT_ID.test(objectId) ||
        !objectType ||
        extra !== undefined
      ) {
        throw new Error("Git returned malformed local ref metadata");
      }
      return { name, objectId, objectType };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function indexHistoricalPaths(output: Uint8Array): HistoricalIndex {
  const records = decode(output)
    .split("\0")
    .filter((record) => record.length > 0);
  const mutablePaths = new Map<string, Set<string>>();
  const findings = new Map<string, PublicHistoryFinding>();

  function addObject(sha: string, mode: string, path: string): void {
    if (ZERO_OBJECT.test(sha)) {
      return;
    }
    if (!REGULAR_MODES.has(mode)) {
      const findingPath = `metadata/paths/unsafe-${findings.size + 1}.txt`;
      findings.set(`${findingPath}\0unsafe-history-mode`, {
        path: findingPath,
        code: "unsafe-history-mode",
      });
    }
    const paths = mutablePaths.get(sha) ?? new Set<string>();
    paths.add(path);
    mutablePaths.set(sha, paths);
  }

  for (let index = 0; index < records.length; index += 2) {
    const header = records[index];
    const path = records[index + 1];
    if (!header || !path) {
      throw new Error("Git history returned an incomplete raw record");
    }
    const match = RAW_HEADER.exec(header);
    if (!match) {
      throw new Error("Git history returned a malformed raw record");
    }
    const [, oldMode, newMode, oldSha, newSha] = match;
    if (!oldMode || !newMode || !oldSha || !newSha) {
      throw new Error("Git history omitted required object metadata");
    }
    addObject(oldSha, oldMode, path);
    addObject(newSha, newMode, path);
  }

  return { blobPaths: mutablePaths, findings: [...findings.values()] };
}

function parseObjectIds(output: Uint8Array): readonly string[] {
  const ids = decode(output)
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split(" ", 1)[0]);
  if (ids.some((id) => !id || !OBJECT_ID.test(id))) {
    throw new Error("Git returned a malformed reachable object inventory");
  }
  return ids as readonly string[];
}

function parseObjectMetadata(
  output: Uint8Array,
  expected: ReadonlySet<string>,
): readonly ObjectMetadata[] {
  const metadata = decode(output)
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [sha, type, rawSize, extra] = line.split(" ");
      const size = Number(rawSize);
      if (
        !sha ||
        !OBJECT_ID.test(sha) ||
        !type ||
        !Number.isSafeInteger(size) ||
        size < 0 ||
        extra
      ) {
        throw new Error("Git object database returned invalid metadata");
      }
      return { sha, type, size };
    });

  if (metadata.length !== expected.size || metadata.some(({ sha }) => !expected.has(sha))) {
    throw new Error("Git object database returned an incomplete object inventory");
  }
  return metadata.sort((left, right) => left.sha.localeCompare(right.sha));
}

function readBatchObjects(
  output: Uint8Array,
  metadata: readonly ObjectMetadata[],
): ReadonlyMap<string, Uint8Array> {
  const objects = new Map<string, Uint8Array>();
  let offset = 0;

  for (const expected of metadata) {
    const newline = output.indexOf(10, offset);
    if (newline === -1) {
      throw new Error("Git object database returned an incomplete object header");
    }
    const header = decode(output.slice(offset, newline));
    const [sha, type, rawSize, extra] = header.split(" ");
    const size = Number(rawSize);
    if (sha !== expected.sha || type !== expected.type || size !== expected.size || extra) {
      throw new Error("Git object database returned an unexpected object header");
    }

    const contentStart = newline + 1;
    const contentEnd = contentStart + size;
    if (contentEnd >= output.length || output[contentEnd] !== 10) {
      throw new Error("Git object database returned truncated object bytes");
    }
    objects.set(sha, output.slice(contentStart, contentEnd));
    offset = contentEnd + 1;
  }

  if (offset !== output.length) {
    throw new Error("Git object database returned trailing unrequested bytes");
  }
  return objects;
}

export function renderPublicHistoryManifest(manifest: PublicHistoryManifest): string {
  const canonical = {
    objects: [...manifest.objects]
      .sort((left, right) => left.objectId.localeCompare(right.objectId))
      .map(({ objectId, size, type }) => ({ objectId, size, type })),
    refs: [...manifest.refs]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(({ name, objectId }) => ({ name, objectId })),
    schemaVersion: manifest.schemaVersion,
  };
  return JSON.stringify(canonical);
}

async function digestObjectManifest(manifest: PublicHistoryManifest): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(renderPublicHistoryManifest(manifest)),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function metadataPath(object: ObjectMetadata): string {
  return `metadata/${object.type === "tag" ? "tags" : "commits"}/${object.sha}.txt`;
}

export async function inspectReachableHistory(
  root: string,
  options: PublicHistoryOptions = {},
): Promise<PublicHistoryResult> {
  const authorizedRefNames = validateAuthorizedRefs(
    options.authorizedRefs ?? DEFAULT_AUTHORIZED_REFS,
  );
  const identityOptions: PublicBoundaryOptions =
    options.allowedEmails === undefined ? {} : { allowedEmails: options.allowedEmails };
  const refsResult = await runGit(
    ["for-each-ref", "--format=%(refname)%00%(objectname)%00%(objecttype)"],
    root,
  );
  if (refsResult.exitCode !== 0) {
    throw new Error("Unable to enumerate local refs");
  }
  const allRefs = parseRefs(refsResult.stdout);
  const allRefsByName = new Map(allRefs.map((ref) => [ref.name, ref]));
  const findings = new Map<string, PublicHistoryFinding>();

  function report(path: string, code: PublicHistoryCode): void {
    findings.set(`${path}\0${code}`, { path, code });
  }

  for (const [index, ref] of allRefs.entries()) {
    const refLabel = `metadata/refs/${index + 1}.txt`;
    for (const finding of inspectPublicTree(
      [{ path: refLabel, content: ref.name }],
      identityOptions,
    )) {
      report(finding.path, finding.code);
    }
    if (!authorizedRefNames.includes(ref.name)) {
      report(`metadata/refs/unexpected-${index + 1}.txt`, "unexpected-ref");
    }
  }
  for (const [index, refName] of authorizedRefNames.entries()) {
    if (!allRefsByName.has(refName)) {
      report(`metadata/refs/missing-${index + 1}.txt`, "missing-authorized-ref");
    }
  }

  const authorizedRefs = authorizedRefNames
    .map((refName) => allRefsByName.get(refName))
    .filter((ref): ref is GitRef => ref !== undefined);
  const refTips = authorizedRefs.map(({ objectId }) => objectId);
  if (refTips.length === 0) {
    throw new Error("Git repository has no reachable commit");
  }

  const commitCountResult = await runGit(["rev-list", "--count", ...refTips], root);
  const commitCount = Number(decode(commitCountResult.stdout).trim());
  if (commitCountResult.exitCode !== 0 || !Number.isSafeInteger(commitCount) || commitCount < 1) {
    throw new Error("Unable to count authorized reachable commits");
  }

  const rawHistory = await runGit(
    ["log", ...refTips, "--format=", "--raw", "--root", "--no-abbrev", "--no-renames", "-z"],
    root,
  );
  if (rawHistory.exitCode !== 0) {
    throw new Error("Unable to enumerate authorized reachable history");
  }
  const index = indexHistoricalPaths(rawHistory.stdout);
  for (const finding of index.findings) {
    report(finding.path, finding.code);
  }

  const objectsResult = await runGit(
    ["rev-list", "--objects", "--no-object-names", ...refTips],
    root,
  );
  if (objectsResult.exitCode !== 0) {
    throw new Error("Unable to enumerate every authorized reachable object");
  }
  const objectIds = new Set([...parseObjectIds(objectsResult.stdout), ...refTips]);
  const requestedObjects = `${[...objectIds].sort().join("\n")}\n`;
  const metadataResult = await runGit(["cat-file", "--batch-check"], root, requestedObjects);
  if (metadataResult.exitCode !== 0) {
    throw new Error("Unable to inspect reachable object metadata");
  }
  const metadata = parseObjectMetadata(metadataResult.stdout, objectIds);
  const refs = authorizedRefs.map(({ name, objectId }) => ({ name, objectId }));
  const manifest: PublicHistoryManifest = {
    schemaVersion: "libre-ai.git-object-manifest.v1",
    refs,
    objects: metadata.map(({ sha, type, size }) => ({ objectId: sha, type, size })),
  };
  const objectManifestSha256 = await digestObjectManifest(manifest);

  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxHistoryBytes = options.maxHistoryBytes ?? DEFAULT_MAX_HISTORY_BYTES;
  const readable: ObjectMetadata[] = [];
  let readableBytes = 0;

  for (const object of metadata) {
    if (!SUPPORTED_OBJECT_TYPES.has(object.type)) {
      report(`objects/${object.sha}`, "unexpected-object-type");
      continue;
    }
    if (object.type === "tree") {
      continue;
    }
    const paths = object.type === "blob" ? index.blobPaths.get(object.sha) : undefined;
    if (object.type === "blob" && !paths) {
      throw new Error("Reachable blob has no historical path");
    }
    if (object.size > maxFileBytes) {
      if (paths) {
        for (const path of paths) {
          report(path, "oversized-file");
        }
      } else {
        report(metadataPath(object), "oversized-file");
      }
      continue;
    }
    readableBytes += object.size;
    readable.push(object);
  }

  if (readableBytes > maxHistoryBytes) {
    report("<history>", "history-volume-exceeded");
  } else if (readable.length > 0) {
    const objectResult = await runGit(
      ["cat-file", "--batch"],
      root,
      `${readable.map(({ sha }) => sha).join("\n")}\n`,
    );
    if (objectResult.exitCode !== 0) {
      throw new Error("Unable to read reachable objects");
    }
    const objects = readBatchObjects(objectResult.stdout, readable);
    for (const object of readable) {
      const content = objects.get(object.sha);
      if (!content) {
        throw new Error("Reachable object content is incomplete");
      }
      const paths =
        object.type === "blob" ? index.blobPaths.get(object.sha) : new Set([metadataPath(object)]);
      if (!paths) {
        throw new Error("Reachable blob content has no historical path");
      }
      for (const path of paths) {
        const file: PublicFile = { path, content };
        for (const finding of inspectPublicTree([file], {
          ...identityOptions,
          maxFileBytes,
        })) {
          report(finding.path, finding.code);
        }
      }
    }
  }

  return {
    commitCount,
    blobCount: metadata.filter(({ type }) => type === "blob").length,
    objectCount: metadata.length,
    objectManifestSha256,
    refs,
    manifest,
    findings: [...findings.values()].sort(
      (left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code),
    ),
  };
}
