# Local capture, review, and portable export

## Intent and provenance

The owner requested continued delivery on 2026-10-06, including the canonical
contract in Contracts and actual browser addons. The accepted foundation and
`docs/runbooks/product-session.md` define the journey. This specification refines
that first local journey; it does not activate connectors, scenarios or verdicts.
The inspected product base is `0d3d3044b67297cef00be15e8fb4b751dd1df5bb`.

## Components and boundaries

- `packages/capture-core/`: browser-independent capture lifecycle, quotas, immutable
  artifact transformations and explicit approval invalidation.
- `packages/domain/`: local draft state and approved export assembly against a
  byte-exact, revision-pinned Contracts authority. No competing public schema.
- `apps/extension-shared/`: accessible popup and durable editor, with text entered
  by the user distinct from observations collected by an adapter.
- `apps/extension-chrome/`, `apps/extension-firefox/`, `apps/extension-safari/`:
  actual manifests, platform adapters and Safari native packaging.
- `tools/probes/` and `tests/fixtures/capture-app/`: branded-browser capability
  evidence using only synthetic pages and ignored output artifacts.

One-shot capture starts only after the capture control is invoked. Opening the
extension alone does not collect anything. The adapter binds the original tab and
window before opening an editor so that the editor is never mistaken for the target.
Unsupported URLs, revoked permission and a changed target produce visible refusals.
There are no cookie, request-body or authorization-header permissions.

Screenshot editing uses real pixel transforms: crop, opaque mask, then annotation.
The reviewed derivative is an immutable byte sequence. Later edits invalidate its
approval. The original stays in encrypted local quarantine until explicit deletion
or expiration, never in the export. Video is a separate capability with visible
start/pause/stop, a bounded duration and explicit audio choice, off by default.
An artifact whose complete content cannot be reviewed or safely sanitized must be
removed from the export; a successful API call is not sanitization evidence.

## Persistence and resource bounds

Draft storage has atomic writes, version conflict detection and explicit failure
states. Persisted draft contents and raw artifacts are encrypted. The owner selected passphrase unlocking on 2026-10-07. The derived key is
non-extractable and retained only in memory; restarting or locking requires
unlocking again. A forgotten passphrase cannot be recovered. Ciphertext does
not hide its total size and does not prevent rollback of a complete old vault.

Initial implementation limits are 16 MiB per screenshot, 64 MiB per video,
128 MiB per draft, 256 MiB total local ciphertext, and 60 seconds per recording.
Drafts expire after 24 hours by default; a user may select up to seven days.
Expiration is checked before access and during maintenance. Closed browsers cannot
perform timed erasure: expired bytes are removed when the extension next runs.
Quota and interrupted-write tests must prove the previous durable draft survives.

## Exact local export

The canonical v1 authority is locked in `libre-ai/contracts` at
`812c7d8b64976054201a0da6a3af2ce93bf9cc0b` (PR 19). Its three specialized reviews
and independent promotion review preserve the candidate normative bytes. The product
vendors exact authority files and gates their hashes; contract integrity does not
qualify browser capture or prove human consent.

The logical bundle contains Markdown, manifest and approved media. Its approval
binds exact payload and file digests, a Dossier revision and the local-export target.
A digest proves integrity, not the identity or intent of a human. Free text remains
untrusted data. Filenames are generated opaque paths; originals and undeclared files
are excluded. A fresh independent consumer verifies the complete file inventory,
lengths, hashes and contract without contacting Signalement.

## Acceptance

Install and execute on branded Chrome, Firefox and Safari. A package build or
Playwright WebKit run does not qualify Safari. Record separate results for screenshot,
video, audio, permission lifecycle, persistence and deletion. Test synthetic
credentials, page-driven messages, navigation races, restart, exhausted storage and
interrupted recording. Export bytes must match the exact review snapshot. Core
controls must work by keyboard, have accessible names, and announce errors.

No capability becomes qualified on the basis of this document or a probe scaffold.
