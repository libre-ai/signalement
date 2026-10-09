# Contract compatibility policy

## JSON payloads

- Every v1 schema rejects unknown fields unless a named extension map is explicitly declared.
- Required-field removal, rename, type/meaning change, enum narrowing or identifier reinterpretation requires a new major contract.
- `additive-v1` permits an optional field only through a coordinated monorepo change: all consumers qualify the new schema before any producer emits the field. There is no mixed-version production rollout during the Big Bang.
- Consumers read an older payload only through an explicit bounded adapter with fixtures and deletion criteria. Producers emit one current version.

## Data policy

The accepted retention policy is exact and major-versioned. A shorter tenant-selected value within an existing bound is runtime data, not a contract change. Changing a default/maximum, adding a server data class or extending retention requires ADR/privacy review and a new policy candidate with deletion/migration evidence.

## HTTP APIs

A new route, operation or optional request/response field may remain in v1 if it does not alter existing semantics and follows the coordinated rule above. Every mutation keeps idempotency key, expected revision, stable refusal envelope and CSRF protection for cookie-authenticated browsers. Removing an operation or changing a refusal/authorization meaning requires v2.

## WIT and Biscuit

WIT worlds and authorizer policies are exact major-versioned boundaries. Signature/type changes, new host imports, expanded operations or expanded role rights require a new major plus adversarial conformance vectors. An attenuation or additional denial may remain in the same major only before release; after release it is treated as a security migration with explicit rollout/rollback evidence.

## Pre-implementation candidates

An undefined v1 behavior is not completed in place when doing so changes a signature, accepted payload, identifier or digest meaning. A new major candidate is created and the v1 remains non-targeted. The Policy v1 authority merged by PR #16 is retained as baseline for repository consistency, but ADR-0003 explicitly keeps it outside the WP-G2-S01 implementation target and permits no further reinterpretation. When no v1 producer was released, consumers move directly to the approved major without a compatibility adapter. `candidate` means machine-checkable only: implementation waits for every role listed by the catalog review dossier. Each role requires a dedicated review-only pass on an immutable commit; agent/session inequality is not required in solo work.

MissionRecord/API v2 and orchestrator-event v2 are parallel locked, unimplemented authorities; locked Missions v1 remains unchanged and is the only deployable family. V2 has no producer, consumer or compatibility adapter until a bounded implementation work package qualifies its feature boundary. It never reinterprets v1 approvals as two-agent quorums. The product-level two-agent quorum is stricter than this repository engineering-review process: its two reviewers must be distinct agents and distinct from every contributor.

## Evidence

A contract change is incomplete until catalog, schemas/protocol source, positive and negative fixtures, generated/validated projections and every named consumer pass in the same candidate. Contract artifacts never contain secrets or production/personal fixture data. Authoring and review must be separate passes; attributable review follows Governance [`AGENT-REVIEW-PROTOCOL.md`](https://github.com/libre-ai/governance/blob/main/docs/reviews/AGENT-REVIEW-PROTOCOL.md).
