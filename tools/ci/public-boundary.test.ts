import { describe, expect, test } from "bun:test";

import { inspectPublicTree } from "./public-boundary";

describe("inspectPublicTree", () => {
  test("rejects a captured authorization header without echoing it", () => {
    const capturedHeader = ["Author", "ization: ", "Bear", "er signalement_test_token_7f03"].join(
      "",
    );

    const findings = inspectPublicTree([{ path: "fixtures/report.json", content: capturedHeader }]);

    expect(findings).toEqual([{ path: "fixtures/report.json", code: "captured-credential" }]);
    expect(JSON.stringify(findings)).not.toContain("signalement_test_token_7f03");
  });

  test("normalizes default-ignorable characters before credential checks", () => {
    const obfuscated = ["Author\u200Bization: ", "Bear\u200Ber signalement_test_token"].join("");

    expect(inspectPublicTree([{ path: "notes.txt", content: obfuscated }])).toContainEqual({
      path: "notes.txt",
      code: "captured-credential",
    });
  });

  test.each([
    "\u{E0100}",
    "\u{E0061}",
  ])("removes supplementary default-ignorable %s before credential checks", (ignorable) => {
    const obfuscated = `Author${ignorable}ization: Bear${ignorable}er signalement_test_token`;

    expect(inspectPublicTree([{ path: "notes.txt", content: obfuscated }])).toContainEqual({
      path: "notes.txt",
      code: "captured-credential",
    });
  });

  test.each([
    ["GitHub token", ["gh", "p_", "A".repeat(24)].join("")],
    ["AWS access key", ["AK", "IA", "A".repeat(16)].join("")],
    ["Slack token", ["xo", "xb-", "1234567890-abcdefghij"].join("")],
    [
      "credentialled database URI",
      ["postgresql://operator:", "signalement_test_password", "@db.customer.internal/app"].join(""),
    ],
    ["OpenPGP private key", ["-----BEGIN PGP ", "PRIVATE KEY BLOCK-----"].join("")],
  ])("rejects a %s marker", (_label, content) => {
    expect(inspectPublicTree([{ path: "notes.txt", content }])).toContainEqual({
      path: "notes.txt",
      code: "captured-credential",
    });
  });

  test.each([
    ["captured-cookie", ["Coo", "kie: session=signalement_test_cookie"].join("")],
    ["captured-cookie", ["Set-Coo", "kie: session=signalement_test_cookie"].join("")],
    ["private-key", ["-----BEGIN ", "PRIVATE KEY-----"].join("")],
    [
      "credential-url",
      ["https://operator:", "signalement_test_password", "@tracker.invalid/item"].join(""),
    ],
    ["personal-email", ["reporter", "@customer.company"].join("")],
    ["machine-local-path", ["/Users", "/private-operator/project"].join("")],
    ["machine-local-path", ["/home", "/private-operator/project"].join("")],
  ] as const)("rejects %s text", (code, content) => {
    expect(inspectPublicTree([{ path: "notes.txt", content }])).toContainEqual({
      path: "notes.txt",
      code,
    });
  });

  test.each([
    "reporter@example.com",
    "reporter@example.org",
    "reporter@signalement.test",
    "reporter@signalement.invalid",
    "Install @libre-ai/governance from the pinned commit.",
    "package@1.2.3",
    "release@2",
  ])("allows canonical reserved examples, package scopes, and version notation", (content) => {
    expect(inspectPublicTree([{ path: "notes.txt", content }])).toEqual([]);
  });

  test("allows a canonical reserved example followed by sentence punctuation", () => {
    const content = ["reporter", "@example.com."].join("");

    expect(inspectPublicTree([{ path: "notes.txt", content }])).toEqual([]);
  });

  test.each([
    ["leading hyphen", ["reporter", "@-.example"].join("")],
    ["trailing hyphen", ["reporter", "@bad-.example"].join("")],
    ["underscore", ["reporter", "@bad_name.example"].join("")],
    ["empty punycode payload", ["reporter", "@xn--.example"].join("")],
  ])("rejects a reserved example with a non-canonical DNS label: %s", (_label, content) => {
    expect(inspectPublicTree([{ path: "notes.txt", content }])).toContainEqual({
      path: "notes.txt",
      code: "personal-email",
    });
  });

  test.each([
    ["quoted email", ['"reporter"', "@customer.company"].join("")],
    ["commented email", ["reporter(comment)", String.fromCodePoint(0x40), "customer.company"].join("")],
    ["SMTPUTF8 email", ["reporter🦀", "@customer.company"].join("")],
    ["domain-literal email", ["reporter", "@[192.0.2.1]"].join("")],
    ["HTML-encoded email", ["reporter&comm", "at;customer&per", "iod;company"].join("")],
  ])("rejects a %s", (_label, content) => {
    expect(inspectPublicTree([{ path: "notes.txt", content }])).toContainEqual({
      path: "notes.txt",
      code: "personal-email",
    });
  });

  test.each([
    ["quoted local part", ['"reporter"', "@example.com"].join("")],
    ["commented local part", ["reporter(comment)", String.fromCodePoint(0x40), "example.org"].join("")],
    ["SMTPUTF8 local part", ["reporter🦀", "@signalement.test"].join("")],
  ])("does not exempt a reserved-domain email with a %s", (_label, content) => {
    expect(inspectPublicTree([{ path: "notes.txt", content }])).toContainEqual({
      path: "notes.txt",
      code: "personal-email",
    });
  });

  test.each([
    ["French phone number", ["06 12 34", " 56 78"].join(""), "personal-phone"],
    ["French IBAN", ["FR76 3000 6000", " 0112 3456 7890 189"].join(""), "personal-iban"],
  ] as const)("rejects a %s", (_label, content, code) => {
    expect(inspectPublicTree([{ path: "notes.txt", content }])).toContainEqual({
      path: "notes.txt",
      code,
    });
  });

  test("does not exempt a contributor identity embedded in content", () => {
    const contributor = ["12345+signalement-test", "@users.noreply.github.com"].join("");

    expect(inspectPublicTree([{ path: "notes.txt", content: contributor }])).toEqual([
      { path: "notes.txt", code: "personal-email" },
    ]);
  });

  test("scans sensitive path names without echoing them", () => {
    const sensitivePath = ["docs/", "reporter", "@customer.company", ".txt"].join("");

    const findings = inspectPublicTree([{ path: sensitivePath, content: "safe" }]);

    expect(findings).toContainEqual({ path: "<redacted-path:1>", code: "personal-email" });
    expect(JSON.stringify(findings)).not.toContain("reporter");
  });

  test.each([
    ["HTML-encoded traversal", "&period;&period;/outside.txt", "unsafe-path"],
    ["percent-encoded traversal", "%2e%2e/outside.txt", "unsafe-path"],
    ["percent-encoded artifact extension", "capture%2Ehar", "forbidden-artifact"],
    ["NFKC artifact extension", "capture\uFF0Ehar", "forbidden-artifact"],
    ["percent-encoded instance directory", "instances%2Fjira.yaml", "instance-configuration"],
    ["percent-encoded data directory", "d%61ta/report.txt", "forbidden-artifact"],
  ] as const)("rejects a %s path evasion", (_label, path, code) => {
    expect(inspectPublicTree([{ path, content: "safe" }])).toContainEqual({ path, code });
  });

  test("decodes a personal email in a path and redacts the diagnostic", () => {
    const path = ["docs/reporter%4", "0customer%2Ecompany", ".txt"].join("");

    const findings = inspectPublicTree([{ path, content: "safe" }]);

    expect(findings).toContainEqual({ path: "<redacted-path:1>", code: "personal-email" });
    expect(JSON.stringify(findings)).not.toContain("reporter");
    expect(JSON.stringify(findings)).not.toContain("customer");
  });

  test("rejects decoded-equivalent paths as duplicates", () => {
    expect(
      inspectPublicTree([
        { path: "docs/report%2Etxt", content: "first" },
        { path: "docs/report.txt", content: "second" },
      ]),
    ).toContainEqual({ path: "docs/report.txt", code: "duplicate-path" });
  });

  test("refuses and redacts every path containing a default-ignorable code point", () => {
    const path = "docs/re\u200Bport.txt";

    const findings = inspectPublicTree([{ path, content: "safe" }]);

    expect(findings).toContainEqual({ path: "<redacted-path:1>", code: "unsafe-path" });
    expect(JSON.stringify(findings)).not.toContain(path);
  });

  test.each([
    ["NUL", "\u0000"],
    ["TAB", "\u0009"],
    ["LF", "\u000A"],
    ["CR", "\u000D"],
    ["ESC", "\u001B"],
    ["DEL", "\u007F"],
    ["C1 NEL", "\u0085"],
  ])("refuses and redacts a path containing raw %s", (_label, control) => {
    const findings = inspectPublicTree([{ path: `capture${control}.har`, content: "safe" }]);

    expect(findings).toContainEqual({ path: "<redacted-path:1>", code: "unsafe-path" });
    expect(findings.every(({ path }) => path === "<redacted-path:1>")).toBe(true);
  });

  test.each([
    ["percent NUL", "%00"],
    ["percent TAB", "%09"],
    ["percent LF", "%0A"],
    ["percent CR", "%0D"],
    ["percent ESC", "%1B"],
    ["percent DEL", "%7F"],
    ["percent C1 NEL", "%C2%85"],
    ["HTML ESC", "&#x1B;"],
  ])("refuses and redacts a path containing decoded %s", (_label, encodedControl) => {
    const path = `capture${encodedControl}.har`;
    const findings = inspectPublicTree([{ path, content: "safe" }]);

    expect(findings).toContainEqual({ path: "<redacted-path:1>", code: "unsafe-path" });
    expect(findings.every(({ path: findingPath }) => findingPath === "<redacted-path:1>")).toBe(
      true,
    );
    expect(JSON.stringify(findings)).not.toContain(encodedControl);
  });

  test.each([
    "capture.har",
    "recording.webm",
    "screen.mp4",
    "screenshot.png",
    "archive.zip",
    "customer-export.csv",
    "database.sql",
    "data/example.txt",
    "docs/exports/report.txt",
  ])("rejects captured or unbounded artifacts by path", (path) => {
    expect(inspectPublicTree([{ path, content: "" }])).toContainEqual({
      path,
      code: "forbidden-artifact",
    });
  });

  test.each([
    "migrations/0001_initial.sql",
    "database/migrations/0002_index.sql",
  ])("allows a migration SQL file in a migrations directory", (path) => {
    expect(inspectPublicTree([{ path, content: "CREATE TABLE example (id INTEGER);" }])).toEqual(
      [],
    );
  });

  test.each([
    "migrations%2Fcustomer.sql",
    "migrations&sol;customer.sql",
    "docs%2Fmigrations/customer.sql",
    "migrations%252Fcustomer.sql",
    "migrations/customer%2Esql",
  ])("does not grant the migration exception from a decoded path: %s", (path) => {
    expect(inspectPublicTree([{ path, content: "safe" }])).toContainEqual({
      path,
      code: "forbidden-artifact",
    });
  });

  test.each([
    ".env",
    "deploy/.env.production",
    "instances/jira.yaml",
    "provider-instance.json",
  ])("rejects instance configuration by path", (path) => {
    expect(inspectPublicTree([{ path, content: "placeholder" }])).toContainEqual({
      path,
      code: "instance-configuration",
    });
  });

  test("rejects unsafe, duplicated, oversized, and binary entries fail-closed", () => {
    const files = [
      { path: "../outside.txt", content: "safe" },
      { path: "same.txt", content: "first" },
      { path: "same.txt", content: "second" },
      { path: "large.txt", content: "x".repeat(65) },
      { path: "binary.dat", content: new Uint8Array([0, 1, 2]) },
    ];

    expect(inspectPublicTree(files, { maxFileBytes: 64 })).toEqual([
      { path: "../outside.txt", code: "unsafe-path" },
      { path: "binary.dat", code: "unclassified-binary" },
      { path: "large.txt", code: "oversized-file" },
      { path: "same.txt", code: "duplicate-path" },
    ]);
  });

  test("rejects paths that become unsafe only after Unicode normalization", () => {
    const disguisedTraversal = `.\u200B./outside.txt`;

    expect(inspectPublicTree([{ path: disguisedTraversal, content: "safe" }])).toEqual([
      { path: "<redacted-path:1>", code: "unsafe-path" },
    ]);
  });

  test("rejects canonically equivalent paths as duplicates", () => {
    const decomposed = "docs/cafe\u0301.txt";
    const precomposed = "docs/caf\u00E9.txt";

    expect(
      inspectPublicTree([
        { path: decomposed, content: "first" },
        { path: precomposed, content: "second" },
      ]),
    ).toEqual([{ path: precomposed, code: "duplicate-path" }]);
  });

  test("rejects a tree whose declared bytes exceed the cumulative bound", () => {
    const files = [
      { path: "first.txt", content: "1234" },
      { path: "second.txt", content: "", declaredByteLength: 4 },
    ];

    expect(inspectPublicTree(files, { maxTreeBytes: 7 })).toContainEqual({
      path: "<tree>",
      code: "tree-volume-exceeded",
    });
  });

  test("uses a larger declared byte length without allocating the content", () => {
    const files = [{ path: "large.txt", content: "", declaredByteLength: 65 }];

    expect(inspectPublicTree(files, { maxFileBytes: 64 })).toEqual([
      { path: "large.txt", code: "oversized-file" },
    ]);
  });

  test("returns deterministic path and code ordering without duplicate findings", () => {
    const capturedHeader = ["Author", "ization: Basic signalement_test_value"].join("");
    const files = [
      { path: "z.txt", content: capturedHeader },
      { path: "a.txt", content: `${capturedHeader}\n${capturedHeader}` },
    ];

    expect(inspectPublicTree(files)).toEqual([
      { path: "a.txt", code: "captured-credential" },
      { path: "z.txt", code: "captured-credential" },
    ]);
  });
});
