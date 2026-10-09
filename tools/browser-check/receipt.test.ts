import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  NATIVE_QUOTA_STEP,
  REQUIRED_STEPS,
  readReceipt,
  receiptFailures,
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
  const publish = bunQuality.split("      - name: Publish Chrome qualification receipt\n")[1] ?? "";
  expect(publish).toStartWith("        if: always()\n");
  expect(publish).toContain("          name: chrome-qualification-receipt\n");
  expect(publish).toContain("          if-no-files-found: error\n");
  expect(nativeQuota).toContain("    needs: bun-quality\n    if: always()\n");
  expect(nativeQuota).toContain("          name: chrome-qualification-receipt\n");
  expect(nativeQuota).toContain(
    'bun tools/browser-check/receipt.ts "$RUNNER_TEMP/receipt" --native-quota=required\n',
  );
});
