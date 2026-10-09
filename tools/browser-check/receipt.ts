import { appendFile, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Verdict over the installed-Chrome qualification receipt.
 *
 * The receipt itself is unchanged: `partial` still records that native quota
 * refusal was not observed. What changes is who fails on it. The required
 * "Bun quality" gate admits exactly one shortfall — the native quota, which
 * headless Chrome never raises under CDP Storage.overrideQuotaForOrigin — and
 * fails on every other missing, extra, reordered or failed step. A separate
 * job applies the `advisory` policy to the same receipt: the `required`
 * verdict, with an unverified native quota reported as a warning.
 */
export const REQUIRED_STEPS = [
  "synthetic-production-storage-application-quota-and-native-abort",
  "extension-installed",
  "popup-open-zero-native-capture-calls",
  "explicit-active-tab-capture-preview",
  "decoded-redaction-every-pixel-opaque-black",
  "synthetic-noise-capture-prepared",
  "encrypted-draft-save-lock-page-reload-unlock-resume",
  "browser-process-restart-locked-key-and-durable-draft-resume",
  "downloaded-zip-independent-verifier",
] as const;
export const NATIVE_QUOTA_STEP =
  "native-extension-quota-refusal-preserves-draft-revision-and-bytes";

export type NativeQuotaPolicy = "required" | "non-required";
type QuotaState = "verified" | "unverified" | "inconsistent";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function sameSteps(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((step, i) => step === expected[i]);
}
function stepsWithQuota(): string[] {
  const steps: string[] = [...REQUIRED_STEPS];
  steps.splice(steps.indexOf("synthetic-noise-capture-prepared") + 1, 0, NATIVE_QUOTA_STEP);
  return steps;
}
function stringSteps(receipt: Record<string, unknown>): string[] | null {
  const steps = receipt.steps;
  if (!Array.isArray(steps) || steps.some((step) => typeof step !== "string")) return null;
  return steps as string[];
}
function quotaState(receipt: Record<string, unknown>, steps: readonly string[]): QuotaState {
  const quota = isRecord(receipt.quota) ? receipt.quota : {};
  if (
    receipt.status === "passed" &&
    sameSteps(steps, stepsWithQuota()) &&
    quota.nativeError === "QuotaExceededError" &&
    quota.preservedCiphertextAndRevision === true
  )
    return "verified";
  if (
    receipt.status === "partial" &&
    sameSteps(steps, REQUIRED_STEPS) &&
    quota.status === "unverified"
  )
    return "unverified";
  return "inconsistent";
}

/** Failure codes only; the receipt's reason text never reaches the verdict. */
export function receiptFailures(receipt: unknown, policy: NativeQuotaPolicy): string[] {
  if (!isRecord(receipt)) return ["receipt.shape"];
  if (receipt.status === "failed") return ["receipt.failed"];
  if (receipt.status !== "passed" && receipt.status !== "partial") return ["receipt.status"];
  const steps = stringSteps(receipt);
  if (steps === null) return ["receipt.shape"];
  const required = steps.filter((step) => step !== NATIVE_QUOTA_STEP);
  if (!sameSteps(required, REQUIRED_STEPS) || steps.length - required.length > 1)
    return ["receipt.steps"];
  const quota = quotaState(receipt, steps);
  if (quota === "inconsistent") return ["receipt.inconsistent"];
  if (quota === "unverified" && policy === "required") return ["quota.unverified"];
  return [];
}

/** Volume line printed on success and failure alike. */
export function receiptSummary(receipt: unknown): string {
  const steps = isRecord(receipt) ? (stringSteps(receipt) ?? []) : [];
  const verified = REQUIRED_STEPS.filter((step) => steps.includes(step)).length;
  const quota =
    isRecord(receipt) && quotaState(receipt, steps) === "verified" ? "verified" : "unverified";
  return `${verified}/${REQUIRED_STEPS.length} required steps verified; native quota ${quota}`;
}

async function receiptPaths(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await receiptPaths(path)));
    else if (entry.isFile() && entry.name === "evidence.json") found.push(path);
  }
  return found;
}

/** A missing, ambiguous or unreadable receipt is a failure, never an empty pass. */
export async function readReceipt(
  path: string,
): Promise<{ receipt: unknown } | { failure: string }> {
  let file = path;
  try {
    if ((await stat(path)).isDirectory()) {
      const paths = await receiptPaths(path);
      if (paths.length === 0) return { failure: "receipt.missing" };
      if (paths.length > 1) return { failure: "receipt.ambiguous" };
      file = paths[0] ?? path;
    }
    return { receipt: JSON.parse(await readFile(file, "utf8")) };
  } catch {
    return { failure: "receipt.unreadable" };
  }
}

