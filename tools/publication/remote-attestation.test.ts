import { describe, expect, test } from "bun:test";

import {
  compareGitHubApiRefs,
  compareRemoteAdvertisement,
  createRemoteAccessPolicy,
  parseGitHubApiRefs,
  parseRemoteAdvertisement,
} from "./remote-attestation";

const MAIN_OID = "a".repeat(40);
const TAG_OID = "b".repeat(40);
const PEELED_OID = "c".repeat(40);

describe("parseRemoteAdvertisement", () => {
  test("separates HEAD, refs, and peeled tag lines deterministically", () => {
    const output = [
      "ref: refs/heads/main\tHEAD",
      `${MAIN_OID}\tHEAD`,
      `${TAG_OID}\trefs/tags/v1`,
      `${PEELED_OID}\trefs/tags/v1^{}`,
      `${MAIN_OID}\trefs/heads/main`,
      "",
    ].join("\n");

    expect(parseRemoteAdvertisement(output)).toEqual({
      head: { target: "refs/heads/main", objectId: MAIN_OID },
      refs: [
        { name: "refs/heads/main", objectId: MAIN_OID },
        { name: "refs/tags/v1", objectId: TAG_OID },
      ],
      peeled: [{ name: "refs/tags/v1", objectId: PEELED_OID }],
    });
  });

  test("accepts the empty advertisement of a new repository", () => {
    expect(parseRemoteAdvertisement("")).toEqual({ head: null, refs: [], peeled: [] });
  });

  test.each([
    "not-an-oid\trefs/heads/main\n",
    `${MAIN_OID}\trefs/heads/main\n${TAG_OID}\trefs/heads/main\n`,
    `ref: refs/heads/other\tNOT_HEAD\n`,
    `${PEELED_OID}\trefs/heads/main^{}\n`,
  ])("rejects malformed or ambiguous advertisement %s", (output) => {
    expect(() => parseRemoteAdvertisement(output)).toThrow();
  });
});

describe("compareRemoteAdvertisement", () => {
  const expectedRefs = [{ name: "refs/heads/main", objectId: MAIN_OID }] as const;

  test("accepts one exact main ref and HEAD symref", () => {
    const advertisement = parseRemoteAdvertisement(
      `ref: refs/heads/main\tHEAD\n${MAIN_OID}\tHEAD\n${MAIN_OID}\trefs/heads/main\n`,
    );

    expect(compareRemoteAdvertisement(advertisement, expectedRefs)).toEqual([]);
  });

  test("reports missing, unexpected, mismatched, and HEAD differences", () => {
    const advertisement = parseRemoteAdvertisement(
      `ref: refs/heads/other\tHEAD\n${TAG_OID}\tHEAD\n${TAG_OID}\trefs/heads/main\n${MAIN_OID}\trefs/notes/review\n`,
    );

    expect(compareRemoteAdvertisement(advertisement, expectedRefs)).toEqual([
      "head-object-mismatch",
      "head-target-mismatch",
      "ref-object-mismatch:refs/heads/main",
      "unexpected-ref:refs/notes/review",
    ]);
  });

  test("accepts no refs only when the expected set is empty", () => {
    const empty = parseRemoteAdvertisement("");

    expect(compareRemoteAdvertisement(empty, [])).toEqual([]);
    expect(compareRemoteAdvertisement(empty, expectedRefs)).toEqual([
      "missing-head",
      "missing-ref:refs/heads/main",
    ]);
  });
});

describe("GitHub API ref inventory", () => {
  test("parses paginated matching-ref responses", () => {
    const json = JSON.stringify([
      [
        { ref: "refs/heads/main", object: { sha: MAIN_OID, type: "commit" } },
        { ref: "refs/pull/1/head", object: { sha: TAG_OID, type: "commit" } },
      ],
    ]);

    expect(parseGitHubApiRefs(json)).toEqual([
      { name: "refs/heads/main", objectId: MAIN_OID },
      { name: "refs/pull/1/head", objectId: TAG_OID },
    ]);
  });

  test("fails on duplicate or malformed provider refs", () => {
    const duplicate = JSON.stringify([
      { ref: "refs/heads/main", object: { sha: MAIN_OID } },
      { ref: "refs/heads/main", object: { sha: MAIN_OID } },
    ]);

    expect(() => parseGitHubApiRefs(duplicate)).toThrow();
    expect(() => parseGitHubApiRefs("{}")).toThrow();
  });

  test("requires Git and GitHub API inventories to match exactly", () => {
    const advertised = [{ name: "refs/heads/main", objectId: MAIN_OID }] as const;

    expect(compareGitHubApiRefs(advertised, advertised)).toEqual([]);
    expect(
      compareGitHubApiRefs(advertised, [
        ...advertised,
        { name: "refs/pull/1/head", objectId: TAG_OID },
      ]),
    ).toEqual(["api-only-ref:refs/pull/1/head"]);
  });
});

describe("remote access policy", () => {
  test("uses authenticated GitHub CLI access only for the private phase", () => {
    const policy = createRemoteAccessPolicy("private", "/tmp/clean-home", {
      PATH: "/usr/bin:/bin",
    });

    expect(policy.apiRefsCommand.slice(0, 3)).toEqual(["gh", "api", "--paginate"]);
    expect(policy.repositoryCommand.slice(0, 2)).toEqual(["gh", "api"]);
    expect(policy.commandEnvironment).toBeNull();
  });

  test("uses anonymous HTTPS and strips credential-bearing environment variables publicly", () => {
    const policy = createRemoteAccessPolicy("public", "/tmp/clean-home", {
      PATH: "/custom/bin:/usr/bin:/bin",
      GH_TOKEN: "provider-secret",
      GITHUB_TOKEN: "workflow-secret",
      GIT_ASKPASS: "/tmp/credential-helper",
      HTTPS_PROXY: ["https://identity:", "secret@example.invalid"].join(""),
      NPM_CONFIG_USERCONFIG: "/tmp/npmrc",
    });

    expect(policy.apiRefsCommand[0]).toBe("curl");
    expect(policy.repositoryCommand[0]).toBe("curl");
    expect(policy.apiRefsCommand.join(" ")).toContain("https://api.github.com/");
    expect(policy.commandEnvironment).toEqual({
      GCM_INTERACTIVE: "never",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      HOME: "/tmp/clean-home",
      PATH: "/custom/bin:/usr/bin:/bin",
      TMPDIR: "/tmp/clean-home",
      XDG_CONFIG_HOME: "/tmp/clean-home/.config",
    });
    expect(JSON.stringify(policy)).not.toContain("provider-secret");
    expect(JSON.stringify(policy)).not.toContain("workflow-secret");
    expect(JSON.stringify(policy)).not.toContain("credential-helper");
    expect(JSON.stringify(policy)).not.toContain("identity:secret");
    expect(JSON.stringify(policy)).not.toContain("npmrc");
  });
});
