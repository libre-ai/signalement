import {
  compareUtf8,
  inspectPublicTree,
  type PublicBoundaryCode,
  type PublicBoundaryOptions,
  type PublicFile,
} from "./public-boundary";

export type PublicHistoryCode =
  | PublicBoundaryCode
  | "history-volume-exceeded"
  | "missing-authorized-ref"
  | "unapproved-identity"
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
  readonly allowedIdentities?: readonly PublicGitIdentity[];
  readonly authorizedRefs?: readonly string[];
  readonly maxHistoryBytes?: number;
}

export interface PublicGitIdentity {
  readonly name: string;
  readonly email: string;
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

interface GitHeader {
  readonly name: string;
  readonly value: string;
  readonly start: number;
  readonly end: number;
  readonly hasContinuation: boolean;
}

interface GitMetadataInspection {
  readonly approved: boolean;
  readonly contentForBoundary: string;
}

const DEFAULT_AUTHORIZED_REFS = ["refs/heads/main"] as const;
const LEGACY_PUBLIC_POLICY_BLOB = "19984c48369a07c55e9c131e33c88979c7ce23d0";
const DEFAULT_MAX_FILE_BYTES = 1_048_576;
const DEFAULT_MAX_HISTORY_BYTES = 67_108_864;
const OBJECT_ID = /^[0-9a-f]{40,64}$/;
const ZERO_OBJECT = /^0+$/;
const REGULAR_MODES = new Set(["100644", "100755"]);
const SUPPORTED_OBJECT_TYPES = new Set(["blob", "commit", "tag", "tree"]);
const RAW_HEADER = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) ([A-Z][0-9]*)$/;
const SAFE_REF = /^refs\/[A-Za-z0-9][^\s~^:?*\\[]*$/;
const GIT_HEADER = /^([a-z][a-z0-9-]*) (.*)$/;
const GIT_IDENTITY =
  /^(author|committer|tagger) ([^<>\r\n]+) <([^<>\r\n]+)> ((?:0|[1-9][0-9]*)) ([+-](?:(?:0[0-9]|1[0-3])[0-5][0-9]|1400))$/;
const TERMINAL_DCO = /^Signed-off-by: ([^<>\r\n]+) <([^<>\r\n]+)>$/;
// Git fsck parses into uintmax_t, then rejects values that cannot round-trip through time_t.
// The supported 64-bit Unix toolchain therefore admits at most signed time_t, not uint64 max.
const MAX_GIT_TIMESTAMP = 9_223_372_036_854_775_807n;
const MAX_GIT_TIMESTAMP_TEXT = MAX_GIT_TIMESTAMP.toString();
const COMMIT_RESERVED_HEADERS = new Set(["tree", "parent", "author", "committer", "tagger"]);

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
  return unique.sort(compareUtf8);
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
    .sort((left, right) => compareUtf8(left.name, right.name));
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
  return metadata.sort((left, right) => compareUtf8(left.sha, right.sha));
}

function matchesAllowedIdentity(
  identity: PublicGitIdentity,
  allowedIdentities: readonly PublicGitIdentity[],
): boolean {
  return allowedIdentities.some(
    (allowed) => allowed.name === identity.name && allowed.email === identity.email,
  );
}

function isValidTagName(value: string): boolean {
  if (value.length === 0) return false;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint <= 0x20 || codePoint === 0x7f) return false;
  }
  return true;
}

function isValidGitTimestamp(value: string): boolean {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) return false;
  if (value.length > MAX_GIT_TIMESTAMP_TEXT.length) return false;
  return BigInt(value) <= MAX_GIT_TIMESTAMP;
}

function parseHeaders(headerText: string): readonly GitHeader[] | null {
  const headers: GitHeader[] = [];
  let offset = 0;

  for (const line of headerText.split("\n")) {
    const start = offset;
    const end = start + line.length;
    offset = end + 1;
    if (line.startsWith(" ")) {
      const previous = headers.at(-1);
      if (!previous) return null;
      headers[headers.length - 1] = { ...previous, hasContinuation: true };
      continue;
    }
    const match = GIT_HEADER.exec(line);
    const name = match?.[1];
    const value = match?.[2];
    if (name === undefined || value === undefined) return null;
    headers.push({ name, value, start, end, hasContinuation: false });
  }

  return headers;
}

function replaceValidatedRanges(
  source: string,
  ranges: readonly { readonly start: number; readonly end: number; readonly label: string }[],
): string {
  let result = "";
  let offset = 0;
  for (const range of [...ranges].sort((left, right) => left.start - right.start)) {
    result += source.slice(offset, range.start);
    result += range.label;
    offset = range.end;
  }
  return result + source.slice(offset);
}

function hasSimpleHeader(
  header: GitHeader | undefined,
  name: string,
  validateValue: (value: string) => boolean,
): header is GitHeader {
  return (
    header !== undefined &&
    header.name === name &&
    !header.hasContinuation &&
    validateValue(header.value)
  );
}

function selectCommitIdentityHeaders(headers: readonly GitHeader[]): readonly GitHeader[] | null {
  if (!hasSimpleHeader(headers[0], "tree", (value) => OBJECT_ID.test(value))) return null;
  let index = 1;
  while (hasSimpleHeader(headers[index], "parent", (value) => OBJECT_ID.test(value))) {
    index += 1;
  }
  const author = headers[index];
  const committer = headers[index + 1];
  if (
    !hasSimpleHeader(author, "author", () => true) ||
    !hasSimpleHeader(committer, "committer", () => true)
  ) {
    return null;
  }
  const extensions = headers.slice(index + 2);
  if (extensions.some(({ name }) => COMMIT_RESERVED_HEADERS.has(name))) return null;
  return [author, committer];
}

