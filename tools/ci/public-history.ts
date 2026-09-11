import {
  batchOutputByteLength,
  GIT_BODY_BYTES_LIMIT,
  GIT_METADATA_STDOUT_LIMIT,
  type GitObjectMetadata,
  parseBatchCheckOutput,
  parseBatchOutput,
  runGitBounded,
} from "./git-process";
import {
  compareUtf8,
  inspectPublicTree,
  type PublicBoundaryCode,
  type PublicBoundaryOptions,
  type PublicFile,
} from "./public-boundary";

export type PublicHistoryCode =
  | PublicBoundaryCode
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
  readonly type: GitObjectMetadata["type"];
  readonly size: number;
}

export interface PublicGitTreeEntry {
  readonly treeObjectId: string;
  readonly name: string;
  readonly mode: "040000" | "100644" | "100755" | "120000" | "160000";
  readonly type: "blob" | "commit" | "tree";
  readonly objectId: string;
}

export interface PublicHistoryManifest {
  readonly gitObjectFormat: "sha1";
  readonly repository: "libre-ai/signalement";
  readonly schemaVersion: "libre-ai.git-object-manifest.v2";
  readonly refs: readonly PublicGitRef[];
  readonly objects: readonly PublicGitObject[];
  readonly treeEntries: readonly PublicGitTreeEntry[];
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
  readonly maxCommits?: number;
  readonly maxHistoryBytes?: number;
  readonly maxObjects?: number;
  readonly maxPathComponentBytes?: number;
  readonly maxRefs?: number;
  readonly maxTreeEntries?: number;
}

export interface PublicGitIdentity {
  readonly name: string;
  readonly email: string;
}

interface HistoricalIndex {
  readonly blobPaths: ReadonlyMap<string, ReadonlySet<string>>;
  readonly findings: readonly PublicHistoryFinding[];
}

interface GitRef extends PublicGitRef {
  readonly objectType: string;
}

interface ObjectMetadata extends GitObjectMetadata {
  readonly sha: string;
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
const MAX_COMMITS = 50_000;
const MAX_OBJECTS = 100_000;
const MAX_PATH_COMPONENT_BYTES = 4_096;
const MAX_REFS = 1_024;
const MAX_TREE_ENTRIES = 100_000;
const HEX_BYTES = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, "0"));
const OBJECT_ID = /^[0-9a-f]{40}$/;
const ZERO_OBJECT = /^0+$/;
const REGULAR_MODES = new Set(["100644", "100755"]);
const SUPPORTED_OBJECT_TYPES = new Set(["blob", "commit", "tag", "tree"]);
const RAW_HEADER = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z][0-9]*)$/;
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
const TREE_MODES = new Map<
  string,
  { readonly mode: PublicGitTreeEntry["mode"]; readonly type: PublicGitTreeEntry["type"] }
>([
  ["40000", { mode: "040000", type: "tree" }],
  ["100644", { mode: "100644", type: "blob" }],
  ["100755", { mode: "100755", type: "blob" }],
  ["120000", { mode: "120000", type: "blob" }],
  ["160000", { mode: "160000", type: "commit" }],
]);

function decode(output: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(output);
}

function invalidGitData(): never {
  throw new Error("Git data is invalid");
}

function boundedPolicyValue(value: number | undefined, maximum: number): number {
  const resolved = value ?? maximum;
  if (!Number.isSafeInteger(resolved) || resolved < 0 || resolved > maximum) invalidGitData();
  return resolved;
}

