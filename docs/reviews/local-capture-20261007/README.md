# Implementation review evidence — 2026-10-07

These independent read-only reviews bind conclusions to the SHA-256 of each listed
source file, not to an uncommitted branch name. They are implementation reviews, not
product promotion, browser qualification or proof of human consent. A changed hash
requires a scoped recheck before relying on the corresponding conclusion.

- `storage-review.json`: identity snapshot race, owned plaintext lifetime, resource
  bounds, capture authorization and distributable license notices.
- `export-review.json`: canonical authority pin, immutable snapshot, ZIP/parser
  identity, independent JCS/hash oracle and 1,704 adversarial archive mutations.

- `ui-video-review.json`: capture/save generation races, approval invalidation,
  track lifetime, derivative pixels and separate audio consent.
- `ui-video-delta-review.json`: decoder teardown, encrypted media flags and
  explicit native recording MIME selection.

- `codecname-review.json`: narrowly bounded Firefox metadata removal, unknown-ID
  refusal and reproducible binding to the successful native video fixture.

## Status on 2026-10-09: `export-review.json` is stale for four files

The review's authority, `libre-ai/contracts@812c7d8b`, was deleted; the contract
was republished byte-identical in `libre-ai/schemas-and-contracts` and re-pinned.
Four of its 22 listed hashes no longer match the tree:
`tools/contracts/check-drift.ts` (now also refetches every pinned file from the
authority and requires the pin on its served line),
`tools/contracts/export-roundtrip.test.ts` (renamed import),
`vendor/contracts/pin.json` and `vendor/contracts/contracts/catalog.v1.json`
(new authority and commit, current authority catalog). The other 18 hashes,
including the schema, fixtures, verifier and generated validator, still match.
The report's conclusions about the authority pin and the drift gate do not apply
to the current bytes until a scoped recheck; its JSON is left unchanged.

These reports preserve their original bytes. Provider/model visibility is recorded
as observed rather than inventing an exact model identity. The storage report does
not supply a model identifier. Reproduction commands are ordinary repository
commands; agent identity is review provenance, not a runtime dependency.

No captured bytes, private profile paths, credential material or local instance
configuration are stored in these records. Browser evidence is separately bound
to the generated package inventory; these reports cannot promote an untested build.