function selectTagIdentityHeaders(headers: readonly GitHeader[]): readonly GitHeader[] | null {
  const object = headers[0];
  const type = headers[1];
  const tag = headers[2];
  const tagger = headers[3];
  if (
    !hasSimpleHeader(object, "object", (value) => OBJECT_ID.test(value)) ||
    !hasSimpleHeader(type, "type", (value) => SUPPORTED_OBJECT_TYPES.has(value)) ||
    !hasSimpleHeader(tag, "tag", isValidTagName) ||
    !hasSimpleHeader(tagger, "tagger", () => true)
  ) {
    return null;
  }

  // Annotated-tag signatures belong to the message body. Git fsck reports every header after
  // tagger as extraHeaderEntry, so such objects must never earn structural neutralization.
  if (headers.length !== 4) return null;
  return [tagger];
}

export function inspectGitMetadata(
  content: Uint8Array,
  objectType: "commit" | "tag",
  allowedIdentities: readonly PublicGitIdentity[],
): GitMetadataInspection {
  const source = decode(content);
  const separator = source.indexOf("\n\n");
  if (separator === -1) return { approved: false, contentForBoundary: source };
  const headers = parseHeaders(source.slice(0, separator));
  if (!headers) return { approved: false, contentForBoundary: source };

  const identityHeaders =
    objectType === "commit"
      ? selectCommitIdentityHeaders(headers)
      : selectTagIdentityHeaders(headers);
  if (!identityHeaders) return { approved: false, contentForBoundary: source };

  const validatedIdentities: PublicGitIdentity[] = [];
  const ranges: { start: number; end: number; label: string }[] = [];
  for (const header of identityHeaders) {
    const match = GIT_IDENTITY.exec(`${header.name} ${header.value}`);
    const name = match?.[2];
    const email = match?.[3];
    const timestamp = match?.[4];
    if (
      header.hasContinuation ||
      name === undefined ||
      email === undefined ||
      timestamp === undefined ||
      !isValidGitTimestamp(timestamp)
    ) {
      return { approved: false, contentForBoundary: source };
    }
    const identity = { name, email };
    if (!matchesAllowedIdentity(identity, allowedIdentities)) {
      return { approved: false, contentForBoundary: source };
    }
    validatedIdentities.push(identity);
    ranges.push({ start: header.start, end: header.end, label: `${header.name} <validated>` });
  }

  const messageStart = separator + 2;
  const message = source.slice(messageStart);
  const withoutFinalLf = message.endsWith("\n") ? message.slice(0, -1) : message;
  const messageLines = withoutFinalLf.split("\n");
  const terminalLine = messageLines.at(-1) ?? "";
  if (messageLines.filter((line) => line.startsWith("Signed-off-by:")).length !== 1) {
    return { approved: false, contentForBoundary: source };
  }
  const terminalMatch = TERMINAL_DCO.exec(terminalLine);
  const dcoName = terminalMatch?.[1];
  const dcoEmail = terminalMatch?.[2];
  if (dcoName === undefined || dcoEmail === undefined) {
    return { approved: false, contentForBoundary: source };
  }
  const dcoIdentity = { name: dcoName, email: dcoEmail };
  if (
    !matchesAllowedIdentity(dcoIdentity, allowedIdentities) ||
    !validatedIdentities.some(
      (identity) => identity.name === dcoIdentity.name && identity.email === dcoIdentity.email,
    )
  ) {
    return { approved: false, contentForBoundary: source };
  }
  const terminalStart = messageStart + withoutFinalLf.lastIndexOf(terminalLine);
  ranges.push({
    start: terminalStart,
    end: terminalStart + terminalLine.length,
    label: "Signed-off-by: <validated>",
  });
  return { approved: true, contentForBoundary: replaceValidatedRanges(source, ranges) };
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
      .sort((left, right) => compareUtf8(left.objectId, right.objectId))
      .map(({ objectId, size, type }) => ({ objectId, size, type })),
    refs: [...manifest.refs]
      .sort((left, right) => compareUtf8(left.name, right.name))
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
  const allowedIdentities = options.allowedIdentities ?? [];
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
    for (const finding of inspectPublicTree([{ path: refLabel, content: ref.name }])) {
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
      const metadataInspection =
        object.type === "commit" || object.type === "tag"
          ? inspectGitMetadata(content, object.type, allowedIdentities)
          : null;
      const paths =
        object.type === "blob" ? index.blobPaths.get(object.sha) : new Set([metadataPath(object)]);
      if (!paths) {
        throw new Error("Reachable blob content has no historical path");
      }
      if (metadataInspection !== null && !metadataInspection.approved) {
        report(metadataPath(object), "unapproved-identity");
      }
      for (const path of paths) {
        const file: PublicFile = {
          path,
          content: metadataInspection?.contentForBoundary ?? content,
          declaredByteLength: object.size,
        };
        // The root commit stored the approved attribution in this exact immutable blob.
        // A path-only exception would let a future policy revision bypass PII scanning.
        const permitsLegacyPolicyIdentity =
          object.sha === LEGACY_PUBLIC_POLICY_BLOB && path === "tools/ci/public-policy.ts";
        for (const finding of inspectPublicTree([file], { maxFileBytes })) {
          if (permitsLegacyPolicyIdentity && finding.code === "personal-email") continue;
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
      (left, right) => compareUtf8(left.path, right.path) || compareUtf8(left.code, right.code),
    ),
  };
}
