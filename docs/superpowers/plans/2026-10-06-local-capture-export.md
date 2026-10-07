# Local capture and export implementation plan

> Agentic workers: execute owned tasks with TDD and independent review; preserve
> concurrent work. The owner's portable workflow authorizes coherent reversible
> steps without ritual approval pauses.

**Goal:** installable local capture, review, resume and approved portable export on
three separately qualified browsers.

**Architecture:** share pure lifecycle and artifact logic, keep browser permissions
and media collection in separate adapters, and consume the Contracts authority.

**Tech stack:** strict TypeScript, Bun, WebExtension APIs, Web Crypto and IndexedDB;
Safari uses its actual Xcode packaging. No frontend framework is required.

**Spec:** `docs/superpowers/specs/2026-10-06-local-capture-export.md`.

## Ownership and sequence

### 1. Canonical export authority

Owner: Contracts worker in the isolated Contracts checkout.

- [x] Write strict candidate schema, bounded positive/negative fixtures, semantic
  verifier, immutable digest preimages and review dossier.
- [x] Run schema and semantic red/green tests, coverage threshold and full gate.
- [x] Review architecture, security and privacy on an immutable candidate; follow
  the authority's promotion milestone before consuming it in the product.
- [x] Vendor exact approved files and record revision and digests; drift test must
  reject one changed byte or a different authority revision.

### 2. Browser probes and deterministic fixture

Owner: browser probe worker; only `tools/probes/**`,
`tests/fixtures/capture-app/**` and its dated qualification report.

- [ ] Reproduce one synthetic UI defect and known sensitive regions in a local page.
- [ ] Exercise screenshot permissions, recording lifecycle and storage APIs in
  actual branded browsers. Persist artifacts only under ignored test output paths.
- [ ] Record exact observed refusal when driver, signing or extension installation
  requires a host permission. Do not weaken a host setting to manufacture green.

### 3. Shared capture and draft core

Owner: coordinator; `packages/capture-core/**`, `packages/domain/**`.

- [ ] Implement pure lifecycle transitions with an injected monotonic clock:
  idle → collecting → paused/stopped → reviewed → approved; modification revokes
  approval and cancellation stops every media track.
- [x] Test copy-on-write derivatives, crop/mask geometry, exact byte hashes and
  rejection of oversized or malformed media before allocating decoded surfaces.
- [ ] Implement encrypted atomic draft storage after key custody is selected;
  tests cover concurrent revision conflicts, failed commits, expiry and restart.
- [x] Assemble the approved logical file map and independent import verifier;
  test altered bytes, undeclared originals, duplicate paths and archive traversal.

### 4. Installable browser journeys

Owner: coordinator assigns disjoint platform paths after probe results and shared
interfaces are fixed. `apps/extension-shared/**` owns common editor controls;
platform directories own permissions and native packaging.

- [ ] Popup collects only on explicit action; bind the original tab before opening
  the editor. Test navigation/revocation between selection and capture.
- [ ] Editor shows expected/observed statements, immutable evidence previews,
  real crop/mask controls, local draft state and exact approved export bytes.
- [ ] Add visible recording controls, audio off by default and per-profile refusals.
- [ ] Install each package, execute the fixture journey and record independent
  assertions. Tests on an engine substitute do not count as branded-browser evidence.

### 5. Acceptance, review and publication

- [ ] Generate coverage with a blocking threshold for new runtime logic.
- [ ] Execute each acceptance row in the specification and measure resource bounds.
- [ ] Run full staged-tree and post-commit history gates, independent security and
  functional review, then protected PR CI. No force push or protection relaxation.
- [ ] Publish installation instructions and limitations matching actual evidence.

## Review focus

1. Browser navigation must not export a different tab than the approved target.
2. CSS overlays must never masquerade as redacted exported pixels.
3. A failed write or restart must not resurrect deleted or expired raw media.
4. Imported page text must not execute extension actions or escape generated markup.
5. Contract integrity checks must not be described as authenticated human consent.

## Observed checkpoint — 2026-10-06

Contracts PR 18 merged the reviewed candidate at
`4da067483288faa183082f5bb5fd03ad5cfd7ac4`. Three specialized approvals and a
separate candidate-integration approval are recorded; exact hosted checks passed.
The catalog remains candidate. A native owner decision on locking v1 is pending;
no implementation against a locked authority is claimed.

Synthetic probe sources and seven unit tests exist. Actual Chrome access did not
return a state and was interrupted; Firefox and Safari were not exercised. See
the dated qualification report for the evidence boundary. These probes are not
the product extension and do not prove screenshot, recording or storage behavior
on any browser. The implementation remains pending, including review UI and
encrypted drafts. The owner key-custody decision remains unanswered.

## Observed checkpoint — 2026-10-07

The owner's three decisions are accepted: lock export v1, use a passphrase with
a memory-only derived key, and integrate fleet documentation into the frozen
refoundation workstream without bypassing its controls. Contracts PR 19 merged
the lock at `812c7d8b64976054201a0da6a3af2ce93bf9cc0b`.

Product code now includes pixel derivatives, encrypted atomic storage, strict
IPC, an editor and immutable reviewed ZIP export. Core and export coverage are
blocking checks; browser adapters require separate real-browser evidence. The
independent storage review reproduced and corrected a mutable-input identity race
and uncleared internal plaintext copies. No product promotion follows from a WIP
review.

Chrome's installed-extension synthetic journey passed in a disposable headless
profile. Firefox subsequently completed native action, capture, decoded pixel review,
encrypted draft reload/resume and independent ZIP verification using a bounded
local DevTools pipe to click the actual popup. Safari conversion and native unsigned compilation succeeded; Safari
WebDriver refused because remote automation is disabled. Native Chrome and Firefox video fixtures pass; screen-source and microphone
permission qualification remain open. Exact receipts and limitations
belong to the dated qualification reports; all acceptance boxes remain open
unless the entire stated condition has been demonstrated.
