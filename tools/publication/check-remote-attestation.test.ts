import { describe, expect, test } from "bun:test";

import { parseRemoteAttestationArguments } from "./check-remote-attestation";

describe("parseRemoteAttestationArguments", () => {
  test("accepts one exact commit and manifest digest", () => {
    expect(
      parseRemoteAttestationArguments([
        "--expected-head",
        "a".repeat(40),
        "--expected-manifest-sha256",
        "b".repeat(64),
        "--expected-visibility",
        "private",
      ]),
    ).toEqual({
      expectedHead: "a".repeat(40),
      expectedManifestSha256: "b".repeat(64),
      expectedVisibility: "private",
    });
  });

  test.each([
    { arguments_: [] },
    {
      arguments_: [
        "--expected-head",
        "short",
        "--expected-manifest-sha256",
        "b".repeat(64),
        "--expected-visibility",
        "private",
      ],
    },
    { arguments_: ["--expected-head", "a".repeat(40)] },
    {
      arguments_: [
        "--expected-head",
        "a".repeat(40),
        "--expected-manifest-sha256",
        "b".repeat(64),
        "--expected-visibility",
        "internal",
      ],
    },
    { arguments_: ["--unknown", "value"] },
  ])("rejects incomplete or malformed arguments", ({ arguments_ }) => {
    expect(() => parseRemoteAttestationArguments(arguments_)).toThrow("Usage:");
  });
});
