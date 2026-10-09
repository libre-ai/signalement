# Local export consumer

Consumes the locked Signalement local-export v1 at the exact revision in
`vendor/contracts/pin.json`. It never owns or edits that authority. Capture,
sanitation, user approval UX and real-data/browser admission remain separate.

Implementation plan: fail-first tests for immutable review snapshots; browser-safe
schema validation and restricted JCS; deterministic store-only ZIP creation and
strict bounded parser; fresh Bun authority CLI; independent Python zipfile/oracle
roundtrip and adversarial mutations; >=90% coverage and vendoring drift gate.

`buildReview(input, reviewedAt)` copies all caller-owned strings, arrays and byte
buffers before awaiting hashes. It returns readonly Markdown, manifest, filenames
and `toZip()`, which always creates fresh bytes. An actual user must review this
snapshot before the UI invokes export. This API cannot prove that human action.

Markdown renders untrusted text as escaped plain content: no raw HTML, active links
or remote image references are introduced. Original captures/source names are not
accepted. Only reviewed derivative bytes and opaque source IDs belong here.
