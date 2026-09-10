# ADR-0002 — Bounded capture and target-bound disclosure

- Status: accepted for the specified product foundation
- Reopens when: a browser capability or collection policy changes the disclosure model

## Context

Screenshots, video, console, network metadata, page text, and user actions can contain
credentials and personal data. Browser permissions and capture semantics also differ,
especially for cross-origin frames, protected pages, canvas, closed shadow DOM, and
Safari native-host boundaries.

## Decision

Capture is voluntary, visible, bounded, and local-quarantined until review. A one-shot
screenshot never requires a prior session. Audio, network bodies, and the optional
bounded rolling buffer are off by default. Passwords, cookies, session tokens, and
authorization headers are always excluded.

The user previews the exact payload separately for every target and can crop, mask, or
remove any artifact or event. Approval for one target grants no authority to another.
Redaction creates an immutable derivative with lineage and keeps the unredacted source
inside its retention boundary; it never claims perfect anonymization.

Chrome, Firefox, and Safari are separate adapters and qualification profiles. Partial
capture and every known browser limitation are visible in the Dossier. Video, an
interaction log, and DOM reconstruction are distinct artifacts.

Suspected vulnerabilities, exposed secrets, and exploit details are refused from this
functional intake and routed to the fleet private security channel.

## Consequences

- Local drafts and interrupted-upload resumption need explicit retention and deletion.
- Artifact storage needs encryption, digests, classification, and target disclosure receipts.
- Browser parity is an evidence claim, never inferred from shared WebExtension syntax.
