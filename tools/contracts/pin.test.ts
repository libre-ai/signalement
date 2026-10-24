import { expect, test } from "bun:test";
import { CONTRACT_PIN_SCHEMA_VERSION, parsePin } from "./pin.ts";

const digest = "a".repeat(64);
const valid = () => ({
  schemaVersion: "signalement.contract-pin.v2",
  repository: "https://github.com/libre-ai/schemas-and-contracts",
  commit: "0123456789abcdef0123456789abcdef01234567",
  contracts: [
    {
      id: "alpha-v1",
      status: "locked",
      files: ["contracts/catalog.v1.json", "tools/quality/a.ts"],
    },
    { id: "beta-v2", status: "candidate", files: ["contracts/catalog.v1.json"] },
  ],
  files: { "contracts/catalog.v1.json": digest, "tools/quality/a.ts": digest },
});
const parse = (document: unknown) => parsePin(new TextEncoder().encode(JSON.stringify(document)));

test("the schema version constant is the registry value", () =>
  expect(CONTRACT_PIN_SCHEMA_VERSION).toBe("signalement.contract-pin.v2"));

test("a well-formed v2 pin is accepted with its contracts in pin order", () => {
  const pin = parse(valid());
  expect(pin?.contracts.map((contract) => contract.id)).toEqual(["alpha-v1", "beta-v2"]);
  expect(pin?.contracts[1]?.status).toBe("candidate");
  expect(pin?.files["tools/quality/a.ts"]).toBe(digest);
  expect(pin?.commit).toBe("0123456789abcdef0123456789abcdef01234567");
});

test("a file:// authority is accepted for the local test authority", () => {
  expect(parse({ ...valid(), repository: "file:///tmp/authority.git" })).not.toBeNull();
});

test("the v1 single-contract format is rejected", () => {
  expect(
    parse({
      repository: valid().repository,
      commit: valid().commit,
      contract: "alpha-v1",
      status: "locked",
      files: valid().files,
    }),
  ).toBeNull();
  expect(parse({ ...valid(), schemaVersion: "signalement.contract-pin.v1" })).toBeNull();
});

test("each deviation from the v2 format is rejected", () => {
  const cases: Record<string, (pin: ReturnType<typeof valid>) => unknown> = {
    "duplicate contract id": (pin) => ({ ...pin, contracts: [pin.contracts[0], pin.contracts[0]] }),
    "parent traversal in a contract file": (pin) => ({
      ...pin,
      contracts: [{ ...pin.contracts[0], files: ["contracts/../x"] }],
    }),
    "parent traversal in the file table": (pin) => ({
      ...pin,
      files: { ...pin.files, "contracts/../x": digest },
    }),
    "current-directory segment": (pin) => ({
      ...pin,
      contracts: [{ ...pin.contracts[0], files: ["contracts/./x"] }],
    }),
    "path outside contracts/ and tools/": (pin) => ({
      ...pin,
      files: { "src/x.ts": digest },
    }),
    "unknown top-level key": (pin) => ({ ...pin, extra: true }),
    "unknown contract key": (pin) => ({
      ...pin,
      contracts: [{ ...pin.contracts[0], note: "x" }],
    }),
    "status draft": (pin) => ({
      ...pin,
      contracts: [{ ...pin.contracts[0], status: "draft" }],
    }),
    "empty contracts": (pin) => ({ ...pin, contracts: [] }),
    "contract without files": (pin) => ({
      ...pin,
      contracts: [{ ...pin.contracts[0], files: [] }],
    }),
    "duplicate file in a contract": (pin) => ({
      ...pin,
      contracts: [
        { ...pin.contracts[0], files: ["contracts/catalog.v1.json", "contracts/catalog.v1.json"] },
      ],
    }),
    "contract id without a major version": (pin) => ({
      ...pin,
      contracts: [{ ...pin.contracts[0], id: "alpha" }],
    }),
    "contract id with major version zero": (pin) => ({
      ...pin,
      contracts: [{ ...pin.contracts[0], id: "alpha-v0" }],
    }),
    "ssh repository": (pin) => ({ ...pin, repository: "ssh://example.invalid/repo" }),
    "option-shaped repository": (pin) => ({ ...pin, repository: "--upload-pack=touch" }),
    "uppercase commit": (pin) => ({ ...pin, commit: "A".repeat(40) }),
    "short commit": (pin) => ({ ...pin, commit: "abc123" }),
    "short digest": (pin) => ({ ...pin, files: { "contracts/catalog.v1.json": "a".repeat(63) } }),
    "uppercase digest": (pin) => ({
      ...pin,
      files: { "contracts/catalog.v1.json": "A".repeat(64) },
    }),
    "non-string digest": (pin) => ({ ...pin, files: { "contracts/catalog.v1.json": 1 } }),
  };
  for (const [name, mutate] of Object.entries(cases))
    expect([name, parse(mutate(valid()))]).toEqual([name, null]);
});

test("bytes that are not a JSON object are rejected, never thrown", () => {
  for (const raw of ["", "{", "[]", "null", '"x"', "1"])
    expect(parsePin(new TextEncoder().encode(raw))).toBeNull();
  expect(parsePin(new Uint8Array([0xff, 0xfe]))).toBeNull();
});
