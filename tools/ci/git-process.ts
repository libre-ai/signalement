export const GIT_METADATA_STDOUT_LIMIT = 16 * 1024 * 1024;
export const GIT_BODY_BYTES_LIMIT = 64 * 1024 * 1024;

const MAX_GIT_PROCESS_STDOUT_BYTES = 80 * 1024 * 1024;
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const OBJECT_TYPES = new Set(["blob", "commit", "tag", "tree"]);
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface BoundedCommandResult {
  readonly exitCode: number;
  readonly stdout: Uint8Array;
}

export interface BoundedStdin {
  readonly data: Uint8Array;
  readonly maxBytes: number;
}

export interface RunGitBoundedOptions {
  readonly cwd: string;
  readonly maxStdoutBytes: number;
  readonly stdin?: BoundedStdin;
}

export type GitProcessErrorCode =
  | "invalid-bound"
  | "process-failure"
  | "stdin-overflow"
  | "stdout-overflow"
  | "stream-failure";

export class GitProcessError extends Error {
  readonly code: GitProcessErrorCode;

  constructor(code: GitProcessErrorCode) {
    super("Git process failed");
    this.name = "GitProcessError";
    this.code = code;
  }
}

export interface GitObjectMetadata {
  readonly objectId: string;
  readonly type: "blob" | "commit" | "tag" | "tree";
  readonly size: number;
}

function isValidBound(value: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

async function drain(stream: ReadableStream<Uint8Array>, terminate: () => void): Promise<void> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    reader = stream.getReader();
    while (!(await reader.read()).done) {
      // Discard diagnostics: they are untrusted and can contain paths, refs, or credentials.
    }
  } catch {
    terminate();
    throw new GitProcessError("stream-failure");
  } finally {
    reader?.releaseLock();
  }
}

async function collectBounded(
  stream: ReadableStream<Uint8Array>,
  capacity: number,
  terminate: () => void,
): Promise<Uint8Array> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let offset = 0;
  try {
    const buffer = new Uint8Array(capacity);
    reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > capacity - offset) {
        terminate();
        await reader.cancel().catch(() => undefined);
        throw new GitProcessError("stdout-overflow");
      }
      buffer.set(value, offset);
      offset += value.byteLength;
    }
    return buffer.subarray(0, offset);
  } catch (error) {
    terminate();
    if (error instanceof GitProcessError) throw error;
    throw new GitProcessError("stream-failure");
  } finally {
    reader?.releaseLock();
  }
}

