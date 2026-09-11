# Product session handoff

## Purpose and current truth

The next session develops the addon and the user journey. The owner approved starting
with a reviewed, locally persistent, portable Dossier on Chrome, Firefox, and Safari.
The repository currently contains specifications and repository enforcement tooling;
it contains no installable extension or qualified runtime capability.

Read `AGENTS.md`, `project.v1.yaml`, the foundation specification, ADR-0002,
`qualification/acceptance-catalog.yaml`, and the browser matrix before implementation.
Use `product-session.prompt.md` as the entry point. The standalone qualification prompt
is not a prerequisite: qualify the remaining material questions inside this delivery.

## First delivery boundary

Deliver this actual journey on a synthetic test application:

Open extension → voluntarily capture → describe expected and observed behavior →
annotate or redact → inspect the exact export → save and resume → export Dossier.

Include punctual screenshot capture without a preceding recording, partial capture,
annotation, crop and masking, voluntary tab video with visible recording state,
pause/stop and explicit audio choice (off by default), filtered technical context,
and persistent local drafts. Separate screenshot, video and interaction-journal
capabilities. Test each browser's actual limitations and display partial collection.
Never silently remove a requirement because one browser needs a different adapter.

The local export contains Markdown, a versioned manifest, approved attachments and
available context. Scenarios and execution results are absent until implemented;
absence must not be represented as a successful verification. The export must be
readable without the service. Inspect existing `libre-ai/contracts` authority before
defining a public format; an unavailable authoritative contract is an explicit
dependency, not permission to invent a competing public schema.

## Ordered work packages

1. **Browser qualification and executable plan.** Inspect available Chrome, Firefox,
   Safari, macOS and build tools; record exact versions. Verify official APIs and build
   executable probes for capture, recording lifecycle, permissions and draft storage.
   Produce a written implementation plan with exact owned paths and test commands.
   Close reversible details autonomously; escalate only consequential unresolved choices.
2. **Fixture and shared domain.** Create a deterministic test application with a known
   defect, synthetic sensitive canaries and expected results. Define internal Dossier,
   capture, redaction and export behavior against the authoritative contracts. Bound
   collection size and retention; define deletion and storage-failure behavior.
3. **Installable adapters and review journey.** Implement the shared core and actual
   Chrome, Firefox and Safari packages, review UI, annotation/redaction, recording and
   crash-safe drafts. Integrate early on all three branded browsers.
4. **Portable export and adversarial acceptance.** Export only approved bytes; prove
   redaction is applied to exported artifacts, not merely drawn over a UI preview.
   Exercise denied/revoked permissions, navigation, interrupted recording, storage
   exhaustion, restart and deletion. Document unresolved video/audio redaction limits;
   when exact sanitization is unavailable, permit removal and refuse unsafe export.
5. **Independent review and handoff.** Run the relevant gates, obtain an independent
   review of the immutable implementation, remediate findings, and provide installation
   instructions and a reproducible walkthrough. Update qualification records only from
   actual evidence. Use `session-conclusion.prompt.md` to close the session.

Proposed ownership follows the foundation topology: `apps/extension-chrome/`,
`apps/extension-firefox/`, `apps/extension-safari/`, `packages/capture-core/`,
`packages/domain/`, and `tests/`. The implementation plan assigns exact files after
the probes; these directories are not claims that code already exists.

## Acceptance evidence

| Requirement | Required evidence |
| --- | --- |
| Three browsers | Install and execute on pinned branded Chrome, Firefox and Safari; WebKit alone is insufficient. |
| Voluntary capture | No collection before activation; permission refusal and revocation handled visibly. |
| Exact review | Export preview and exported approved bytes agree; removed evidence never enters the export. |
| Confidentiality | Synthetic secrets absent from exports and logs; redaction tested on actual artifacts. |
| Persistence | Draft survives extension/browser restart; failed writes are visible and recoverable. |
| Portability | Fresh consumer reads Markdown, manifest and attachments without the service. |
| Boundaries | Page content cannot trigger agent actions, disclosure or extension privileges. |
| Accessibility | Core journey works by keyboard with labelled controls and accessible state feedback. |
| Resource use | Capture CPU, memory and output size measured on documented fixtures; bounds tested. |

Keep synthetic capture outputs in ignored test artifacts, never in Git. Commit fixture
source and reproduction commands. Record counts and limitations without exposing local
paths, accounts, page data or machine identifiers in public evidence.

## Coordination and subsequent product lots

One lead owns shared contracts and integration. Parallel agents are authorized for
independent browser adapters after the shared interface is fixed, and for independent
review. Give each agent explicit file ownership and prohibit reverting others' work.

After the first lot, the sequence is: two real provider projections with independent
delivery receipts and duplicate-safe recovery; approved scenario and fail-then-pass
verification; bidirectional field authority and enterprise adapters; broader connector
qualification. RAG and drafting remain optional. Do not choose the second real provider
or a conflict authority implicitly while implementing local capture.

## Separate publication workstream

Recheck all status claims. At handoff, local history inspection is known to reject old
test blobs with one generic `personal-email` finding although the current tree gates
passed. This is a publication blocker, not a qualified exception. Do not weaken the
scanner, rewrite history, publish, merge a red candidate, or claim the full gate green.
Local implementation and tests can continue while that blocker remains explicit.

The GitHub App/PAT decision and remaining remote attestation work are separate from
addon delivery. No remote creation or visibility change is part of this session.
Extra worktree refs can violate the bootstrap exact-ref policy: inspect current policy
before creating a worktree; never relax it for convenience. Documentation-only handoff
does not require one.

Use only the approved personal identity. Verify repository-local Git attribution and
GitHub account before any authorized commit or provider operation; never inherit a
professional account or change global authentication to make a command pass.
