import {
  containsCredentialMarker,
  containsEmailIdentifierExcludingRfc2606Examples,
  decodeSensitiveMarkers,
} from "@libre-ai/governance/tools/quality/public-source-scanner";

export interface PublicFile {
  readonly path: string;
  readonly content: string | Uint8Array;
  readonly declaredByteLength?: number;
}

export type PublicBoundaryCode =
  | "captured-credential"
  | "captured-cookie"
  | "credential-url"
  | "duplicate-path"
  | "forbidden-artifact"
  | "instance-configuration"
  | "machine-local-path"
  | "oversized-file"
  | "personal-email"
  | "personal-iban"
  | "personal-phone"
  | "private-key"
  | "tree-volume-exceeded"
  | "unclassified-binary"
  | "unsafe-path";

export interface PublicBoundaryFinding {
  readonly path: string;
  readonly code: PublicBoundaryCode;
}

export interface PublicBoundaryOptions {
  readonly maxFileBytes?: number;
  readonly maxTreeBytes?: number;
}

export const DEFAULT_MAX_FILE_BYTES = 1_048_576;
export const DEFAULT_MAX_TREE_BYTES = 67_108_864;
const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;
const CONTAINS_DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/u;
const FORBIDDEN_ARTIFACT = /\.(?:har|webm|mp4|mov|png|jpe?g|gif|zip|7z|tar|gz)$/i;
const DATASET_ARTIFACT =
  /\.(?:arrow|avro|bak|csv|db|dump|eml|ics|jsonl|mbox|ndjson|ods|opml|parquet|sqlite3?|tsv|vcf|xlsx)$/i;
const DATASET_DIRECTORY = /(^|\/)(?:data|exports)\//i;
const SQL_ARTIFACT = /\.sql$/i;
const MIGRATION_SQL = /(^|\/)migrations\/[^/]+\.sql$/i;
const INSTANCE_CONFIGURATION =
  /(^|\/)(?:\.env(?!\.example$)(?:\.[^/]*)?|instances?\/|provider-instance(?:\.[^/]*)?$)/i;
const PHONE_FR = /(?:\+33[\s.-]?|(?<![\d.-])\b0)[1-9](?:[\s.-]?\d{2}){4}\b/;
const IBAN_FR = /\bFR\d{2}(?:\s?[A-Z0-9]{4}){5}\s?[A-Z0-9]{3}\b/i;

interface ContentRule {
  readonly code: PublicBoundaryCode;
  readonly pattern: RegExp;
}

const CONTENT_RULES: readonly ContentRule[] = [
  {
    code: "machine-local-path",
    pattern: /(?:\/Users\/(?!Shared(?:\/|\b))[^/\s]+|\/home\/[^/\s]+|[A-Z]:\\Users\\[^\\\s]+)/i,
  },
  {
    code: "captured-credential",
    pattern: /authori(?:zation)\s*:\s*(?:bearer|basic)\s+\S+/i,
  },
  {
    code: "captured-cookie",
    pattern: /(?:^|\n)\s*(?:set-)?cookie\s*:/i,
  },
  {
    code: "private-key",
    pattern: /-{5}begin(?: [a-z0-9]+)? private key-{5}/i,
  },
  {
    code: "credential-url",
    pattern: /https?:\/\/[^\s/:@]+:[^\s/@]+@/i,
  },
];

function byteLength(content: string | Uint8Array): number {
  return typeof content === "string"
    ? new TextEncoder().encode(content).byteLength
    : content.byteLength;
}

function publicFileByteLength(file: PublicFile): number {
  const measured = byteLength(file.content);
  const declared = file.declaredByteLength;
  if (declared === undefined) {
    return measured;
  }
  if (!Number.isSafeInteger(declared) || declared < 0) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.max(measured, declared);
}

export function compareUtf8(left: string, right: string): number {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

function decodeText(content: string | Uint8Array): string | null {
  if (typeof content === "string") {
    return content.includes("\0") ? null : content;
  }

  if (content.includes(0)) {
    return null;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return null;
  }
}

function hasUnsafePath(path: string): boolean {
  return (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((segment) => segment === ".." || segment === ".")
  );
}

function inspectText(text: string, rawEmailSource: string): readonly PublicBoundaryCode[] {
  const codes = new Set<PublicBoundaryCode>();
  if (containsCredentialMarker(text)) {
    codes.add("captured-credential");
  }
  for (const rule of CONTENT_RULES) {
    if (rule.pattern.test(text)) {
      codes.add(rule.code);
    }
  }
  if (containsEmailIdentifierExcludingRfc2606Examples(rawEmailSource)) {
    codes.add("personal-email");
  }
  if (PHONE_FR.test(text)) codes.add("personal-phone");
  if (IBAN_FR.test(text)) codes.add("personal-iban");
  return [...codes];
}

function normalizeUnicode(value: string): string {
  return value.normalize("NFKC").replace(DEFAULT_IGNORABLE, "");
}

function normalizeSensitiveText(value: string): string {
  return normalizeUnicode(decodeSensitiveMarkers(value));
}

function containsControlCodePoint(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1f ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        codePoint === 0x2028 ||
        codePoint === 0x2029)
    ) {
      return true;
    }
  }
  return false;
}

