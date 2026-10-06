# Post-publication development

## Provenance and acceptance

The user authorized continued delivery after the publication status review on
2026-10-06. The inspected starting revision is
`8b02f8e61e1675948caaea5be3c57a898cbd624b`. The original publication copies remain
immutable. The development checkout starts clean and its baseline tree gate passes.

Publication is complete; the installable product remains unimplemented. An installed
browser is not a qualified browser. A Dossier contract was not found in the current
contracts catalog; its ownership decision is pending and blocks public export design.

## Implementation sequence and ownership

1. Development CI worker owns `tools/ci/development-history.ts`, its tests, its CLI,
   `package.json`, and `.github/workflows/ci.yml`. Test the PR merge tree, then verify the exact PR head or push
   revision in an isolated audit repository containing only the selected history.
   Keep the first-publication ref inventory gate unchanged. Reject incomplete or
   rewritten input history. Never delete refs from the source checkout.
2. Coordinator owns `tools/ci/public-history.ts`, its existing tests, and public
   policy. Correct manifest key ordering with an independent canonicalization oracle.
   If needed for normal forge merges, permit the exact technical forge committer
   only in development mode: approved human author and terminal DCO remain mandatory.
3. Documentation worker owns the README, project card and product runbooks. Replace
   obsolete sealed-repository status with attested publication evidence. Keep all
   unqualified product capabilities explicitly pending. Update generated card text
   with the repository's renderer and validate the result.
4. Run staged-tree checks, development history checks on the actual commit, and an
   independent security review. Open a normal PR, run hosted CI and retain protections.
5. Qualify real browser APIs and write the extension implementation plan after the
   portable-contract boundary is resolved. Do not claim extension delivery here.

## Test layers

- Unit: canonical JSON oracle, role-specific identity rejection and DCO controls.
- Integration/E2E: real temporary Git repositories, branch and detached heads,
  historical sensitive fixture rejection, shallow/replace/graft rejection, source
  refs unchanged, revision mismatch and cleanup on failure.
- Regression: the complete existing tree suite and strict bootstrap tests.
- Hosted: required licensing and Bun quality checks against the PR revision.

## Review focus

1. A PR merge pseudo-commit must not replace the authored revision being audited.
2. A technical committer exception must not authorize authors or arbitrary emails.
3. Git environment/configuration must not conceal ancestors or substitute objects.
4. A passing development audit must not be presented as an exhaustive remote-ref
   publication attestation.
5. Published project status must distinguish attested specifications from qualified
   capture, export, connectors, and deterministic verification.

No force push, protection relaxation, new runtime dependency or public schema is
part of this increment. Historical attestations retain their original digests.
