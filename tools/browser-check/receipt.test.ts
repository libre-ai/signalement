import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ADVISORY_QUOTA_WARNING,
  NATIVE_QUOTA_STEP,
  policyArgument,
  REQUIRED_STEPS,
  readReceipt,
  receiptFailures,
  receiptPolicyArgument,
  receiptReport,
  receiptSummary,
} from "./receipt";

function withQuotaStep(): string[] {
  const steps: string[] = [...REQUIRED_STEPS];
  steps.splice(steps.indexOf("synthetic-noise-capture-prepared") + 1, 0, NATIVE_QUOTA_STEP);
  return steps;
}
function passed(): Record<string, unknown> {
  return {
    status: "passed",
    steps: withQuotaStep(),
    quota: { nativeError: "QuotaExceededError", preservedCiphertextAndRevision: true },
  };
}
function quotaUnverified(): Record<string, unknown> {
  return {
    status: "partial",
    steps: [...REQUIRED_STEPS],
    quota: { status: "unverified", reason: "CDP Storage.overrideQuotaForOrigin did not cause" },
  };
}

test("the required gate admits a receipt whose only shortfall is the native quota", () => {
  expect(REQUIRED_STEPS).toHaveLength(9);
  expect(receiptFailures(quotaUnverified(), "non-required")).toEqual([]);
  expect(receiptSummary(quotaUnverified())).toBe(
    "9/9 required steps verified; native quota unverified",
  );
});

test("the native quota job refuses an unverified quota", () => {
  expect(receiptFailures(quotaUnverified(), "required")).toEqual(["quota.unverified"]);
});

test("a fully qualified receipt passes both gates", () => {
  expect(receiptFailures(passed(), "non-required")).toEqual([]);
  expect(receiptFailures(passed(), "required")).toEqual([]);
  expect(receiptSummary(passed())).toBe("9/9 required steps verified; native quota verified");
});

test("any other failed, missing, extra or reordered step fails the required gate", () => {
  const failed = { ...quotaUnverified(), status: "failed", reason: "Draft mismatch" };
  expect(receiptFailures(failed, "non-required")).toEqual(["receipt.failed"]);
  for (const step of REQUIRED_STEPS) {
    const missing = quotaUnverified();
    missing.steps = REQUIRED_STEPS.filter((candidate) => candidate !== step);
    expect(receiptFailures(missing, "non-required")).toEqual(["receipt.steps"]);
    const fromPassed = passed();
    fromPassed.steps = withQuotaStep().filter((candidate) => candidate !== step);
    expect(receiptFailures(fromPassed, "non-required")).toEqual(["receipt.steps"]);
  }
  const extra = quotaUnverified();
  extra.steps = [...REQUIRED_STEPS, "unreviewed-step"];
  expect(receiptFailures(extra, "non-required")).toEqual(["receipt.steps"]);
  const reordered = quotaUnverified();
  reordered.steps = [...REQUIRED_STEPS].reverse();
  expect(receiptFailures(reordered, "non-required")).toEqual(["receipt.steps"]);
});

test("a partial receipt cannot hide a cause other than the native quota", () => {
  const otherCause = quotaUnverified();
  otherCause.quota = { overrideAccepted: true, advertisedQuota: 1 };
  expect(receiptFailures(otherCause, "non-required")).toEqual(["receipt.inconsistent"]);
  const claimedQuota = quotaUnverified();
  claimedQuota.steps = withQuotaStep();
  expect(receiptFailures(claimedQuota, "non-required")).toEqual(["receipt.inconsistent"]);
  const unsupportedPass = passed();
  unsupportedPass.quota = { status: "unverified" };
  expect(receiptFailures(unsupportedPass, "non-required")).toEqual(["receipt.inconsistent"]);
  const passWithoutQuotaStep = passed();
  passWithoutQuotaStep.steps = [...REQUIRED_STEPS];
  expect(receiptFailures(passWithoutQuotaStep, "non-required")).toEqual(["receipt.inconsistent"]);
});

test("malformed receipts fail closed", () => {
  for (const value of [null, [], "passed", 1, {}, { status: "passed" }, { status: "unknown" }])
    expect(receiptFailures(value, "non-required").length).toBeGreaterThan(0);
  expect(receiptFailures({ ...passed(), steps: [1] }, "non-required")).toEqual(["receipt.shape"]);
  expect(receiptSummary(null)).toBe("0/9 required steps verified; native quota unverified");
});

