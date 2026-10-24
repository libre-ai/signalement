import { describe, expect, test } from "bun:test";
import { join } from "node:path";

interface Entry {
  readonly id: string;
  readonly status: string;
  readonly statement: string;
  readonly source: string;
  readonly profile?: string;
}
interface Document {
  readonly entries: readonly Entry[];
}

const ROOT = join(import.meta.dir, "..", "..");

async function entries(path: string): Promise<readonly Entry[]> {
  const parsed = Bun.YAML.parse(await Bun.file(join(ROOT, path)).text()) as Document;
  return parsed.entries;
}

// Roadmap §4.1: exact v1.0 profile identifiers. A matrix row keeps its family id
// (SAFE_ID forbids "/"). L0 binds the profile through the statement prefix; L5 adds
// a `profile` field (roadmap §4.5), which then takes precedence.
const V1_PROFILES = {
  "github-issues": "github-issues/github.com/rest-2022-11-28",
  "gitlab-issues": "gitlab-issues/gitlab.com/rest-v4",
  "jira-cloud": "jira-cloud/cloud/rest-v3",
  plane: "plane/self-hosted/rest-v1",
} as const;

describe("v1.0 qualification links", () => {
  test("each v1.0 provider row is bound to its exact registry profile", async () => {
    const rows = await entries("qualification/provider-matrix.yaml");
    for (const [family, profileId] of Object.entries(V1_PROFILES)) {
      const row = rows.find((entry) => entry.id === family);
      const bound = row?.profile ?? row?.statement.split(": ", 1)[0];
      expect(bound).toBe(profileId);
    }
  });

  test("destination-disclosure-leak resolves to a catalog entry bound to the card", async () => {
    const card = Bun.YAML.parse(await Bun.file(join(ROOT, "project.v1.yaml")).text()) as {
      kill_predicates: readonly { id: string; source: string }[];
    };
    const predicate = card.kill_predicates.find(
      (entry) => entry.id === "destination-disclosure-leak",
    );
    expect(predicate?.source).toBe("qualification/acceptance-catalog.yaml");
    const catalog = await entries("qualification/acceptance-catalog.yaml");
    const linked = catalog.find((entry) => entry.id === "withheld-file-never-sent");
    expect(linked?.source).toBe("project.v1.yaml#kill_predicates");
  });
});
