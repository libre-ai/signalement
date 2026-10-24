# v1.0 local governance review evidence — 2026-10-24

These independent read-only reviews bind conclusions to the SHA-256 of each listed
source file, not to a branch name. They cover the L0 "local governance" lot of
`signalement` v1.0: documentation, the project card, the qualification baseline and
the v1.0 product scope.
They are not product promotion, provider or browser qualification, or proof of
owner consent. A changed hash requires a scoped recheck before relying on the
corresponding conclusion.

## Files

- `governance-review-pass-1.json`: pass 1, head `dcbd2e9`, verdict `fail`. Seven
  findings (F1 important, F2 to F7 minor).
- `governance-review-pass-2.json`: pass 2, head `bd822bd`, verdict `pass`. Resolves
  F1 to F4, F6 and F7 (F7 in part), keeps F5 open, and adds F8 and F9.
- `governance-review.json`: pass 3 (the current record), head `3af298a`, verdict
  `pass`. Resolves F9, keeps F5 and F8 open, and adds F10 and F11.

The three JSON files are the reviewer's output, byte for byte (single-line JSON).
None was edited by the author. `biome.json` carries an override that disables the
formatter for the paths matching `docs/reviews/v1-governance-*/governance-review*.json`
only, so the lint gate does not demand a reformat that would change the bytes; the
linter still runs on them.

Pass 3 lists 15 source files with their SHA-256. Replaying them is:

```sh
jq -r '.sourceHashes | to_entries[] | "\(.value)  \(.key)"' \
  docs/reviews/v1-governance-20261024/governance-review.json | shasum -a 256 -c
```

Files covered by pass 3 (branch `work/v1-l0-governance`, base `950135d`):

- `README.md` (regenerated status section)
- `docs/adr/0005-local-vault-and-reviewed-export.md`
- `docs/adr/0006-policy-routed-fan-out-and-signed-receipts.md`
- `docs/superpowers/specs/2026-10-22-v1-policy-routed-ticket-projection-design.md`
- `project.v1.yaml`
- `qualification/acceptance-catalog.yaml`, `assumptions.yaml`, `browser-matrix.yaml`,
  `decision-lock.yaml`, `product-scope.yaml` (added in pass 3), `provider-matrix.yaml`,
  `risk-register.yaml`, `threat-model.yaml`
- `tools/ci/project-card.test.ts`, `tools/ci/qualification-v1.test.ts`

