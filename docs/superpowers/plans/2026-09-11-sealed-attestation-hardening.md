# Sealed Attestation Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the sealed repository and remote publication proof fail closed against the
counterexamples found during independent review of commit `d50ca5d`, before creating any
remote repository.

**Architecture:** Keep the product repository as the reproducible enforcement boundary.
Use one bounded Git process adapter, a pure content/path policy, an explicit canonical Git
inventory, and a GitHub-specific remote proof whose authenticated network processes are
isolated from credential-free candidate execution. Governance remains the external
authority and retains the final private-state attestation.

**Tech Stack:** Bun 1.4 canary, strict TypeScript, Git plumbing, GitHub REST API, pinned
`@libre-ai/governance@94fc054c6b16e047eb0736e12444a08d50728efc`.

**Spec:** `node_modules/@libre-ai/governance/docs/adr/0038-private-first-repository-publication.md`

## Global Constraints

- Decision order is Security, Quality, Performance, Completeness.
- Tests precede every non-trivial production change and each new test must be observed red.
- Diagnostics never echo a sensitive byte, path, ref, credential, or ambient machine path.
- No new third-party dependency, product runtime, remote repository, provider mutation, or
  visibility change is introduced by this remediation. The existing Governance pin may advance
  only to an immutable reviewed merge that closes a reproduced authority-parser defect.
- The only authorized public Git identity is the exact `Constantin Jais` GitHub noreply tuple.
- Every collection has a fixed policy bound before allocation; increasing a bound is an
  explicit policy change.
- Git metadata output is capped at 16 MiB; reachable bodies at 64 MiB; refs at 1,024;
  commits at 50,000; objects and direct tree entries at 100,000 each; one path component
  at 4,096 UTF-8 bytes.
- Any remediation creates a new commit, digest, review set, and attestation candidate.

---

### Task 1: Fail-closed content and path projection

**Files:**

- Modify: `tools/ci/public-boundary.ts`
- Modify: `tools/ci/public-boundary.test.ts`

**Interfaces:**

- Consume: `containsEmailIdentifier`, `containsCredentialMarker`, and
  `decodeSensitiveMarkers` from the pinned Governance scanner.
- Preserve: `inspectPublicTree(files, options) -> readonly PublicBoundaryFinding[]`.
- Remove: generic `allowedEmails` content exemptions.
- Produce: one internal path projection containing canonical and sensitive decoded forms.

**Steps:**

- [ ] Add red tests for quoted, commented, SMTPUTF8, and domain-literal personal emails.
- [ ] Add red tests for HTML, percent, and default-ignorable path evasions.
- [ ] Add red tests for `.sql`, `data/`, and `exports/`, with a narrow migrations exception.
- [ ] Mask only canonical RFC 2606 dot-atom examples before the pinned email parser.
- [ ] Apply decoded/NFKC projections to traversal, duplicates, PII, extension, and instance rules.
- [ ] Refuse every default-ignorable path and redact sensitive diagnostics.
- [ ] Run `bun test tools/ci/public-boundary.test.ts`.

**Acceptation:** Every reproduced bypass returns a non-sensitive finding; package scopes and
version notation remain accepted; only canonical reserved-domain example addresses pass.

### Task 1A: Integrate the reviewed Governance email authority

**Files:**

- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `tools/ci/public-boundary.ts`
- Modify: `tools/ci/public-boundary.test.ts`

**Authority:** Governance PR #107 merged as
`e115dd1ff40e4e71b9160d263a684024ddba29ed` after an independent ACCEPT on its reviewed candidate
and green GitHub checks.

**Steps:**

- [ ] Re-pin the existing Governance dependency to the reviewed merge commit and install frozen.
- [ ] Replace the local RFC 2606 masking grammar with
      `containsEmailIdentifierExcludingRfc2606Examples(rawSource)`.
- [ ] Preserve raw-source provenance for content and path calls; never pass an already decoded
      projection to the exemption-aware API.
- [ ] Make the mixed-address RED matrix green before removing the obsolete local masking code.
- [ ] Verify the historical Markdown adapter no longer creates a bare-LF false positive.
- [ ] Run the focused boundary suites, typecheck, and executable public-boundary gate.

**Acceptation:** Canonical raw RFC 2606 examples pass; encoded or non-canonical examples and every
adjacent personal identifier fail closed; the repository typecheck has no Task-1 API mismatch
except the explicitly coupled structural-history consumer resolved by Task 3.

### Task 1B: Close the structural Git-identity coupling

**Files:**

