import { readFile } from "node:fs/promises";

type JsonRecord = Record<string, unknown>;
export type RawDefect =
  | "bom"
  | "invalid-utf8"
  | "duplicate-member"
  | "unpaired-surrogate"
  | "max-depth"
  | "invalid-number"
  | "invalid-json";
type PolicyCoreMajor = "policy-core-v1" | "policy-core-v2";

export class StrictJsonError extends Error {
  constructor(
    readonly defect: RawDefect,
    message: string,
  ) {
    super(message);
    this.name = "StrictJsonError";
  }
}

class StrictJsonParser {
  private index = 0;

  constructor(
    private readonly input: string,
    private readonly maxDepth: number,
  ) {}

  parse(): void {
    this.skipWhitespace();
    this.parseValue(0);
    this.skipWhitespace();
    if (this.index !== this.input.length) this.fail("invalid JSON trailing bytes");
  }

  private parseValue(depth: number): void {
    if (depth > this.maxDepth) this.fail("maximum JSON depth exceeded", "max-depth");
    this.skipWhitespace();
    const current = this.input[this.index];
    if (current === "{") this.parseObject(depth);
    else if (current === "[") this.parseArray(depth);
    else if (current === '"') this.parseString();
    else if (current === "t") this.parseLiteral("true");
    else if (current === "f") this.parseLiteral("false");
    else if (current === "n") this.parseLiteral("null");
    else if (current === "-" || (current !== undefined && current >= "0" && current <= "9"))
      this.parseNumber();
    else if (current === "+" || current === "N" || current === "I")
      this.fail("invalid JSON number", "invalid-number");
    else this.fail("invalid JSON value");
  }

  private parseObject(depth: number): void {
    this.index += 1;
    this.skipWhitespace();
    const keys = new Set<string>();
    if (this.input[this.index] === "}") {
      this.index += 1;
      return;
    }
    while (true) {
      if (this.input[this.index] !== '"') this.fail("object member name must be a string");
      const key = this.parseString();
      if (keys.has(key)) this.fail("duplicate JSON object member", "duplicate-member");
      keys.add(key);
      this.skipWhitespace();
      if (this.input[this.index] !== ":") this.fail("missing object member colon");
      this.index += 1;
      this.parseValue(depth + 1);
      this.skipWhitespace();
      const delimiter = this.input[this.index];
      if (delimiter === "}") {
        this.index += 1;
        return;
      }
      if (delimiter !== ",") this.fail("missing object member delimiter");
      this.index += 1;
      this.skipWhitespace();
    }
  }

  private parseArray(depth: number): void {
    this.index += 1;
    this.skipWhitespace();
    if (this.input[this.index] === "]") {
      this.index += 1;
      return;
    }
    while (true) {
      this.parseValue(depth + 1);
      this.skipWhitespace();
      const delimiter = this.input[this.index];
      if (delimiter === "]") {
        this.index += 1;
        return;
      }
      if (delimiter !== ",") this.fail("missing array item delimiter");
      this.index += 1;
    }
  }

  private parseString(): string {
    this.index += 1;
    let decoded = "";
    while (this.index < this.input.length) {
      const current = this.input[this.index] ?? "";
      const code = current.charCodeAt(0);
      if (current === '"') {
        this.index += 1;
        return decoded;
      }
      if (code < 0x20) this.fail("unescaped control character in JSON string");
      if (current === "\\") {
        this.index += 1;
        const escapeCode = this.input[this.index];
        if (escapeCode === undefined) this.fail("unterminated JSON escape");
        const simpleEscapes: Record<string, string> = {
          '"': '"',
          "\\": "\\",
          "/": "/",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t",
        };
        if (escapeCode !== "u") {
          const value = simpleEscapes[escapeCode];
          if (value === undefined) this.fail("invalid JSON escape");
          decoded += value;
          this.index += 1;
          continue;
        }
        this.index += 1;
        const first = this.readHexCodeUnit();
        if (first >= 0xd800 && first <= 0xdbff) {
          if (this.input.slice(this.index, this.index + 2) !== "\\u")
            this.fail("unpaired high surrogate", "unpaired-surrogate");
          this.index += 2;
          const second = this.readHexCodeUnit();
          if (second < 0xdc00 || second > 0xdfff)
            this.fail("unpaired high surrogate", "unpaired-surrogate");
          decoded += String.fromCodePoint(0x10000 + ((first - 0xd800) << 10) + second - 0xdc00);
        } else if (first >= 0xdc00 && first <= 0xdfff) {
          this.fail("unpaired low surrogate", "unpaired-surrogate");
        } else {
          decoded += String.fromCharCode(first);
        }
        continue;
      }
      if (code >= 0xd800 && code <= 0xdbff) {
        const low = this.input.charCodeAt(this.index + 1);
        if (low < 0xdc00 || low > 0xdfff)
          this.fail("unpaired high surrogate", "unpaired-surrogate");
        decoded += this.input.slice(this.index, this.index + 2);
        this.index += 2;
        continue;
      }
      if (code >= 0xdc00 && code <= 0xdfff)
        this.fail("unpaired low surrogate", "unpaired-surrogate");
      decoded += current;
      this.index += 1;
    }
    this.fail("unterminated JSON string");
  }

  private readHexCodeUnit(): number {
    const digits = this.input.slice(this.index, this.index + 4);
    if (!/^[0-9A-Fa-f]{4}$/.test(digits)) this.fail("invalid Unicode escape");
    this.index += 4;
    return Number.parseInt(digits, 16);
  }

