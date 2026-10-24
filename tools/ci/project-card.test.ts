import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { checkStatusSection, validateCard } from "@libre-ai/governance/ecosystem/project-cards";

interface Criterion {
  readonly id: string;
  readonly text: string;
}
interface Phase {
  readonly id: string;
  readonly exit_criteria: readonly Criterion[];
}
interface KillPredicate {
  readonly id: string;
  readonly source: string;
}
interface Card {
  readonly phases: readonly Phase[];
  readonly kill_predicates: readonly KillPredicate[];
}

const ROOT = join(import.meta.dir, "..", "..");
const rawCard: unknown = Bun.YAML.parse(await Bun.file(join(ROOT, "project.v1.yaml")).text());
const card = rawCard as Card;

// Design §7 and roadmap §5: the identifiers lots L2 to L7 cite, with their phase.
const V1_CRITERIA = [
  { phase: "capture-qualification", id: "browser-matrix-real" },
  { phase: "capture-qualification", id: "exact-disclosure-preview" },
  { phase: "capture-qualification", id: "gesture-bound-delivery" },
  { phase: "multi-system-projection", id: "two-real-profiles" },
  { phase: "multi-system-projection", id: "fanout-independent-state" },
  { phase: "multi-system-projection", id: "policy-routing" },
  { phase: "multi-system-projection", id: "signed-receipt-offline" },
  { phase: "multi-system-projection", id: "stale-plan-refused" },
] as const;

const V1_KILL_PREDICATES = [
  "destination-disclosure-leak",
  "duplicate-external-item",
  "cross-organization-disclosure",
  "capability-overclaim",
] as const;

function criterion(id: string): Criterion | undefined {
  return card.phases.flatMap((phase) => phase.exit_criteria).find((entry) => entry.id === id);
}

describe("project.v1.yaml", () => {
  test("passes the fleet card schema", () => {
    expect(validateCard(rawCard)).toEqual([]);
  });

  test("carries every v1.0 criterion in its declared phase", () => {
    for (const { phase, id } of V1_CRITERIA) {
      const owner = card.phases.find((entry) => entry.id === phase);
      expect(owner?.exit_criteria.map((entry) => entry.id)).toContain(id);
    }
  });

  test("criterion ids are unique across phases", () => {
    const ids = card.phases.flatMap((phase) => phase.exit_criteria.map((entry) => entry.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("two-real-profiles names the four D3 profiles", () => {
    const text = criterion("two-real-profiles")?.text ?? "";
    for (const family of ["GitHub Issues", "GitLab Issues", "Jira Cloud", "Plane"]) {
      expect(text).toContain(family);
    }
  });

  test("browser-matrix-real covers observed origin and delivery", () => {
    const text = criterion("browser-matrix-real")?.text ?? "";
    expect(text).toContain("origine observée");
    expect(text).toContain("remise");
  });

  test("declares the v1.0 kill predicates", () => {
    const ids = card.kill_predicates.map((entry) => entry.id);
    for (const id of V1_KILL_PREDICATES) expect(ids).toContain(id);
  });

  test("every kill predicate source resolves", () => {
    for (const { source } of card.kill_predicates) {
      expect(existsSync(join(ROOT, source.split("#", 1)[0] ?? ""))).toBe(true);
    }
  });

  test("README status section matches a fresh render of the card", async () => {
    const readme = await Bun.file(join(ROOT, "README.md")).text();
    expect(checkStatusSection(readme, rawCard)).toEqual([]);
  });
});
