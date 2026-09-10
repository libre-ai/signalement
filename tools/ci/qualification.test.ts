import { describe, expect, test } from "bun:test";

import { REQUIRED_QUALIFICATION_KINDS, validateQualificationDocuments } from "./qualification";

function validDocuments(): ReadonlyMap<string, unknown> {
  return new Map(
    REQUIRED_QUALIFICATION_KINDS.map((kind) => [
      `qualification/${kind}.yaml`,
      {
        schema_version: "libre-ai.signalement.qualification.v1",
        kind,
        entries: [
          {
            id: `${kind}-entry`,
            status: "unresolved",
            statement: "Explicit statement",
            source: "README.md",
            reopens_on: "A named change",
          },
        ],
      },
    ]),
  );
}

describe("validateQualificationDocuments", () => {
  test("accepts one complete document per required kind", () => {
    expect(validateQualificationDocuments(validDocuments(), new Set(["README.md"]))).toEqual([]);
  });

  test("rejects missing and duplicated kinds", () => {
    const documents = new Map(validDocuments());
    documents.delete("qualification/risk-register.yaml");
    documents.set("qualification/duplicate.yaml", {
      schema_version: "libre-ai.signalement.qualification.v1",
      kind: "product-scope",
      entries: [],
    });

    expect(validateQualificationDocuments(documents, new Set(["README.md"]))).toEqual(
      expect.arrayContaining([
        { path: "<catalog>", code: "missing-kind", detail: "risk-register" },
        {
          path: "qualification/product-scope.yaml",
          code: "duplicate-kind",
          detail: "product-scope",
        },
      ]),
    );
  });

  test("rejects an unknown status and duplicate entry id", () => {
    const documents = new Map(validDocuments());
    documents.set("qualification/product-scope.yaml", {
      schema_version: "libre-ai.signalement.qualification.v1",
      kind: "product-scope",
      entries: [
        {
          id: "same",
          status: "operational",
          statement: "First",
          source: "README.md",
          reopens_on: "Change",
        },
        {
          id: "same",
          status: "verified",
          statement: "Second",
          source: "README.md",
          reopens_on: "Change",
        },
      ],
    });

    const findings = validateQualificationDocuments(documents, new Set(["README.md"]));

    expect(findings).toContainEqual({
      path: "qualification/product-scope.yaml",
      code: "invalid-status",
      detail: "same",
    });
    expect(findings).toContainEqual({
      path: "qualification/product-scope.yaml",
      code: "duplicate-entry-id",
      detail: "same",
    });
  });

  test("rejects an unresolved local source path", () => {
    const documents = new Map(validDocuments());
    const document = documents.get("qualification/assumptions.yaml") as {
      entries: Array<Record<string, string>>;
    };
    document.entries[0] = { ...document.entries[0], source: "missing.md#claim" };

    expect(validateQualificationDocuments(documents, new Set(["README.md"]))).toContainEqual({
      path: "qualification/assumptions.yaml",
      code: "missing-source",
      detail: "missing.md",
    });
  });

  test("rejects malformed documents and empty required text", () => {
    const documents = new Map(validDocuments());
    documents.set("qualification/browser-matrix.yaml", {
      schema_version: "wrong",
      kind: "browser-matrix",
      entries: [
        {
          id: "browser",
          status: "unresolved",
          statement: "",
          source: "README.md",
          reopens_on: "Change",
        },
      ],
    });

    const findings = validateQualificationDocuments(documents, new Set(["README.md"]));

    expect(findings).toEqual(
      expect.arrayContaining([
        {
          path: "qualification/browser-matrix.yaml",
          code: "invalid-schema",
          detail: "wrong",
        },
        {
          path: "qualification/browser-matrix.yaml",
          code: "invalid-entry",
          detail: "browser",
        },
      ]),
    );
  });
});
