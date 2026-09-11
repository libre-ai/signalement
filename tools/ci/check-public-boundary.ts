import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
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
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_TREE_BYTES,
  inspectPublicTree,
  type PublicFile,
} from "./public-boundary";

interface IndexEntry {
  readonly mode: string;
  readonly objectId: string;
  readonly path: string;
}

export interface IndexReadOptions {
  readonly maxFileBytes?: number;
  readonly maxIndexEntries?: number;
  readonly maxPathComponentBytes?: number;
  readonly maxTreeBytes?: number;
}

const MAX_INDEX_ENTRIES = 100_000;
const MAX_PATH_COMPONENT_BYTES = 4_096;
const INDEX_ENTRY = /^(100644|100755) ((?:[0-9a-f]{40}|[0-9a-f]{64})) 0\t(.+)$/s;

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

export function parseIndexEntries(
  output: Uint8Array,
  options: Pick<IndexReadOptions, "maxIndexEntries" | "maxPathComponentBytes"> = {},
): readonly IndexEntry[] {
  if (output.byteLength === 0) return [];
  if (output.at(-1) !== 0) invalidGitData();
  const maxIndexEntries = boundedPolicyValue(options.maxIndexEntries, MAX_INDEX_ENTRIES);
  const maxPathComponentBytes = boundedPolicyValue(
    options.maxPathComponentBytes,
    MAX_PATH_COMPONENT_BYTES,
  );
  let recordCount = 0;
  let recordStart = 0;
  for (let index = 0; index < output.byteLength; index += 1) {
    if (output[index] !== 0) continue;
    recordCount += 1;
    if (recordCount > maxIndexEntries) invalidGitData();
    const tab = output.indexOf(9, recordStart);
    if (
      tab === -1 ||
      tab >= index ||
      !pathBytesAreBounded(output, tab + 1, index, maxPathComponentBytes)
    ) {
      invalidGitData();
    }
    recordStart = index + 1;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(output);
  } catch {
    invalidGitData();
  }
  const entries: IndexEntry[] = [];
  let objectIdWidth: number | undefined;
  for (const record of text.slice(0, -1).split("\0")) {
    const match = INDEX_ENTRY.exec(record);
    const mode = match?.[1];
    const objectId = match?.[2];
    const path = match?.[3];
    if (
      mode === undefined ||
      objectId === undefined ||
      path === undefined ||
      (objectIdWidth !== undefined && objectId.length !== objectIdWidth)
    ) {
      invalidGitData();
    }
    objectIdWidth = objectId.length;
    entries.push({ mode, objectId, path });
  }
  return entries;
}