  private parseLiteral(literal: string): void {
    if (this.input.slice(this.index, this.index + literal.length) !== literal)
      this.fail("invalid JSON literal");
    this.index += literal.length;
  }

  private parseNumber(): void {
    const remainder = this.input.slice(this.index);
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(remainder);
    if (!match) this.fail("invalid JSON number", "invalid-number");
    this.index += match[0].length;
    const next = this.input[this.index];
    if (
      next !== undefined &&
      next !== "," &&
      next !== "]" &&
      next !== "}" &&
      next !== " " &&
      next !== "\n" &&
      next !== "\r" &&
      next !== "\t"
    ) {
      this.fail("invalid JSON number", "invalid-number");
    }
    if (!Number.isFinite(Number(match[0]))) this.fail("non-finite JSON number", "invalid-number");
  }

  private skipWhitespace(): void {
    while (
      this.input[this.index] === " " ||
      this.input[this.index] === "\n" ||
      this.input[this.index] === "\r" ||
      this.input[this.index] === "\t"
    ) {
      this.index += 1;
    }
  }

  private fail(message: string, defect: RawDefect = "invalid-json"): never {
    throw new StrictJsonError(defect, `${message} at UTF-16 offset ${this.index}`);
  }
}

export function decodeStrictJson(bytes: Uint8Array, maxDepth = Number.MAX_SAFE_INTEGER): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    throw new StrictJsonError("bom", "UTF-8 BOM is forbidden");
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new StrictJsonError("invalid-utf8", "input is not valid UTF-8");
  }
  new StrictJsonParser(decoded, maxDepth).parse();
  return decoded;
}

export function parseStrictJson(bytes: Uint8Array, maxDepth = Number.MAX_SAFE_INTEGER): unknown {
  return JSON.parse(decodeStrictJson(bytes, maxDepth));
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function verifyPolicyCoreRawInputVectors(
  failures: string[],
  major: PolicyCoreMajor,
): Promise<number> {
  const root = "contracts/fixtures/policy-core-invalid-json";
  const manifest = JSON.parse(await readFile(`${root}/manifest.json`, "utf8")) as JsonRecord;
  if (manifest.schemaVersion !== "libre-ai.policy-core-raw-input-vectors.v1")
    failures.push("raw inputs: invalid schemaVersion");
  const cases = Array.isArray(manifest.cases) ? manifest.cases : [];
  const ids = new Set<string>();
  const acceptedDefects = new Set<RawDefect>([
    "bom",
    "invalid-utf8",
    "duplicate-member",
    "unpaired-surrogate",
    "invalid-number",
  ]);
  const missingDefects = new Set(acceptedDefects);

  for (const rawCase of cases) {
    if (!isRecord(rawCase)) {
      failures.push("raw inputs: case is not an object");
      continue;
    }
    const id = typeof rawCase.id === "string" ? rawCase.id : "<missing-id>";
    const label = `raw:${id}`;
    if (ids.has(id)) failures.push(`${label}: duplicate case id`);
    ids.add(id);
    const file = rawCase.file;
    if (typeof file !== "string" || !/^[a-z0-9-]+\.bin$/.test(file)) {
      failures.push(`${label}: unsafe fixture file name`);
      continue;
    }
    const bytes = new Uint8Array(await readFile(`${root}/${file}`));
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(bytes);
    if (hasher.digest("hex") !== rawCase.inputSha256)
      failures.push(`${label}: input SHA-256 mismatch`);
    if (bytes.length !== rawCase.byteLength) failures.push(`${label}: byte length mismatch`);

    const defect = rawCase.defect;
    if (typeof defect !== "string" || !acceptedDefects.has(defect as RawDefect)) {
      failures.push(`${label}: unknown defect`);
      continue;
    }
    missingDefects.delete(defect as RawDefect);
    try {
      decodeStrictJson(bytes);
      failures.push(`${label}: strict decoder accepted forbidden input`);
    } catch (error) {
      if (!(error instanceof StrictJsonError) || error.defect !== defect)
        failures.push(`${label}: expected ${defect}, got ${String(error)}`);
    }

    const expectedErrors = rawCase.expectedErrors;
    const expected = isRecord(expectedErrors) ? expectedErrors[major] : undefined;
    const expectedKeys = isRecord(expected) ? Object.keys(expected).sort() : [];
    const validExpectedRefusal =
      major === "policy-core-v1"
        ? isRecord(expected) &&
          JSON.stringify(expectedKeys) === JSON.stringify(["code", "message"]) &&
          expected.code === "policy.input_invalid" &&
          expected.message === "input does not conform to policy-core-v1"
        : isRecord(expected) &&
          JSON.stringify(expectedKeys) === JSON.stringify(["variant"]) &&
          expected.variant === "input-invalid";
    if (!validExpectedRefusal) failures.push(`${label}: invalid ${major} component refusal`);
  }

  const validControl = new TextEncoder().encode(
    '{"key":1,"\\u006bEy":2,"value":"\\uD834\\uDD1E","numbers":[0,-1.25,1e+20]}',
  );
  try {
    decodeStrictJson(validControl);
  } catch (error) {
    failures.push(`raw inputs: strict decoder rejected valid control: ${String(error)}`);
  }

  for (const missing of missingDefects) failures.push(`raw inputs: missing ${missing} coverage`);
  if (cases.length < 9) failures.push("raw inputs: incomplete adversarial coverage");
  return cases.length;
}