function singleQuotaArgument(args: readonly string[]): string | undefined {
  const values = args
    .filter((arg) => arg.startsWith("--native-quota="))
    .map((arg) => arg.slice("--native-quota=".length));
  return values.length === 1 ? values[0] : undefined;
}

/** Policies a browser run may apply to its own receipt. */
export function policyArgument(args: readonly string[]): NativeQuotaPolicy | null {
  const value = singleQuotaArgument(args);
  return value === "required" || value === "non-required" ? value : null;
}

/**
 * `advisory` is the `required` verdict with exactly one code downgraded to a
 * warning: `quota.unverified` (owner decision D2). It exists only for the
 * standalone verifier, so a browser run can never be made advisory, and it is
 * what keeps the native quota job from blocking the workflow. Runner-level
 * `continue-on-error` is not used because it would also swallow a missing or
 * unreadable receipt.
 */
export type ReceiptPolicy = NativeQuotaPolicy | "advisory";
export const ADVISORY_QUOTA_WARNING = "native quota unverified (non-required, owner decision D2)";
const ANNOTATION_TITLE = "Native quota qualification";

export function receiptPolicyArgument(args: readonly string[]): ReceiptPolicy | null {
  const value = singleQuotaArgument(args);
  return value === "advisory" ? value : policyArgument(args);
}

export interface ReceiptReport {
  exitCode: 0 | 1;
  failures: string[];
  stdout: string[];
  stderr: string[];
  /** Markdown for `$GITHUB_STEP_SUMMARY`; built from counts and codes only. */
  stepSummary: string;
}

export function receiptReport(
  read: { receipt: unknown } | { failure: string },
  policy: ReceiptPolicy,
): ReceiptReport {
  const receipt = "receipt" in read ? read.receipt : null;
  const summary = receiptSummary(receipt);
  const evaluated =
    "failure" in read
      ? [read.failure]
      : receiptFailures(read.receipt, policy === "advisory" ? "required" : policy);
  const advisoryShortfall =
    policy === "advisory" && evaluated.length === 1 && evaluated[0] === "quota.unverified";
  const failures = advisoryShortfall ? [] : evaluated;
  const quotaVerified =
    isRecord(receipt) && quotaState(receipt, stringSteps(receipt) ?? []) === "verified";
  let verdict: string;
  if (failures.length > 0) verdict = `failed (${failures.join(", ")})`;
  else if (advisoryShortfall) verdict = ADVISORY_QUOTA_WARNING;
  else if (quotaVerified) verdict = "native quota verified";
  else verdict = "native quota unverified (not required by this policy)";
  const stepSummary = [
    `### ${ANNOTATION_TITLE}`,
    "",
    `- **Verdict:** ${verdict}`,
    `- **Receipt:** ${summary}`,
    `- **Policy:** ${policy}`,
    "",
  ].join("\n");
  if (failures.length > 0) {
    const stderr = [summary, ...failures];
    if (policy === "advisory")
      stderr.push(...failures.map((code) => `::error title=${ANNOTATION_TITLE}::${code}`));
    return { exitCode: 1, failures, stdout: [], stderr, stepSummary };
  }
  const stdout = [`${summary} (native quota policy: ${policy})`];
  if (advisoryShortfall)
    stdout.push(`::warning title=${ANNOTATION_TITLE}::${ADVISORY_QUOTA_WARNING}`);
  return { exitCode: 0, failures, stdout, stderr: [], stepSummary };
}

if (import.meta.main) {
  const policy = receiptPolicyArgument(process.argv.slice(2));
  const target = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (policy === null || target === undefined) {
    console.error(
      "Usage: receipt.ts <receipt-or-directory> --native-quota=required|non-required|advisory",
    );
    process.exitCode = 2;
  } else {
    const report = receiptReport(await readReceipt(target), policy);
    if (report.stdout.length > 0) console.log(report.stdout.join("\n"));
    if (report.stderr.length > 0) console.error(report.stderr.join("\n"));
    const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (stepSummaryPath) await appendFile(stepSummaryPath, report.stepSummary);
    process.exitCode = report.exitCode;
  }
}