export async function readIndexFiles(
  root: string,
  options: IndexReadOptions = {},
): Promise<readonly PublicFile[]> {
  const listing = await runGitBounded(["ls-files", "--stage", "-z"], {
    cwd: root,
    maxStdoutBytes: GIT_METADATA_STDOUT_LIMIT,
  });
  if (listing.exitCode !== 0) {
    throw new Error("Unable to enumerate the Git index");
  }

  const entries = parseIndexEntries(listing.stdout, options);
  if (entries.length === 0) {
    throw new Error("Git index contains no files");
  }

  const objectIds = [...new Set(entries.map(({ objectId }) => objectId))].sort();
  const request = new TextEncoder().encode(`${objectIds.join("\n")}\n`);
  const metadataResult = await runGitBounded(["cat-file", "--batch-check"], {
    cwd: root,
    maxStdoutBytes: GIT_METADATA_STDOUT_LIMIT,
    stdin: { data: request, maxBytes: GIT_METADATA_STDOUT_LIMIT },
  });
  if (metadataResult.exitCode !== 0) {
    throw new Error("Unable to inspect Git index objects");
  }
  const metadata = parseBatchCheckOutput(metadataResult.stdout, objectIds);
  if (metadata.some(({ type }) => type !== "blob")) invalidGitData();
  const metadataByObject = new Map(metadata.map((object) => [object.objectId, object]));

  const maxFileBytes = boundedPolicyValue(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES);
  const maxTreeBytes = boundedPolicyValue(
    options.maxTreeBytes,
    Math.min(DEFAULT_MAX_TREE_BYTES, GIT_BODY_BYTES_LIMIT),
  );
  const admittedEntries = new Set<number>();
  const admittedObjectIds = new Set<string>();
  let loadedBytes = 0;
  let treeLimitReached = false;
  for (const [index, entry] of entries.entries()) {
    const metadata = metadataByObject.get(entry.objectId);
    if (metadata === undefined) invalidGitData();
    if (
      metadata.size > maxFileBytes ||
      treeLimitReached ||
      metadata.size > maxTreeBytes - loadedBytes
    ) {
      treeLimitReached ||= metadata.size > maxTreeBytes - loadedBytes;
      continue;
    }
    admittedEntries.add(index);
    admittedObjectIds.add(entry.objectId);
    loadedBytes += metadata.size;
  }

  const admittedMetadata = metadata.filter(({ objectId }) => admittedObjectIds.has(objectId));
  let contentByObject: ReadonlyMap<string, Uint8Array> = new Map();
  if (admittedMetadata.length > 0) {
    const bodyRequest = new TextEncoder().encode(
      `${admittedMetadata.map(({ objectId }) => objectId).join("\n")}\n`,
    );
    const bodiesResult = await runGitBounded(["cat-file", "--batch"], {
      cwd: root,
      maxStdoutBytes: batchOutputByteLength(admittedMetadata),
      stdin: { data: bodyRequest, maxBytes: GIT_METADATA_STDOUT_LIMIT },
    });
    if (bodiesResult.exitCode !== 0) {
      throw new Error("Unable to read Git index objects");
    }
    contentByObject = parseBatchOutput(bodiesResult.stdout, admittedMetadata);
  }

  return entries.map((entry, index) => {
    const metadata = metadataByObject.get(entry.objectId) as GitObjectMetadata | undefined;
    if (metadata === undefined) invalidGitData();
    if (!admittedEntries.has(index)) {
      return {
        path: entry.path,
        content: new Uint8Array(),
        declaredByteLength: metadata.size,
      };
    }
    const content = contentByObject.get(entry.objectId);
    if (content === undefined) invalidGitData();
    return { path: entry.path, content };
  });
}

export async function readCounterproofFile(path: string): Promise<PublicFile> {
  const label = basename(path);
  if (!label || label === "." || label === "..") {
    throw new Error("Counter-proof path must name one file");
  }
  const metadata = await stat(path);
  return metadata.size > DEFAULT_MAX_FILE_BYTES
    ? {
        path: `counterproof/${label}`,
        content: new Uint8Array(),
        declaredByteLength: metadata.size,
      }
    : {
        path: `counterproof/${label}`,
        content: new Uint8Array(await readFile(path)),
      };
}

async function main(): Promise<void> {
  const arguments_ = Bun.argv.slice(2);
  let files: readonly PublicFile[];

  if (arguments_.length === 0) {
    files = await readIndexFiles(process.cwd());
  } else if (arguments_.length === 2 && arguments_[0] === "--path" && arguments_[1]) {
    files = [await readCounterproofFile(arguments_[1])];
  } else {
    throw new Error("Usage: check-public-boundary.ts [--path <counterproof-file>]");
  }

  const findings = inspectPublicTree(files);
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`${finding.path}: ${finding.code}`);
    }
    throw new Error(`Public boundary rejected ${findings.length} finding(s)`);
  }

  console.log(`Public boundary verified: ${files.length} file(s), 0 findings`);
}

if (import.meta.main) {
  try {
    await main();
  } catch {
    console.error("Public boundary check failed");
    process.exitCode = 1;
  }
}
