# ADR-0005 — Passphrase vault and exact reviewed local export

- Status: accepted implementation choice; browser qualification is separate; amendment proposed 2026-10-24 for v1.0 delivery (see "Amendment"), effective at the owner's merge of the pull request that carries it
- Owner decision: 2026-10-07, passphrase unlocking and canonical export v1 lock
- Base inspected: `0d3d3044b67297cef00be15e8fb4b751dd1df5bb`

## Decision

The local editor derives a nonextractable AES-256-GCM key from a passphrase using
PBKDF2-HMAC-SHA256, a random salt and 600,000 iterations. Only memory holds the key;
lock or process restart requires unlocking again. There is no recovery or rotation.
A complete authenticated envelope encrypts draft identifiers, text, original media,
derivatives and retention metadata. IndexedDB compare-and-swap provides atomic
revision conflict detection. No server or mandatory identity provider is introduced.

The alternative of persisting an unlock key next to the ciphertext would not provide
the selected at-rest boundary. Per-draft plaintext indexes would expose identifiers
and retention metadata. Whole-envelope writes avoid that exposure at the expense of
copying and memory use, measured separately from browser quota behavior.

Temporary owned byte buffers are cleared on completion and failure. JavaScript
strings, browser internals, returned caller-owned data and garbage-collected keys
cannot be guaranteed physically erased. Encryption detects changed ciphertext, not
rollback of an entire older valid envelope by a profile attacker. Expired bytes are
purged when the extension next runs; a closed browser cannot execute timed erasure.

The export consumes the locked contract authority `libre-ai/schemas-and-contracts`
at the commit recorded in `vendor/contracts/pin.json`; it was first locked in the
since-deleted `libre-ai/contracts` at `812c7d8b64976054201a0da6a3af2ce93bf9cc0b` and
republished byte-identical. `check:contracts` refetches every pinned file from the
authority and requires the pin on its served line. Every authority file has an exact hash
and the generated browser validator is reproducible. The product defines no competing
public schema. Only copied reviewed derivatives enter the deterministic, store-only
ZIP. The independent CLI verifies inventory, bounds, digests and canonical semantics.
A digest proves integrity, not a person's identity, attention or intent.

Each preparation creates a new approval boundary. Changes, replacement media,
resume, lock and late asynchronous results cannot reuse approval for different bytes.
Originals remain local encrypted quarantine and are excluded from the export.
Video/audio sanitation and browser permissions require their own concrete evidence;
a valid manifest does not prove redaction or consent.

## Consequences and acceptance boundary

- Permission surface is voluntary active-tab capture, with no host permissions or
  content-script collection. The editor cannot contact a remote service under its CSP.
- The selected passphrase boundary protects closed local storage, not a compromised
  unlocked extension, malicious browser or fully compromised operating system.
- Maximum payload bounds do not establish a browser heap bound. The near-limit Bun
  benchmark reached approximately 2.6 GB process RSS with a 256 MiB envelope; maximum
  browser-load qualification remains open.
- Snapshot, mutable-input, lock, stale-event, approval and ZIP alias regressions have
  concrete tests. Independent review records bind findings to source hashes.
- This ADR does not promote any browser, enable a ticketing connector or authorize a
  host security setting change. Browser-specific remaining gates remain explicit.

## Amendment — 2026-10-24, v1.0 gesture-bound delivery

- Origin: owner decisions D8 and D10 of the v1.0 design
  (`docs/superpowers/specs/2026-10-22-v1-policy-routed-ticket-projection-design.md`);
  the freeze was lifted by `libre-ai/project-governance` ADR-0055 (D94). The original
  permission-surface consequence above is kept as history.
- The permission-surface consequence now reads, word for word (one line, deliberately
  not wrapped so that a single-line grep proves the whole sentence):

  > Permission surface is voluntary active-tab capture, observed origin retention, and gesture-bound delivery to one configured origin, with no host permissions or content-script collection.

- Manifest: `permissions` become `["activeTab", "scripting"]`. `host_permissions`,
  `content_scripts` and `externally_connectable` stay absent. The `connect-src 'none'`
  CSP of the extension pages is unchanged. This amendment authorizes; the manifest and
  `tools/build/manifest.test.ts:7` change with the delivery implementation (L6), not
  before.
- Observed origin: only the origin of the captured tab is kept (scheme, host and port,
  serialized by `new URL(x).origin`; schemes `https` and `http`), inside the encrypted
  draft envelope. It is shown at review as a capture observation, distinct from the
  declarations. It is removable; once removed it is `null` and is not transmitted. It
  travels in the delivery envelope, never in the export;
  `signalement-local-export-v1` is unchanged.
- Delivery: an explicit gesture on the control-plane tab. The destination must match
  exactly (scheme, host and port) the origin typed by the person, never one inferred
  from the page; a mismatch is a visible refusal with no injection. The editor prepares
  the delivery anew, so it is a new approval boundary in the sense of this ADR. A
  confirmation shows the destination origin, the observed origin and the content. A
  fixed function is injected through `scripting.executeScript` with `func`, in the
  isolated world, never code built from data; it reads nothing from the page and posts
  through `postMessage` to the explicit target origin. Chunks are bounded and
  acknowledged; the export digest is announced first and verified at the end.
- The service worker holds neither key nor bytes.
- Boundary unchanged: no network access from the editor, no browser promoted, and no
  delivery qualified until the browser matrix has proven it per browser.