test("reads exactly one receipt from an output directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "signalement-receipt-test-"));
  try {
    expect(await readReceipt(root)).toEqual({ failure: "receipt.missing" });
    await mkdir(join(root, "run-a"));
    await writeFile(join(root, "run-a", "evidence.json"), JSON.stringify(passed()));
    expect(await readReceipt(root)).toEqual({ receipt: passed() });
    expect(await readReceipt(join(root, "run-a", "evidence.json"))).toEqual({ receipt: passed() });
    await mkdir(join(root, "run-b"));
    await writeFile(join(root, "run-b", "evidence.json"), "{");
    expect(await readReceipt(root)).toEqual({ failure: "receipt.ambiguous" });
    expect(await readReceipt(join(root, "run-b", "evidence.json"))).toEqual({
      failure: "receipt.unreadable",
    });
    expect(await readReceipt(join(root, "absent.json"))).toEqual({ failure: "receipt.unreadable" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the advisory policy reports an unverified quota as a warning, never as a pass", () => {
  const report = receiptReport({ receipt: quotaUnverified() }, "advisory");
  expect(report.exitCode).toBe(0);
  expect(report.failures).toEqual([]);
  expect(report.stdout).toEqual([
    "9/9 required steps verified; native quota unverified (native quota policy: advisory)",
    `::warning title=Native quota qualification::${ADVISORY_QUOTA_WARNING}`,
  ]);
  expect(report.stderr).toEqual([]);
  expect(report.stepSummary).toContain(`**Verdict:** ${ADVISORY_QUOTA_WARNING}`);
  expect(report.stepSummary).toContain("9/9 required steps verified; native quota unverified");
  expect(ADVISORY_QUOTA_WARNING).toBe("native quota unverified (non-required, owner decision D2)");
});

test("the advisory policy passes a verified quota without a warning", () => {
  const report = receiptReport({ receipt: passed() }, "advisory");
  expect(report.exitCode).toBe(0);
  expect(report.stdout).toEqual([
    "9/9 required steps verified; native quota verified (native quota policy: advisory)",
  ]);
  expect(report.stepSummary).toContain("**Verdict:** native quota verified");
});

test("the advisory policy tolerates the native quota shortfall and nothing else", () => {
  const missingStep = quotaUnverified();
  missingStep.steps = REQUIRED_STEPS.slice(1);
  const otherCause = quotaUnverified();
  otherCause.quota = { overrideAccepted: true };
  const cases: Array<[{ receipt: unknown } | { failure: string }, string]> = [
    [{ failure: "receipt.missing" }, "receipt.missing"],
    [{ failure: "receipt.unreadable" }, "receipt.unreadable"],
    [{ failure: "receipt.ambiguous" }, "receipt.ambiguous"],
    [{ receipt: { ...quotaUnverified(), status: "failed" } }, "receipt.failed"],
    [{ receipt: missingStep }, "receipt.steps"],
    [{ receipt: otherCause }, "receipt.inconsistent"],
    [{ receipt: null }, "receipt.shape"],
  ];
  for (const [read, code] of cases) {
    const report = receiptReport(read, "advisory");
    expect(report.exitCode).toBe(1);
    expect(report.failures).toEqual([code]);
    expect(report.stdout.join("\n")).not.toContain("::warning");
    expect(report.stderr).toContain(`::error title=Native quota qualification::${code}`);
    expect(report.stepSummary).toContain(`**Verdict:** failed (${code})`);
  }
});

test("receipt text never reaches the report", () => {
  const hostile = quotaUnverified();
  hostile.reason = "::error::injected";
  hostile.quota = { status: "unverified", reason: "::warning::injected\n### injected" };
  const report = receiptReport({ receipt: hostile }, "advisory");
  const everything = [...report.stdout, ...report.stderr, report.stepSummary].join("\n");
  expect(everything).not.toContain("injected");
});

test("the required and non-required reports keep their exit semantics", () => {
  expect(receiptReport({ receipt: quotaUnverified() }, "required").exitCode).toBe(1);
  expect(receiptReport({ receipt: quotaUnverified() }, "required").failures).toEqual([
    "quota.unverified",
  ]);
  expect(receiptReport({ receipt: quotaUnverified() }, "non-required").exitCode).toBe(0);
});

test("only the receipt verifier accepts the advisory policy", () => {
  expect(receiptPolicyArgument(["--native-quota=advisory"])).toBe("advisory");
  expect(receiptPolicyArgument(["--native-quota=required"])).toBe("required");
  expect(receiptPolicyArgument(["--native-quota=advisory", "--native-quota=required"])).toBeNull();
  expect(receiptPolicyArgument(["--native-quota=lenient"])).toBeNull();
  expect(policyArgument(["--native-quota=advisory"])).toBeNull();
});

test("the CLI appends the advisory verdict to the step summary", async () => {
  const root = await mkdtemp(join(tmpdir(), "signalement-receipt-summary-"));
  try {
    const path = join(root, "evidence.json");
    const summary = join(root, "summary.md");
    await writeFile(path, JSON.stringify(quotaUnverified()));
    await writeFile(summary, "previous\n");
    const run = async (target: string) => {
      const child = Bun.spawn(
        [process.execPath, join(import.meta.dir, "receipt.ts"), target, "--native-quota=advisory"],
        { stdout: "pipe", stderr: "pipe", env: { ...process.env, GITHUB_STEP_SUMMARY: summary } },
      );
      return {
        code: await child.exited,
        stdout: await new Response(child.stdout).text(),
        stderr: await new Response(child.stderr).text(),
      };
    };
    const advisory = await run(path);
    expect(advisory.code).toBe(0);
    expect(advisory.stdout).toContain(`::warning title=Native quota qualification::`);
    const written = await Bun.file(summary).text();
    expect(written).toStartWith("previous\n");
    expect(written).toContain(ADVISORY_QUOTA_WARNING);
    // An empty artifact directory: the download succeeded but held no receipt.
    await mkdir(join(root, "empty"));
    const missing = await run(join(root, "empty"));
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("::error title=Native quota qualification::receipt.missing");
    expect(await Bun.file(summary).text()).toContain("failed (receipt.missing)");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the CLI exits nonzero on an unverified quota only under the required policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "signalement-receipt-cli-"));
  try {
    const path = join(root, "evidence.json");
    await writeFile(path, JSON.stringify(quotaUnverified()));
    const run = async (...args: string[]) => {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, "receipt.ts"), ...args], {
        stdout: "pipe",
        stderr: "pipe",
      });
      return {
        code: await child.exited,
        stdout: await new Response(child.stdout).text(),
        stderr: await new Response(child.stderr).text(),
      };
    };
    const lenient = await run(path, "--native-quota=non-required");
    expect(lenient.code).toBe(0);
    expect(lenient.stdout).toContain("9/9 required steps verified; native quota unverified");
    const strict = await run(path, "--native-quota=required");
    expect(strict.code).toBe(1);
    expect(strict.stderr).toContain("quota.unverified");
    expect((await run(path)).code).toBe(2);
    expect((await run(join(root, "missing"), "--native-quota=required")).code).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CI takes the native quota verdict outside the required job, from the same receipt", async () => {
  const workflow = await Bun.file(join(import.meta.dir, "../../.github/workflows/ci.yml")).text();
  const [, afterQuality = ""] = workflow.split("\n  bun-quality:\n");
  const [bunQuality = "", nativeQuota = ""] = afterQuality.split(/(?<=\n) {2}native-quota:\n/);
  expect(bunQuality).toContain("    name: Bun quality\n");
  expect(bunQuality).toContain("bun tools/browser-check/chrome.ts --native-quota=non-required\n");
  expect(bunQuality).not.toContain("--native-quota=required");
  // The required job re-reads the receipt file it publishes: the in-memory
  // verdict of chrome.ts alone passed with no evidence.json in the artifact.
  const [beforePublish = "", publish = ""] = bunQuality.split(
    "      - name: Publish Chrome qualification receipt\n",
  );
  expect(beforePublish).toContain(
    "        run: bun tools/browser-check/receipt.ts test-results/browser-check/chrome --native-quota=non-required\n",
  );
  expect(beforePublish.indexOf("receipt.ts test-results")).toBeGreaterThan(
    beforePublish.indexOf("chrome.ts --native-quota=non-required"),
  );
  expect(publish).toStartWith("        if: always()\n");
  expect(publish).toContain("          name: chrome-qualification-receipt\n");
  expect(publish).toContain("          if-no-files-found: error\n");
  expect(nativeQuota).toContain("    needs: bun-quality\n    if: always()\n");
  expect(nativeQuota).toContain("          name: chrome-qualification-receipt\n");
  expect(nativeQuota).toContain(
    'bun tools/browser-check/receipt.ts "$RUNNER_TEMP/receipt" --native-quota=advisory\n',
  );
  // Non-blocking comes from the verifier tolerating exactly one code, never
  // from the runner: continue-on-error would also swallow a missing receipt.
  expect(workflow).not.toContain("continue-on-error");
});