The authority is ADR-0055 of `libre-ai/project-governance` at
`84c0e6d634cc845452bddf7864977547b1a96455` (PR #134, register entry D94).

## Pass 1 and its resolution

Pass 1 returned `fail` on one important and six minor findings. Commit `bd822bd`
addresses them; pass 2 confirms:

- F1 (important, `capability-overclaim`): the `verified` assumption
  `gitlab-project-token-tier` claimed an unproven property (the GitLab profile needs
  no paid subscription). The clause is removed and the GitLab documentation URL is
  cited. Resolved.
- F2: "au rôle minimal" in design §5.6 went beyond the recorded owner decision.
  Removed. Resolved.
- F3: an unsourced refusal sentence in ADR-0006 D4. Removed. Resolved.
- F4: two owner decisions of 2026-10-24 sat under D12. They now have their own
  subsection, "Owner decisions of 2026-10-24". Resolved.
- F6: grammar in ADR-0006 D9. Resolved.
- F7: no test kept the new provider rows from being promoted. A test asserting that
  none of the four v1.0 rows is `verified` was added. Resolved in part by ruling: no
  test freezes the `unresolved` rows or the `pending` criteria, because those
  statuses are meant to change.
- F5: partly fixed by the new ADR-0006 paragraph on the agent choices of design §9;
  still open after pass 3 (below).

## Pass 3 and its resolution

Pass 3 returned `pass` on head `3af298a`, which adds five v1.0 product-scope entries
to `qualification/product-scope.yaml` (`v1-projection-only`, `v1-buyer`,
`linear-target`, `standalone-cli`, `multi-organization-operator`). The scope grows
from 14 to 15 files.

- F9: resolved. The pull request description states the neutralization run and both
  gate-integrity answers for the test "no v1.0 provider row is verified before its
  qualification". Answer (2) relies on a `qualified` status that the validator does
  not accept yet; the roadmap records that L5 adds it. The commit `bd822bd` is not
  edited.

## Findings still open after pass 3

Four minor findings remain open for the owner (F5, F8, F10, F11). None blocks the
pass verdict.

- F10 (new in `3af298a`): the second clause of the `v1-projection-only` reopen
  trigger, "or a v1.0 release candidate with fewer than four profiles qualified",
  treats a qualification shortfall as a reason to reopen the scope decision. Design
  D13 records the opposite: with fewer than four qualified profiles, v1.0 does not
  ship. Fix: drop the clause, or reword it so that a shortfall blocks the release
  and does not reopen the entry.
- F11 (new in `3af298a`): the `v1-projection-only` statement lists the four exact
  profile ids under an anchor, D13, that names only the families and instances. The
  ids are in ADR-0006 "Contracts", the design §5.6 and the provider matrix. The
  entry claims nothing false. Fix: remove the ids from the statement, or note that
  they come from ADR-0006 "Contracts".

- F5: the ADR-0006 paragraph that marks agent choices of design §9 as endorsed
  through the design approval names six. ADR-0006 restates at least four more
  (the "N exclue(s)" counter, authenticated-link delivery of media, a revision
  becoming a comment, the `destination-disclosure-leak` predicate) and the ADR-0005
  amendment carries a fifth (editor-prepared delivery, chunking, a service worker
  holding nothing) without the marker. The paragraph also lists "refusal of
  non-conforming instances", which no part of the ADR body records. Fix: extend the
  paragraph to every restated choice and drop the unrecorded one, or mark each
  sentence where it appears.
- F8: the ADR-0006 header attributes the supersession of design §5.5 to owner
  decisions of 2026-10-24. The only §5.5 change (an unreadable visibility withholds
  the destination, reason `visibility-unknown`) comes from the "Visibilité
  illisible" bullet of roadmap §4.2, which is not labelled as an owner decision. The
  change is stricter than the approved design and matches its §7 test. Fix: name it
  a roadmap clarification in the header, or have the owner label it.

## What this review does not prove

- No provider qualification (GitHub, GitLab.com, Jira Cloud, Plane) and no browser
  qualification. The four v1.0 provider rows stay `unresolved`.
- No validity of the documentation measurements dated 2026-10-24 (GitLab project
  access token tier, Atlassian search and reconcile). The reviewer could not re-read
  those external pages.
- No owner consent and no owner arbitration. ADR-0006 and the ADR-0005 amendment are
  `proposed` and take effect only at the owner's merge of the pull request that
  carries them. The reviewer wrote no `Owner-arbitration:` line, and neither did the
  author.
- No neutralization run by the reviewer. The reviewer was read-only; the
  neutralization outputs are in the commit messages and the pull request description.
- Implementers' reports and per-lot plan files were not read by the reviewer.

## Guards on these paths

The review gate of the fleet (`tools/quality/check-review-evidence.ts` of
`project-governance`) is run only by that repository's own workflow; no workflow of
`signalement` calls it. The required checks on `main` are `Bun quality` and
`licensing / Licensing and contribution governance`, and there is no ruleset. The
requirement of a review artifact on `docs/adr/**`, `project.v1.yaml` and
`qualification/**` therefore holds through the pull request and the owner's merge,
not through a mechanism that blocks.

Known defect, not fixed here: at the pinned revision, `check-review-evidence.ts:96`
looks for the arbitration marker in the whole diff text, context lines included
(`findEvidenceSignals("diff", diffText)`, `:118`). A green result of that gate does
not prove that the pull request added a marker; a neighbouring line already merged
can supply it. The served head of `project-governance` documents a correction dated
2026-10-23 (added lines only; the cited artifact must exist in the tree).
`signalement` does not benefit from it until its pin moves, and does not run the
gate in any case.

## Provenance

All three passes record the provider and model as observed (`Anthropic`,
`claude-opus-5-5`) under a role name; no machine path is stored. Agent identity is
review provenance, not a runtime dependency.