interface PathProjection {
  readonly canonical: string;
  readonly sensitive: string;
  readonly containsDefaultIgnorable: boolean;
  readonly containsControlCodePoint: boolean;
}

function projectPath(path: string): PathProjection {
  const decoded = decodeSensitiveMarkers(path);
  return {
    canonical: normalizeUnicode(path),
    sensitive: normalizeUnicode(decoded),
    containsDefaultIgnorable:
      CONTAINS_DEFAULT_IGNORABLE.test(path) || CONTAINS_DEFAULT_IGNORABLE.test(decoded),
    containsControlCodePoint: containsControlCodePoint(path) || containsControlCodePoint(decoded),
  };
}

function isForbiddenArtifact(canonicalPath: string, sensitivePath: string): boolean {
  const migrationSql = MIGRATION_SQL.test(canonicalPath) && MIGRATION_SQL.test(sensitivePath);
  return (
    FORBIDDEN_ARTIFACT.test(sensitivePath) ||
    DATASET_ARTIFACT.test(sensitivePath) ||
    DATASET_DIRECTORY.test(sensitivePath) ||
    ((SQL_ARTIFACT.test(canonicalPath) || SQL_ARTIFACT.test(sensitivePath)) && !migrationSql)
  );
}

export function inspectPublicTree(
  files: readonly PublicFile[],
  options: PublicBoundaryOptions = {},
): readonly PublicBoundaryFinding[] {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxTreeBytes = options.maxTreeBytes ?? DEFAULT_MAX_TREE_BYTES;
  const findings = new Map<string, PublicBoundaryFinding>();
  const paths = new Set<string>();
  let treeBytes = 0;
  let treeVolumeExceeded = false;

  function report(path: string, code: PublicBoundaryCode): void {
    findings.set(`${path}\0${code}`, { path, code });
  }

  for (const [index, file] of files.entries()) {
    const pathProjection = projectPath(file.path);
    const pathCodes = inspectText(pathProjection.sensitive, file.path);
    const findingPath =
      pathCodes.length > 0 ||
      pathProjection.containsDefaultIgnorable ||
      pathProjection.containsControlCodePoint
        ? `<redacted-path:${index + 1}>`
        : file.path;
    for (const code of pathCodes) {
      report(findingPath, code);
    }
    // Validate and de-duplicate the same canonical representation that humans and
    // cross-platform filesystems may display. Otherwise an ignorable or decomposed
    // code point can disguise traversal segments or a second logical path.
    if (
      pathProjection.containsDefaultIgnorable ||
      pathProjection.containsControlCodePoint ||
      hasUnsafePath(pathProjection.canonical) ||
      hasUnsafePath(pathProjection.sensitive)
    ) {
      report(findingPath, "unsafe-path");
      continue;
    }

    if (paths.has(pathProjection.canonical) || paths.has(pathProjection.sensitive)) {
      report(findingPath, "duplicate-path");
      continue;
    }
    paths.add(pathProjection.canonical);
    paths.add(pathProjection.sensitive);

    if (isForbiddenArtifact(pathProjection.canonical, pathProjection.sensitive)) {
      report(findingPath, "forbidden-artifact");
    }
    if (INSTANCE_CONFIGURATION.test(pathProjection.sensitive)) {
      report(findingPath, "instance-configuration");
    }
    const fileBytes = publicFileByteLength(file);
    if (fileBytes > maxTreeBytes - treeBytes) {
      treeVolumeExceeded = true;
    } else {
      treeBytes += fileBytes;
    }
    if (fileBytes > maxFileBytes) {
      report(findingPath, "oversized-file");
      continue;
    }

    const sourceText = decodeText(file.content);
    if (sourceText === null) {
      report(findingPath, "unclassified-binary");
      continue;
    }

    const normalized = normalizeSensitiveText(sourceText);
    for (const code of inspectText(normalized, sourceText)) {
      report(findingPath, code);
    }
  }

  if (treeVolumeExceeded) {
    report("<tree>", "tree-volume-exceeded");
  }

  return [...findings.values()].sort(
    (left, right) => compareUtf8(left.path, right.path) || compareUtf8(left.code, right.code),
  );
}
