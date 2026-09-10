export const REQUIRED_QUALIFICATION_KINDS = [
  "acceptance-catalog",
  "assumptions",
  "browser-matrix",
  "decision-lock",
  "product-scope",
  "provider-matrix",
  "risk-register",
  "threat-model",
] as const;

const SCHEMA_VERSION = "libre-ai.signalement.qualification.v1";
const ALLOWED_STATUSES = new Set(["verified", "assumed", "rejected", "unresolved"]);
const REQUIRED_KIND_SET = new Set<string>(REQUIRED_QUALIFICATION_KINDS);
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type QualificationFindingCode =
  | "duplicate-entry-id"
  | "duplicate-kind"
  | "empty-entries"
  | "invalid-document"
  | "invalid-entry"
  | "invalid-kind"
  | "invalid-schema"
  | "invalid-status"
  | "missing-kind"
  | "missing-source";

export interface QualificationFinding {
  readonly path: string;
  readonly code: QualificationFindingCode;
  readonly detail: string;
}

interface QualificationEntry {
  readonly id?: unknown;
  readonly status?: unknown;
  readonly statement?: unknown;
  readonly source?: unknown;
  readonly reopens_on?: unknown;
}

interface QualificationDocument {
  readonly schema_version?: unknown;
  readonly kind?: unknown;
  readonly entries?: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sourcePath(source: string): string {
  return source.split("#", 1)[0] ?? "";
}

export function validateQualificationDocuments(
  documents: ReadonlyMap<string, unknown>,
  availablePaths: ReadonlySet<string>,
): readonly QualificationFinding[] {
  const findings: QualificationFinding[] = [];
  const seenKinds = new Set<string>();

  function report(path: string, code: QualificationFindingCode, detail: string): void {
    findings.push({ path, code, detail });
  }

  for (const [path, unknownDocument] of [...documents].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (!isObject(unknownDocument)) {
      report(path, "invalid-document", "root");
      continue;
    }
    const document: QualificationDocument = unknownDocument;
    if (document.schema_version !== SCHEMA_VERSION) {
      report(path, "invalid-schema", String(document.schema_version ?? "missing"));
    }
    if (!isNonEmptyString(document.kind) || !REQUIRED_KIND_SET.has(document.kind)) {
      report(path, "invalid-kind", String(document.kind ?? "missing"));
      continue;
    }
    if (seenKinds.has(document.kind)) {
      report(path, "duplicate-kind", document.kind);
    }
    seenKinds.add(document.kind);

    if (!Array.isArray(document.entries)) {
      report(path, "invalid-document", "entries");
      continue;
    }
    if (document.entries.length === 0) {
      report(path, "empty-entries", document.kind);
    }

    const seenIds = new Set<string>();
    for (const unknownEntry of document.entries) {
      if (!isObject(unknownEntry)) {
        report(path, "invalid-entry", "non-object");
        continue;
      }
      const entry: QualificationEntry = unknownEntry;
      const id = isNonEmptyString(entry.id) ? entry.id : "missing";
      if (
        !SAFE_ID.test(id) ||
        !isNonEmptyString(entry.statement) ||
        !isNonEmptyString(entry.source) ||
        !isNonEmptyString(entry.reopens_on)
      ) {
        report(path, "invalid-entry", id);
      }
      if (seenIds.has(id)) {
        report(path, "duplicate-entry-id", id);
      }
      seenIds.add(id);
      if (!isNonEmptyString(entry.status) || !ALLOWED_STATUSES.has(entry.status)) {
        report(path, "invalid-status", id);
      }
      if (isNonEmptyString(entry.source)) {
        const resolvedSourcePath = sourcePath(entry.source);
        if (!availablePaths.has(resolvedSourcePath)) {
          report(path, "missing-source", resolvedSourcePath);
        }
      }
    }
  }

  for (const kind of REQUIRED_QUALIFICATION_KINDS) {
    if (!seenKinds.has(kind)) {
      report("<catalog>", "missing-kind", kind);
    }
  }

  return findings.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.code.localeCompare(right.code) ||
      left.detail.localeCompare(right.detail),
  );
}