export async function runGitBounded(
  arguments_: readonly string[],
  options: RunGitBoundedOptions,
): Promise<BoundedCommandResult> {
  if (!isValidBound(options.maxStdoutBytes, MAX_GIT_PROCESS_STDOUT_BYTES)) {
    throw new GitProcessError("invalid-bound");
  }
  if (
    options.stdin !== undefined &&
    (!isValidBound(options.stdin.maxBytes, GIT_METADATA_STDOUT_LIMIT) ||
      options.stdin.data.byteLength > options.stdin.maxBytes)
  ) {
    throw new GitProcessError("stdin-overflow");
  }

  let child: ReturnType<typeof Bun.spawn>;
  try {
    const stdin =
      options.stdin === undefined
        ? undefined
        : new Blob([Uint8Array.from(options.stdin.data).buffer]);
    child = Bun.spawn(["git", ...arguments_], {
      cwd: options.cwd,
      env: process.env,
      stdin,
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    throw new GitProcessError("process-failure");
  }

  const terminate = (): void => {
    try {
      child.kill("SIGKILL");
    } catch {
      // The child may already have exited; the original bounded failure remains authoritative.
    }
  };
  const stdoutPromise = collectBounded(
    child.stdout as ReadableStream<Uint8Array>,
    options.maxStdoutBytes,
    terminate,
  );
  const stderrPromise = drain(child.stderr as ReadableStream<Uint8Array>, terminate);
  const [exit, stdout, stderr] = await Promise.allSettled([
    child.exited,
    stdoutPromise,
    stderrPromise,
  ]);

  if (stdout.status === "rejected") {
    if (stdout.reason instanceof GitProcessError) throw stdout.reason;
    throw new GitProcessError("stream-failure");
  }
  if (stderr.status === "rejected") {
    terminate();
    throw new GitProcessError("stream-failure");
  }
  if (exit.status === "rejected") {
    throw new GitProcessError("process-failure");
  }
  return { exitCode: exit.value, stdout: stdout.value };
}

function invalidGitData(): never {
  throw new Error("Git data is invalid");
}

function validateRequestedObjectIds(objectIds: readonly string[]): ReadonlySet<string> {
  const requested = new Set(objectIds);
  const objectIdWidth = objectIds[0]?.length;
  if (
    requested.size !== objectIds.length ||
    objectIds.some((objectId) => !OBJECT_ID.test(objectId) || objectId.length !== objectIdWidth)
  ) {
    invalidGitData();
  }
  return requested;
}

export function parseBatchCheckOutput(
  output: Uint8Array,
  requestedObjectIds: readonly string[],
): readonly GitObjectMetadata[] {
  const requested = validateRequestedObjectIds(requestedObjectIds);
  if (requested.size === 0) {
    if (output.byteLength !== 0) invalidGitData();
    return [];
  }

  if (output.at(-1) !== 10) invalidGitData();
  let recordCount = 0;
  for (const byte of output) {
    if (byte === 10) recordCount += 1;
  }
  if (recordCount !== requested.size) invalidGitData();
  let source: string;
  try {
    source = decoder.decode(output);
  } catch {
    invalidGitData();
  }
  const records = source.slice(0, -1).split("\n");
  if (records.length !== requested.size) invalidGitData();

  const seen = new Set<string>();
  const metadata: GitObjectMetadata[] = [];
  for (const record of records) {
    const [objectId, type, rawSize, extra] = record.split(" ");
    const size = Number(rawSize);
    if (
      objectId === undefined ||
      !requested.has(objectId) ||
      seen.has(objectId) ||
      type === undefined ||
      !OBJECT_TYPES.has(type) ||
      rawSize === undefined ||
      !/^(?:0|[1-9][0-9]*)$/.test(rawSize) ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      extra !== undefined
    ) {
      invalidGitData();
    }
    seen.add(objectId);
    metadata.push({ objectId, type: type as GitObjectMetadata["type"], size });
  }
  if (seen.size !== requested.size) invalidGitData();
  return metadata.sort((left, right) => left.objectId.localeCompare(right.objectId));
}

function validateMetadata(metadata: readonly GitObjectMetadata[]): void {
  const seen = new Set<string>();
  const objectIdWidth = metadata[0]?.objectId.length;
  for (const object of metadata) {
    if (
      !OBJECT_ID.test(object.objectId) ||
      object.objectId.length !== objectIdWidth ||
      seen.has(object.objectId) ||
      !OBJECT_TYPES.has(object.type) ||
      !Number.isSafeInteger(object.size) ||
      object.size < 0
    ) {
      invalidGitData();
    }
    seen.add(object.objectId);
  }
}

export function batchOutputByteLength(metadata: readonly GitObjectMetadata[]): number {
  validateMetadata(metadata);
  let total = 0;
  for (const object of metadata) {
    const headerBytes =
      object.objectId.length + 1 + object.type.length + 1 + String(object.size).length;
    const framedBytes = headerBytes + 1 + object.size + 1;
    if (!Number.isSafeInteger(total + framedBytes)) invalidGitData();
    total += framedBytes;
  }
  if (total > MAX_GIT_PROCESS_STDOUT_BYTES) invalidGitData();
  return total;
}

export function parseBatchOutput(
  output: Uint8Array,
  metadata: readonly GitObjectMetadata[],
): ReadonlyMap<string, Uint8Array> {
  validateMetadata(metadata);
  if (output.byteLength !== batchOutputByteLength(metadata)) invalidGitData();

  const objects = new Map<string, Uint8Array>();
  let offset = 0;
  for (const expected of metadata) {
    const newline = output.indexOf(10, offset);
    if (newline === -1) invalidGitData();
    let header: string;
    try {
      header = decoder.decode(output.subarray(offset, newline));
    } catch {
      invalidGitData();
    }
    if (header !== `${expected.objectId} ${expected.type} ${expected.size}`) invalidGitData();

    const contentStart = newline + 1;
    const contentEnd = contentStart + expected.size;
    if (contentEnd >= output.byteLength || output[contentEnd] !== 10) invalidGitData();
    objects.set(expected.objectId, output.subarray(contentStart, contentEnd));
    offset = contentEnd + 1;
  }
  if (offset !== output.byteLength) invalidGitData();
  return objects;
}