- Modify: `tools/ci/public-history.ts`
- Modify: `tools/ci/public-history.test.ts`

**Reason for ordering:** Removing generic content identity exemptions made the existing history
consumer uncompilable and exposed that Git identities and DCO trailers must be parsed as metadata,
not allowlisted as arbitrary text. This structural subset of Task 3 is therefore atomic with Task 1;
the manifest-v2/tree-entry work remains after bounded Git plumbing in Task 2.

**Steps:**

- [ ] Add RED tests for an approved address copied into prose, a non-terminal trailer, malformed
      identity headers, duplicate identity headers, and missing/mismatched DCO.
- [ ] Parse commit/tag headers exactly, including continuation-header boundaries, before accepting
      the nominatively authorized identity tuples.
- [ ] Require and neutralize only the canonical terminal `Signed-off-by` trailer bound to an
      approved identity; scan every other message byte without an email exemption.
- [ ] Remove the obsolete `allowedEmails` consumer and retain the exact legacy policy-blob
      object-ID plus path exception only.
- [ ] Run typecheck, focused history tests, executable history gate, and the complete repository
      gate before review.

**Acceptation:** Approved Git identity headers and the matching terminal DCO are accepted only in
their structural positions; the same address anywhere else is reported as `personal-email`; the
repository has no Task-1 integration failure.

### Task 2: Bounded Git plumbing without index materialization

**Files:**

- Create: `tools/ci/git-process.ts`
- Create: `tools/ci/git-process.test.ts`
- Modify: `tools/ci/check-public-boundary.ts`
- Modify: `tools/ci/check-public-boundary.test.ts`
- Modify: `tools/ci/public-history.ts`

**Interfaces:**

- Produce: `runGitBounded(arguments, options) -> Promise<BoundedCommandResult>` that drains
  stderr, caps stdout while streaming, terminates on overflow, and never returns partial data.
- Produce: strict batch-check and batch-object parsers shared by index and history readers.
- Preserve: `readIndexFiles(root, options) -> Promise<readonly PublicFile[]>`.

**Steps:**

- [ ] Add red tests proving output overflow terminates before unbounded accumulation.
- [ ] Add red tests proving staged blobs are read from object IDs and never via checkout-index.
- [ ] Parse mode, object ID, stage, and path from a bounded `ls-files --stage -z` stream.
- [ ] Batch-check all unique object IDs before reading any content.
- [ ] Batch-read only the blobs allowed by per-file and cumulative limits.
- [ ] Apply bounded process output to refs, raw history, object IDs, metadata, and object bodies.
- [ ] Run focused Git process, boundary CLI, and history suites.

**Acceptation:** Peak returned bytes are bounded by policy plus one stream chunk; no staged
entry is materialized on disk; unsupported modes/stages and malformed records refuse closed.

### Task 3: Structural Git identities and canonical I-30 inventory

**Files:**

- Modify: `tools/ci/public-history.ts`
- Modify: `tools/ci/public-history.test.ts`
- Modify: `tools/ci/check-public-history.ts`
- Modify: `tools/ci/check-public-history.test.ts`
- Create: `schemas/git-object-manifest.v2.schema.json`

**Interfaces:**

- Produce: `PublicGitTreeEntry { treeObjectId, name, mode, type, objectId }`.
- Extend: `PublicHistoryManifest` with repository and explicit deterministic tree entries.
- Produce: strict commit/tag parsing that separates identity headers, other headers, and message.
- Preserve: exact identity tuple validation and immutable root-policy-blob exception.

**Steps:**

- [ ] Add red tests for an approved address reused in prose, malformed DCO, and non-DCO trailers.
- [ ] Add red tests for repository omission and historical tree-entry omission from the manifest.
- [ ] Parse exact Git identity headers; neutralize only exact approved identity headers and a
      terminal canonical `Signed-off-by` trailer before content scanning.
- [ ] Parse every reachable raw tree object with strict six-digit mode, object-ID width,
      direct UTF-8 component name, mode/type coherence, and count bounds.
- [ ] Include `gitObjectFormat: sha1`, repository, refs, objects, and tree entries in the
      `libre-ai.git-object-manifest.v2` canonical JSON and UTF-8-sort every set.
- [ ] Add a closed JSON Schema whose nested objects all use `additionalProperties: false`.
- [ ] Document that the SHA-256 covers the canonical inventory; provenance and verdicts live in
      the external Governance attestation to avoid self-reference.
- [ ] Run the full public-history suite and verify the root commit remains accepted.

