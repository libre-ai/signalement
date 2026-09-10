# Private-first publication runbook

This runbook implements Governance ADR-0038/I-30 for the one-time first publication of
`libre-ai/signalement`. It does not make repository creation or visibility changes
autonomous: both remain explicit owner actions. A failure leaves the repository private.

## 1. Immutable local candidate

The candidate must have only `refs/heads/main`, a clean worktree, an approved exact
contributor identity, and a green complete gate:

```sh
git for-each-ref --format='%(refname) %(objectname)'
git status --short
bun install --frozen-lockfile
bun run check
bun tools/ci/check-public-history.ts --ref refs/heads/main --print-manifest
```

Retain the canonical manifest and its SHA-256 outside the product repository. Any
remediation creates a new candidate and invalidates earlier reviews and manifests.

## 2. Empty private GitHub repository

Verify the personal identity, organization role, signed enrollment, and name absence.
After explicit owner authorization, create no starter commit, branch, tag, import, or
generated file:

```sh
gh auth status
gh api user --jq '{login,id}'
gh api orgs/libre-ai/memberships/constantin-jais --jq '{state,role}'
gh repo create libre-ai/signalement --private \
  --description "Specification and security foundation for open incident reporting, reproduction, fix verification, and multi-system projection."
```

Prove that both Git and the GitHub Git Data API expose zero refs before the first push:

```sh
git ls-remote --symref https://github.com/libre-ai/signalement.git
gh api --paginate --slurp \
  'repos/libre-ai/signalement/git/matching-refs/?per_page=100'
```

Expected: no Git advertisement lines and an API result containing no ref entry. Any ref
blocks the first push.

## 3. Exact first push

Push the immutable candidate OID, never the mutable branch name. The empty expected value
in the lease refuses a pre-existing `refs/heads/main`:

```sh
git push https://github.com/libre-ai/signalement.git \
  <ATTESTED_COMMIT_OID>:refs/heads/main \
  --force-with-lease=refs/heads/main:
```

Do not add a local remote or use `-u`: the sealed local repository must not gain tracking
refs that would change its allowlisted ref set.

## 4. Private protections and mirror proof

Before any public exposure, configure and read back:

- pull requests required for `main`, required green checks, no force push, no deletion,
  no bypass actor;
- DCO enforcement through the pinned reusable licensing workflow;
- the maximum GitHub secret-scanning and push-protection capabilities actually available
  to the organization plan; an unavailable required control remains a blocker;
- private vulnerability reporting before the public issue tracker can receive traffic;
- Actions permissions restricted to the pinned workflows in the committed tree.

Then run the executable proof. It compares the Git advertisement with the paginated
GitHub API inventory, creates a bare non-shallow mirror with exact `+refs/*:refs/*`
semantics, runs strict `git fsck`, compares the complete ref/object manifest, checks out
the exact OID, installs the locked graph, and runs the full gate:

```sh
bun run check:remote-attestation -- \
  --expected-head <ATTESTED_COMMIT_OID> \
  --expected-manifest-sha256 <ATTESTED_MANIFEST_SHA256> \
  --expected-visibility private
```

The command is bootstrap-specific and rejects every remote ref other than the exact
initial `refs/heads/main`.

## 5. Governance attestation and public exposure

Archive the canonical manifest, command results, provider-policy snapshot, negative
counterproofs, and independent architecture, security, quality, and sovereignty reviews
under `libre-ai/governance/docs/reviews/signalement-bootstrap/<candidate-oid>/`.

Its owner merge signs the exact private state. Only then:

1. freeze every writer, workflow, token, and bypass path;
2. rerun the Git advertisement, GitHub API, policy, mirror, full-gate, and negative proofs;
3. obtain explicit owner authorization for `private -> public`;
4. change visibility without changing a Git ref;
5. run the same remote attestation with `--expected-visibility public` from a credential-free
   environment, plus an anonymous fresh fetch and checkout;
6. promote `project.v1.yaml` from `idea` to `spec-published` only after that proof.

Returning the repository to private cannot undo disclosure. A mismatch after exposure is
an incident requiring containment and credential rotation, not a rollback success.
