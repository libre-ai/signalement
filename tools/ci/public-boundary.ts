export interface PublicFile {
  readonly path: string;
  readonly content: string | Uint8Array;
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
  | "private-key"
  | "unclassified-binary"
  | "unsafe-path";

export interface PublicBoundaryFinding {
  readonly path: string;
  readonly code: PublicBoundaryCode;
}

export interface PublicBoundaryOptions {
  readonly allowedEmails?: readonly string[];
  readonly maxFileBytes?: number;
}

const DEFAULT_MAX_FILE_BYTES = 1_048_576;
const DEFAULT_IGNORABLE =
  /(?:\u00AD|\u034F|\u061C|\u115F|\u1160|\u17B4|\u17B5|[\u180B-\u180F]|[\u200B-\u200F]|[\u202A-\u202E]|[\u2060-\u206F]|\u3164|[\uFE00-\uFE0F]|\uFEFF|\uFFA0)/gu;
const FORBIDDEN_ARTIFACT = /\.(?:har|webm|mp4|mov|png|jpe?g|gif|zip|7z|tar|gz)$/i;
const INSTANCE_CONFIGURATION =
  /(^|\/)(?:\.env(?!\.example$)(?:\.[^/]*)?|instances?\/|provider-instance(?:\.[^/]*)?$)/i;
const EMAIL = /\b[A-Z0-9._%+-]+@(?:[A-Z0-9-]+\.)+[A-Z]{2,}\b/gi;
const SYNTHETIC_EMAIL_DOMAINS = new Set(["example.com", "example.net", "example.org"]);

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

function isSyntheticEmail(email: string): boolean {
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  return (
    SYNTHETIC_EMAIL_DOMAINS.has(domain) ||
    domain.endsWith(".example") ||
    domain.endsWith(".invalid") ||
    domain.endsWith(".test")
  );
}

function inspectText(
  text: string,
  allowedEmails: ReadonlySet<string>,
): readonly PublicBoundaryCode[] {
  const codes = new Set<PublicBoundaryCode>();
  for (const rule of CONTENT_RULES) {
    if (rule.pattern.test(text)) {
      codes.add(rule.code);
    }
  }

  EMAIL.lastIndex = 0;
  for (const match of text.matchAll(EMAIL)) {
    const email = match[0];
    if (!isSyntheticEmail(email) && !allowedEmails.has(email.toLowerCase())) {
      codes.add("personal-email");
    }
  }
  return [...codes];
}

export function inspectPublicTree(
  files: readonly PublicFile[],
  options: PublicBoundaryOptions = {},
): readonly PublicBoundaryFinding[] {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const allowedEmails = new Set((options.allowedEmails ?? []).map((email) => email.toLowerCase()));
  const findings = new Map<string, PublicBoundaryFinding>();
  const paths = new Set<string>();

  function report(path: string, code: PublicBoundaryCode): void {
    findings.set(`${path}\0${code}`, { path, code });
  }

  for (const [index, file] of files.entries()) {
    const normalizedPath = file.path.normalize("NFKC").replace(DEFAULT_IGNORABLE, "");
    const pathCodes = inspectText(normalizedPath, allowedEmails);
    const findingPath = pathCodes.length > 0 ? `<redacted-path:${index + 1}>` : file.path;
    for (const code of pathCodes) {
      report(findingPath, code);
    }
    // Validate and de-duplicate the same canonical representation that humans and
    // cross-platform filesystems may display. Otherwise an ignorable or decomposed
    // code point can disguise traversal segments or a second logical path.
    if (hasUnsafePath(normalizedPath)) {
      report(findingPath, "unsafe-path");
      continue;
    }

    if (paths.has(normalizedPath)) {
      report(findingPath, "duplicate-path");
      continue;
    }
    paths.add(normalizedPath);

    if (FORBIDDEN_ARTIFACT.test(file.path)) {
      report(findingPath, "forbidden-artifact");
    }
    if (INSTANCE_CONFIGURATION.test(file.path)) {
      report(findingPath, "instance-configuration");
    }
    if (byteLength(file.content) > maxFileBytes) {
      report(findingPath, "oversized-file");
      continue;
    }

    const decoded = decodeText(file.content);
    if (decoded === null) {
      report(findingPath, "unclassified-binary");
      continue;
    }

    const normalized = decoded.normalize("NFKC").replace(DEFAULT_IGNORABLE, "");
    for (const code of inspectText(normalized, allowedEmails)) {
      report(findingPath, code);
    }
  }

  return [...findings.values()].sort(
    (left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code),
  );
}