function pathBytesAreBounded(
  output: Uint8Array,
  start: number,
  end: number,
  maximumBytes: number,
): boolean {
  if (start === end) return false;
  let componentBytes = 0;
  for (let index = start; index < end; index += 1) {
    if (output[index] === 47) {
      if (componentBytes === 0) return false;
      componentBytes = 0;
      continue;
    }
    componentBytes += 1;
    if (componentBytes > maximumBytes) return false;
  }
  return componentBytes > 0;
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

function parseRefs(output: Uint8Array, maxRefs: number): readonly GitRef[] {
  if (output.byteLength === 0) return [];
  if (output.at(-1) !== 10) invalidGitData();
  let recordCount = 0;
  for (const byte of output) {
    if (byte === 10) recordCount += 1;
    if (recordCount > maxRefs) invalidGitData();
  }
  const records = decode(output.subarray(0, -1)).split("\n");
  let objectIdWidth: number | undefined;
  return records
    .map((line) => {
      const [name, objectId, objectType, extra] = line.split("\0");
      if (
        !name ||
        !SAFE_REF.test(name) ||
        !objectId ||
        !OBJECT_ID.test(objectId) ||
        !objectType ||
        !SUPPORTED_OBJECT_TYPES.has(objectType) ||
        (objectIdWidth !== undefined && objectId.length !== objectIdWidth) ||
        extra !== undefined
      ) {
        throw new Error("Git returned malformed local ref metadata");
      }
      objectIdWidth = objectId.length;
      return { name, objectId, objectType };
    })
    .sort((left, right) => compareUtf8(left.name, right.name));
}

function indexHistoricalPaths(output: Uint8Array, maxPathComponentBytes: number): HistoricalIndex {
  if (output.byteLength > 0 && output.at(-1) !== 0) invalidGitData();
  let fieldStart = 0;
  let fieldCount = 0;
  for (let index = 0; index < output.byteLength; index += 1) {
    if (output[index] !== 0) continue;
    if (
      fieldCount % 2 === 1 &&
      !pathBytesAreBounded(output, fieldStart, index, maxPathComponentBytes)
    ) {
      invalidGitData();
    }
    fieldCount += 1;
    fieldStart = index + 1;
  }
  if (fieldCount % 2 !== 0) invalidGitData();
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

function parseObjectIds(output: Uint8Array, maxObjects: number): readonly string[] {
  if (output.byteLength === 0 || output.at(-1) !== 10) invalidGitData();
  let recordCount = 0;
  for (const byte of output) {
    if (byte === 10) recordCount += 1;
    if (recordCount > maxObjects) invalidGitData();
  }
  if (recordCount === 0) invalidGitData();
  const records = decode(output.subarray(0, -1)).split("\n");
  const ids = records.map((record) => {
    const [objectId, extra] = record.split(" ");
    if (objectId === undefined || !OBJECT_ID.test(objectId) || extra !== undefined) {
      invalidGitData();
    }
    return objectId;
  });
  if (new Set(ids).size !== ids.length) invalidGitData();
  return ids;
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

export function renderPublicHistoryManifest(manifest: PublicHistoryManifest): string {
  const canonical = {
    gitObjectFormat: manifest.gitObjectFormat,
    objects: [...manifest.objects]
      .sort((left, right) => compareUtf8(left.objectId, right.objectId))
      .map(({ objectId, size, type }) => ({ objectId, size, type })),
    repository: manifest.repository,
    refs: [...manifest.refs]
      .sort(
        (left, right) =>
          compareUtf8(left.name, right.name) || compareUtf8(left.objectId, right.objectId),
      )
      .map(({ name, objectId }) => ({ name, objectId })),
    schemaVersion: manifest.schemaVersion,
    treeEntries: [...manifest.treeEntries]
      .sort(
        (left, right) =>
          compareUtf8(left.treeObjectId, right.treeObjectId) ||
          compareUtf8(left.name, right.name) ||
          compareUtf8(left.mode, right.mode) ||
          compareUtf8(left.type, right.type) ||
          compareUtf8(left.objectId, right.objectId),
      )
      .map(({ mode, name, objectId, treeObjectId, type }) => ({
        mode,
        name,
        objectId,
        treeObjectId,
        type,
      })),
  };
  return JSON.stringify(canonical);
}

function compareGitTreeEntryNames(
  left: Uint8Array,
  leftIsTree: boolean,
  right: Uint8Array,
  rightIsTree: boolean,
): number {
  const commonLength = Math.min(left.byteLength, right.byteLength);
  for (let index = 0; index < commonLength; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  const leftTerminator =
    left.byteLength === commonLength ? (leftIsTree ? 47 : 0) : left[commonLength];
  const rightTerminator =
    right.byteLength === commonLength ? (rightIsTree ? 47 : 0) : right[commonLength];
  return (leftTerminator ?? 0) - (rightTerminator ?? 0);
}

function isDotGitAlias(name: string): boolean {
  const asciiLower = name
    .normalize("NFKC")
    .replace(/[A-Z]/g, (character) => character.toLowerCase());
  const withoutTrailingSpaceOrPeriod = asciiLower.replace(/[ .]+$/u, "");
  return (
    withoutTrailingSpaceOrPeriod === ".git" ||
    /^\.git~[1-9][0-9]*$/u.test(withoutTrailingSpaceOrPeriod) ||
    asciiLower.startsWith(".git:")
  );
}

export function parseRawGitTree(
  content: Uint8Array,
  treeObjectId: string,
  objectTypes: ReadonlyMap<string, GitObjectMetadata["type"]>,
  options: {
    readonly maxEntries?: number;
    readonly maxPathComponentBytes?: number;
  } = {},
): readonly PublicGitTreeEntry[] {
  if (!OBJECT_ID.test(treeObjectId)) invalidGitData();
  const maxEntries = boundedPolicyValue(options.maxEntries, MAX_TREE_ENTRIES);
  const maxPathComponentBytes = boundedPolicyValue(
    options.maxPathComponentBytes,
    MAX_PATH_COMPONENT_BYTES,
  );
  const entries: PublicGitTreeEntry[] = [];
  const names = new Set<string>();
  let previousNameBytes: Uint8Array | undefined;
  let previousWasTree = false;
  let offset = 0;
  while (offset < content.byteLength) {
    if (entries.length >= maxEntries) invalidGitData();
    const space = content.indexOf(32, offset);
    const nul = content.indexOf(0, space + 1);
    if (
      space <= offset ||
      nul <= space + 1 ||
      nul + 21 > content.byteLength ||
      nul - (space + 1) > maxPathComponentBytes
    ) {
      invalidGitData();
    }
    let rawMode: string;
    try {
      rawMode = decode(content.subarray(offset, space));
    } catch {
      invalidGitData();
    }
    const mapping = TREE_MODES.get(rawMode);
    if (!mapping) invalidGitData();
    const nameBytes = content.subarray(space + 1, nul);
    let name: string;
    try {
      name = decode(nameBytes);
    } catch {
      invalidGitData();
    }
    if (
      name === "." ||
      name === ".." ||
      name.includes("/") ||
      isDotGitAlias(name) ||
      names.has(name) ||
      inspectPublicTree([{ path: name, content: "" }]).some(({ code }) => code === "unsafe-path")
    ) {
      invalidGitData();
    }
    let objectId = "";
    for (let index = nul + 1; index < nul + 21; index += 1) {
      objectId += HEX_BYTES[content[index] ?? 0] ?? "";
    }
    if (objectTypes.get(objectId) !== mapping.type) invalidGitData();
    if (
      previousNameBytes !== undefined &&
      compareGitTreeEntryNames(
        previousNameBytes,
        previousWasTree,
        nameBytes,
        mapping.type === "tree",
      ) >= 0
    ) {
      invalidGitData();
    }
    names.add(name);
    entries.push({ ...mapping, name, objectId, treeObjectId });
    previousNameBytes = nameBytes;
    previousWasTree = mapping.type === "tree";
    offset = nul + 21;
  }
  return entries;
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
  const maxRefs = boundedPolicyValue(options.maxRefs, MAX_REFS);
  const maxCommits = boundedPolicyValue(options.maxCommits, MAX_COMMITS);
  const maxObjects = boundedPolicyValue(options.maxObjects, MAX_OBJECTS);
  const maxTreeEntries = boundedPolicyValue(options.maxTreeEntries, MAX_TREE_ENTRIES);
  const maxPathComponentBytes = boundedPolicyValue(
    options.maxPathComponentBytes,
    MAX_PATH_COMPONENT_BYTES,
  );
  const requestedAuthorizedRefs = options.authorizedRefs ?? DEFAULT_AUTHORIZED_REFS;
  if (requestedAuthorizedRefs.length > maxRefs) invalidGitData();
  const authorizedRefNames = validateAuthorizedRefs(requestedAuthorizedRefs);
  const allowedIdentities = options.allowedIdentities ?? [];
  const objectFormatResult = await runGitBounded(["rev-parse", "--show-object-format"], {
    cwd: root,
    maxStdoutBytes: GIT_METADATA_STDOUT_LIMIT,
  });
  if (objectFormatResult.exitCode !== 0 || decode(objectFormatResult.stdout) !== "sha1\n") {
    throw new Error("Unsupported Git object format");
  }
  const refsResult = await runGitBounded(
    ["for-each-ref", "--format=%(refname)%00%(objectname)%00%(objecttype)"],
    { cwd: root, maxStdoutBytes: GIT_METADATA_STDOUT_LIMIT },
  );
  if (refsResult.exitCode !== 0) {
    throw new Error("Unable to enumerate local refs");
  }
  const allRefs = parseRefs(refsResult.stdout, maxRefs);
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

  const commitCountResult = await runGitBounded(["rev-list", "--count", ...refTips], {
    cwd: root,
    maxStdoutBytes: GIT_METADATA_STDOUT_LIMIT,
  });
  const rawCommitCount = decode(commitCountResult.stdout).trim();
  const commitCount = Number(rawCommitCount);
  if (
    commitCountResult.exitCode !== 0 ||
    !/^[1-9][0-9]*$/.test(rawCommitCount) ||
    !Number.isSafeInteger(commitCount)
  ) {
    throw new Error("Unable to count authorized reachable commits");
  }
  if (commitCount > maxCommits) invalidGitData();

  const rawHistory = await runGitBounded(
    ["log", ...refTips, "--format=", "--raw", "--root", "--no-abbrev", "--no-renames", "-z"],
    { cwd: root, maxStdoutBytes: GIT_METADATA_STDOUT_LIMIT },
  );
  if (rawHistory.exitCode !== 0) {
    throw new Error("Unable to enumerate authorized reachable history");
  }
  const index = indexHistoricalPaths(rawHistory.stdout, maxPathComponentBytes);
  for (const finding of index.findings) {
    report(finding.path, finding.code);
  }

  const objectsResult = await runGitBounded(
    ["rev-list", "--objects", "--no-object-names", ...refTips],
    { cwd: root, maxStdoutBytes: GIT_METADATA_STDOUT_LIMIT },
  );
  if (objectsResult.exitCode !== 0) {
    throw new Error("Unable to enumerate every authorized reachable object");
  }
  const objectIds = new Set([...parseObjectIds(objectsResult.stdout, maxObjects), ...refTips]);
  if (objectIds.size > maxObjects) invalidGitData();
  const requestedObjectIds = [...objectIds].sort();
  const requestedObjects = new TextEncoder().encode(`${requestedObjectIds.join("\n")}\n`);
  const metadataResult = await runGitBounded(["cat-file", "--batch-check"], {
    cwd: root,
    maxStdoutBytes: GIT_METADATA_STDOUT_LIMIT,
    stdin: { data: requestedObjects, maxBytes: GIT_METADATA_STDOUT_LIMIT },
  });
  if (metadataResult.exitCode !== 0) {
    throw new Error("Unable to inspect reachable object metadata");
  }
  const metadata: readonly ObjectMetadata[] = parseBatchCheckOutput(
    metadataResult.stdout,
    requestedObjectIds,
  ).map((object) => ({ ...object, sha: object.objectId }));
  const refs = authorizedRefs.map(({ name, objectId }) => ({ name, objectId }));

  const maxFileBytes = boundedPolicyValue(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES);
  const maxHistoryBytes = boundedPolicyValue(
    options.maxHistoryBytes,
    Math.min(DEFAULT_MAX_HISTORY_BYTES, GIT_BODY_BYTES_LIMIT),
  );
  const readable: ObjectMetadata[] = [];
  let readableBytes = 0;

  for (const object of metadata) {
    if (!SUPPORTED_OBJECT_TYPES.has(object.type)) {
      report(`objects/${object.sha}`, "unexpected-object-type");
      continue;
    }
    if (object.type === "tree") {
      if (object.size > maxFileBytes) invalidGitData();
      if (object.size > maxHistoryBytes - readableBytes) invalidGitData();
      readableBytes += object.size;
      readable.push(object);
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
    if (object.size > maxHistoryBytes - readableBytes) invalidGitData();
    readableBytes += object.size;
    readable.push(object);
  }

  if (readable.length > 0) {
    const bodyRequest = new TextEncoder().encode(
      `${readable.map(({ objectId }) => objectId).join("\n")}\n`,
    );
    const objectResult = await runGitBounded(["cat-file", "--batch"], {
      cwd: root,
      maxStdoutBytes: batchOutputByteLength(readable),
      stdin: { data: bodyRequest, maxBytes: GIT_METADATA_STDOUT_LIMIT },
    });
    if (objectResult.exitCode !== 0) {
      throw new Error("Unable to read reachable objects");
    }
    const objects = parseBatchOutput(objectResult.stdout, readable);
    const objectTypes = new Map(metadata.map(({ objectId, type }) => [objectId, type]));
    const treeEntries: PublicGitTreeEntry[] = [];
    for (const object of readable) {
      if (object.type !== "tree") continue;
      const content = objects.get(object.objectId);
      if (!content) invalidGitData();
      const entries = parseRawGitTree(content, object.objectId, objectTypes, {
        maxEntries: maxTreeEntries - treeEntries.length,
        maxPathComponentBytes,
      });
      treeEntries.push(...entries);
    }
    const manifest: PublicHistoryManifest = {
      gitObjectFormat: "sha1",
      objects: metadata.map(({ sha, type, size }) => ({ objectId: sha, type, size })),
      repository: "libre-ai/signalement",
      refs,
      schemaVersion: "libre-ai.git-object-manifest.v2",
      treeEntries,
    };
    const objectManifestSha256 = await digestObjectManifest(manifest);
    for (const object of readable) {
      if (object.type === "tree") continue;
      const content = objects.get(object.objectId);
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
  invalidGitData();
}
