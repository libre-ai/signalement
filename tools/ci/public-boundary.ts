import {
  containsCredentialMarker,
  containsEmailIdentifier,
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
const SYNTHETIC_EMAIL_DOMAINS = new Set(["example.com", "example.net", "example.org"]);
const ASCII_ATEXT_OR_DOT = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]$/;
const ASCII_DOMAIN_CODE_POINT = /^[A-Za-z0-9_.-]$/;
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

function isReservedExampleDomain(domain: string): boolean {
  return (
    SYNTHETIC_EMAIL_DOMAINS.has(domain) ||
    domain.endsWith(".example") ||
    domain.endsWith(".invalid") ||
    domain.endsWith(".test")
  );
}

function isEmailBoundaryCodePoint(codePoint: number | undefined): boolean {
  if (codePoint === undefined) return false;
  if (codePoint >= 0x80) return true;
  return /[A-Za-z0-9!#$%&'*+/=?^_`{|}~.@-]/.test(String.fromCodePoint(codePoint));
}

interface ReservedEmailProjection {
  readonly masked: string;
  readonly containsMalformedReservedExample: boolean;
}

function hasCanonicalDotAtom(local: string): boolean {
  return (
    local.length > 0 &&
    local.length <= 64 &&
    !local.startsWith(".") &&
    !local.endsWith(".") &&
    !local.includes("..")
  );
}

function hasCanonicalDnsLabels(domain: string): boolean {
  return (
    domain.length <= 253 &&
    domain
      .split(".")
      .every(
        (label) => label.length <= 63 && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label),
      )
  );
}

function projectReservedEmails(value: string): ReservedEmailProjection {
  const masked: string[] = [];
  let copiedUntil = 0;
  let containsMalformedReservedExample = false;
  for (let at = value.indexOf("@"); at >= 0; at = value.indexOf("@", at + 1)) {
    let localStart = at;
    while (localStart > copiedUntil && ASCII_ATEXT_OR_DOT.test(value[localStart - 1] ?? "")) {
      localStart -= 1;
    }
    let domainEnd = at + 1;
    while (domainEnd < value.length && ASCII_DOMAIN_CODE_POINT.test(value[domainEnd] ?? "")) {
      domainEnd += 1;
    }
    const punctuationEnd = domainEnd;
    while (domainEnd > at + 1 && value[domainEnd - 1] === ".") {
      domainEnd -= 1;
    }
    const local = value.slice(localStart, at);
    const domain = value.slice(at + 1, domainEnd).toLowerCase();
    const previous = localStart === 0 ? undefined : value.codePointAt(localStart - 1);
    const next = value.codePointAt(punctuationEnd);
    const canonicalLocal = hasCanonicalDotAtom(local);
    const canonicalBoundary =
      !isEmailBoundaryCodePoint(previous) && !isEmailBoundaryCodePoint(next);
    if (!isReservedExampleDomain(domain) || !canonicalLocal || !canonicalBoundary) {
      continue;
    }
    if (!hasCanonicalDnsLabels(domain)) {
      containsMalformedReservedExample = true;
      continue;
    }
    // The scanner must still see every non-canonical form; this sentinel masks
    // only a validated RFC 2606 dot-atom example from the email-specific view.
    masked.push(value.slice(copiedUntil, localStart), "<rfc2606-example-email>");
    copiedUntil = domainEnd;
    at = punctuationEnd - 1;
  }
  if (copiedUntil > 0) masked.push(value.slice(copiedUntil));
  return {
    masked: copiedUntil === 0 ? value : masked.join(""),
    containsMalformedReservedExample,
  };
}

function inspectText(
  text: string,
  emailText: string = text,
  containsMalformedReservedExample = false,
): readonly PublicBoundaryCode[] {
  const codes = new Set<PublicBoundaryCode>();
  if (containsCredentialMarker(text)) {
    codes.add("captured-credential");
  }
  for (const rule of CONTENT_RULES) {
    if (rule.pattern.test(text)) {
      codes.add(rule.code);
    }
  }
  if (containsMalformedReservedExample || containsEmailIdentifier(emailText)) {
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
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    ) {
      return true;
    }
  }
  return false;
}

function projectEmailText(value: string): ReservedEmailProjection {
  const direct = projectReservedEmails(value);
  const normalized = normalizeSensitiveText(direct.masked);
  const decoded = projectReservedEmails(normalized);
  return {
    masked: normalized,
    containsMalformedReservedExample:
      direct.containsMalformedReservedExample || decoded.containsMalformedReservedExample,
  };
}

interface PathProjection {
  readonly canonical: string;
  readonly sensitive: string;
  readonly emailSensitive: string;
  readonly containsMalformedReservedExample: boolean;
  readonly containsDefaultIgnorable: boolean;
  readonly containsControlCodePoint: boolean;
}

function projectPath(path: string): PathProjection {
  const decoded = decodeSensitiveMarkers(path);
  const email = projectEmailText(path);
  return {
    canonical: normalizeUnicode(path),
    sensitive: normalizeUnicode(decoded),
    emailSensitive: email.masked,
    containsMalformedReservedExample: email.containsMalformedReservedExample,
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
    const pathCodes = inspectText(
      pathProjection.sensitive,
      pathProjection.emailSensitive,
      pathProjection.containsMalformedReservedExample,
    );
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

    const decoded = decodeText(file.content);
    if (decoded === null) {
      report(findingPath, "unclassified-binary");
      continue;
    }

    const normalized = normalizeSensitiveText(decoded);
    const email = projectEmailText(decoded);
    for (const code of inspectText(
      normalized,
      email.masked,
      email.containsMalformedReservedExample,
    )) {
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