**Acceptation:** The manifest explicitly names `libre-ai/signalement` and every reachable tree
entry; an approved email is accepted only in validated Git identity/DCO structure.

### Task 4: Exact remote snapshot, isolated credentials, and provider policy

**Files:**

- Modify: `tools/publication/remote-attestation.ts`
- Modify: `tools/publication/remote-attestation.test.ts`
- Modify: `tools/publication/check-remote-attestation.ts`
- Modify: `tools/publication/check-remote-attestation.test.ts`
- Create: `tools/publication/github-policy.ts`
- Create: `tools/publication/github-policy.test.ts`

**Interfaces:**

- Produce: a paginated API-ref reader for authenticated and anonymous modes.
- Produce: separate `networkEnvironment` accepting only
  `SIGNALEMENT_GITHUB_READ_TOKEN` and credential-free `executionEnvironment`.
- Produce: `GitHubPolicySnapshot` parsers and an exact expected-policy comparator.
- Preserve: exact expected head, manifest digest, visibility, and generic non-leaking CLI failure.

**Steps:**

- [ ] Add red tests for page 101+, wildcard-fetch omission, credential inheritance, and remote mutation.
- [ ] Add red provider-policy fixtures covering branch protection, required checks, Actions SHA
      pinning/allowlist, vulnerability reporting, and available secret-scanning controls.
- [ ] Require a repository-scoped, read-only, ephemeral GitHub App or fine-grained token outside
      the clean room; expose it only to Git/API read processes and verify its effective permissions.
- [ ] Run dependency installation and all repository gates with a clean HOME and no token,
      credential helper, proxy, package-manager auth, or SSH agent.
- [ ] Fetch `+refs/*:refs/*`, enumerate the resulting mirror, and compare Git/API/mirror sets.
- [ ] Read every anonymous API page until a short page; reject at a fixed maximum page count.
- [ ] Read and compare refs, API refs, visibility, and provider policy both before and after the gate.
- [ ] Run all publication tests without contacting GitHub.

**Acceptation:** The private credential cannot reach candidate code; public mode is anonymous;
initial snapshot, mirror, final snapshot, and expected policy are exactly equal or the proof fails.

### Task 5: Executable local TOCTOU and truthful runbook

**Files:**

- Create: `tools/publication/check-local-candidate.ts`
- Create: `tools/publication/check-local-candidate.test.ts`
- Create: `schemas/repository-publication-attestation.v1.schema.json`
- Modify: `package.json`
- Modify: `docs/runbooks/private-first-publication.md`

**Interfaces:**

- Produce: `check:local-candidate --expected-head <oid> --expected-manifest-sha256 <sha256>`.
- Consume: the canonical history inspector and exact-ref policy.

**Steps:**

- [ ] Add red CLI tests for dirty state, head mismatch, extra ref, and digest mismatch.
- [ ] Implement a generic-error CLI that verifies the worktree, ref, head, and manifest immediately.
- [ ] Place the command immediately before the exact-OID leased push in the runbook.
- [ ] Correct the preamble so only pre-exposure failures are described as remaining private.
- [ ] State the external attestation envelope fields: inventory, digest, tool versions, commands,
      UTC timestamp, provider snapshot, positive verdicts, and negative counterproofs.
- [ ] Add the non-recursive `libre-ai.repository-publication-attestation.v1` JSON Schema:
      it embeds the v2 manifest and its SHA-256, while its own timestamp, commands, evidence
      digests, provider snapshot, tool versions, and verdicts remain outside that digest.

**Acceptation:** Following the runbook cannot skip the final local equality check, provider policy
readback, or frozen-private recheck.

### Task 6: Seal and independently review the replacement candidate

**Files:**

- Verify: every file modified by Tasks 1–5.

**Steps:**

- [ ] Run `bun install --frozen-lockfile`.
- [ ] Run `bun run check` and retain exact counts.
- [ ] Run `bun audit --json` and require an empty result.
- [ ] Run the external canary and require refusal without content/path leakage.
- [ ] Run `git diff --check`, `git fsck --full --strict`, and enumerate exact refs.
- [ ] Commit with the personal public noreply identity and DCO sign-off.
- [ ] Rerun the full gate on the immutable commit and emit its canonical manifest externally.
- [ ] Obtain independent architecture, doctrine, and security ACCEPT verdicts on the same SHA.

**Acceptation:** One clean `refs/heads/main` candidate has green complete gates, an empty audit,
an external canonical manifest, and three independent ACCEPT verdicts. Only then may the separate
owner-authorized empty private repository creation begin.
