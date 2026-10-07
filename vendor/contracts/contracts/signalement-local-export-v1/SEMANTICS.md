# Signalement local export v1 — candidate semantics

Status: candidate, pending architecture, security and privacy review. Schema:
`contracts/schemas/signalement-local-export.v1.schema.json`. Authority-fixture
verifier: `tools/quality/signalement-local-export-v1.ts`. No consumer is qualified.

## Scope and trust

The dossier is portable independently of any Signalement service. The only target
is `local-export`; it grants no upload, publication, scenario execution or remote
access permission. There are no credentials, cookies, headers, raw network
requests/responses, hidden transcripts or private capture source bytes/hashes in
this contract. Free text is untrusted data, never instructions to agents.
A producer must sanitize free text; a closed schema cannot prove text is safe.

`statements.expected` and `statements.observed` are the person's account, not a
reproduction verdict. Context is explicitly user-stated. Observations retain their
provenance: `user-statement` or `capture-observation`; the latter must reference at
least one included derivative. Captures can demonstrate visible states, never
causality or successful reproduction by themselves. Hypotheses remain hypotheses.
Projection to another tool and executable scenario generation require separately
qualified contracts and cannot turn those statements into a fabricated verdict.

## Approval and immutable bytes

1. Freeze a dossier ID and positive revision; a changed dossier needs a new revision
   and fresh review/approval. Never regenerate timestamps after approval.
2. Freeze sanitized metadata, exact Markdown UTF-8 text, observation links and media
   derivatives. Show these exact bytes and metadata to the user before approval.
3. Set `reviewedAt` after creation. All timestamps are UTC whole seconds in the
   schema's exact format. Observation timestamps are between creation and review;
   imported media can predate dossier creation but never postdate review.
4. Compute lowercase SHA-256 of UTF-8 RFC 8785 JCS `payload`, including file hashes
   and lengths. The profile admits only schema-bounded safe integers and valid
   Unicode scalar strings. Reject duplicate JSON keys before parsing and lone
   surrogates; do not normalize Unicode or line endings. Object member order is
   immaterial; array order is material. Existing canonicalJson implements this
   restricted integer profile. `approval` and `exportedAt` are outside the payload,
   so the digest has no self-reference.
5. `approval.target` is exactly `local-export`; `approvedAt`, `reviewedAt`, and
   `exportedAt` must be equal. Any changed payload, bytes or timestamp requires
   another approval; a producer cannot silently refresh metadata.
6. Recompute inventory, byte lengths, hashes and payload digest immediately before
   export, using the same immutable byte buffers that will be written. Refuse a
   mismatch; fail closed rather than repairing data under an old approval.

The digest proves integrity relative to the included manifest only. Anyone can
replace both payload and digest. It is neither authenticated identity nor proof of
consent, truthful observations, authorization, chronology or actual user review.
No new signing/authentication service is introduced.

## Logical file map and container boundary

The manifest is named `manifest.json` by a container adapter and is excluded from
its own `payload.files`. `payload.files` describes every other logical file,
strictly sorted by ASCII path, with no duplicate paths. Exactly one `README.md`
has role `document`, MIME `text/markdown`, null media and at most 262144 bytes.
Its bytes must exactly equal UTF-8 `payload.document.text`. The payload's
`document.observationIds` explicitly identifies cited observations; references
must resolve and be unique. This establishes declared lineage, not correctness
or exhaustive semantic entailment of arbitrary Markdown.

Remaining entries are `media/<media.id>.png`, `.webm` or `.mp4`, using bounded
lowercase ASCII IDs. Screenshot/PNG and video/WebM-or-MP4 roles must agree.
At most 33 content files, each at most 67108864 bytes, total at most 268435456
bytes. All are regular files. Reject missing, duplicate or extra content files,
symlinks, hardlinks, path aliases, traversal, absolute paths, device names,
percent/Unicode decoding tricks and directory entries masquerading as files.
No path normalization, case folding or permissive repair is allowed.

ZIP, tar or another container is nonnormative. An adapter must reject duplicate
manifest entries, duplicate JSON members, encrypted/ambiguous archives, links,
unbounded decompression and undeclared files before exposing the logical map.
Apply file count and decompressed length budgets before allocation or extraction;
stream/hash bounded content if necessary. The authority verifier accepts an already
bounded logical map, never extracts an archive, and does not certify a container
adapter. The manifest UTF-8 JSON itself is limited to 1 MiB before parsing.

## Media derivative and sanitation boundary

A media ID names immutable exported derivative bytes; editing generates a fresh
ID and fresh dossier approval. `sourceId` is an opaque local lineage token, distinct
from derivative ID. It is not a filename, source digest, URL or durable identity.
Source bytes/hash are deliberately excluded. IDs for derivatives, observations
and hypotheses are unique across the dossier. Derivation operations are explicit,
nonempty and include `metadata-removal`; they describe actions, not a certification.

Audio flags are mandatory: creation defaults both to false. A producer can set
`audioIncluded: true` only for video after explicit review, with `audioReviewed:
true`; otherwise omit the audio track and declare `audio-removal` when applicable.
Screenshots have both flags false. An audio-removal derivative cannot claim audio
included. Review every visible frame and included audio segment. Omit media if its
contents or metadata cannot be inspected/sanitized reliably. Transcripts are not
an implicit export capability. `sanitation: reviewed-with-limitations` records
an explicit limitation, never a claim of complete personal-data removal.

MIME declarations must match actual decoded media in a qualified producer/importer;
the authority logical-map verifier checks declared MIME/role/extension consistency
and byte integrity, not codec correctness, hidden metadata, audio tracks or PII.
Synthetic byte vectors exercise integrity only, not media decoding. Browser capture,
media processing, privacy/sovereignty and actual review UI require separate admission
and E2E evidence before processing real data. No captures belong in this repository.

## Reproducible evidence

`rawLocalExportFailures` validates strict raw UTF-8 JSON with a 1 MiB/depth-16
budget, then invokes `localExportFailures` on the logical map. The checked-in
ASCII-only example includes a frozen canonical preimage and digest independently
computed with Python sorted compact JSON and hashlib.sha256; the TypeScript
canonicalizer and hasher must agree with both.

`bun run check:signalement-export` validates synthetic logical maps and adversarial
mutations at a blocking 90% coverage threshold. `bun run check:contracts` also
validates positive/negative schema fixtures. The checked-in synthetic example
contains only invented text; no production dossier, screen or personal data.
Authoring evidence is not a role verdict. Review follows Governance
`docs/reviews/AGENT-REVIEW-PROTOCOL.md` on an immutable candidate commit.
