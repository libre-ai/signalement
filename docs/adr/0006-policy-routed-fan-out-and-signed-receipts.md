# ADR-0006 — Policy-routed fan-out and signed receipts

- Status: proposed for the v1.0 scope; the owner's merge of the pull request that carries it
  is the arbitration (precedent: ADR-0055 in `libre-ai/project-governance`); provider,
  browser and deployment qualification is separate
- Decision owner: owner decisions D4 to D13 of 2026-10-22 and 2026-10-23, recorded in
  `docs/superpowers/specs/2026-10-22-v1-policy-routed-ticket-projection-design.md` §4;
  the freeze was lifted by `libre-ai/project-governance` ADR-0055 (D94)
- 2026-10-24 owner decisions: recorded in `docs/superpowers/plans/2026-10-24-v1-roadmap.md`
  §4.2, §4.5 and §6; they supersede design §5.2 point 5, §5.5 and §5.6 where they differ
- Reopens when: a policy, receipt or profile contract changes incompatibly, or a measured
  trust boundary requires a second deployable
- Prolongs: ADR-0001, ADR-0002, ADR-0004, ADR-0005 (amendment proposed 2026-10-24)

## Context

The v1.0 buyer is the team that sets the rules (security, compliance), not the person who
reports. Today a person captures a problem, sends it over whatever channel is at hand, and
someone copies it into a team's ticketing tool: often the wrong one, often with more data
than necessary, sometimes twice. The product must deliver the report to the right
ticketing system, with only what is allowed to go there, once, with proof of what left.
"Right" and "allowed" are decided by policy, not by the reporter.

The existing ADRs already fix what this decision builds on:

- ADR-0001: the Dossier is canonical; external systems receive projections and never
  write Dossier fields back from remote text.
- ADR-0002: disclosure is bound to the target; the person sees the exact result per
  destination (ADR-0002, plus design goal B2: the person may withhold more, never
  transmit more).
- ADR-0004: one modular Bun control plane on PostgreSQL, a transactional outbox, an
  in-process dispatcher until evidence requires separation, and idempotent consumers.
- ADR-0005: an extension without network access, the exact reviewed local export
  `signalement-local-export-v1`, and the permission surface as amended on 2026-10-24
  (the permission sentence of "Amendment — 2026-10-24, v1.0 gesture-bound delivery").

This ADR adds the policy, the delivery path, the receipt and the deployment model. It does
not redefine any public schema (see "Contracts").

## Decision

The numbers D4 to D13 are those of the v1.0 design §4, not those of the fleet registry.

Some decisions below are agent choices listed in design §9, not owner decisions; they are
endorsed through the owner's approval of the design: the WASM component (rather than
FFI), the separation of author and approver, the origin typed by the person, token
profiles rather than OAuth or an App, the rejection of a managed browser policy, and the
refusal of non-conforming instances.

### D4 — The buyer is the team that sets the rules

The buyer is the team that writes the rules: security and compliance. Policy, audit and
receipts are the product core; the capture and the connectors serve them.

### D5 — Self-hosted control plane, CLI on the same engine

The control plane is self-hosted by each customer. The CLI shares the engine with it
through shared crates and packages, as refined by D11: the CLI is a client, not a second
engine with its own state.

### D6 — Routing and disclosure vocabulary

- Routing vocabulary: `imposed`, `optional`, `selectable`, `denied`. A rule carries
  `override: allowed | denied`, default `denied`. A person may add a destination outside
  the rule's list only when the rule says `override: allowed`, and only among the
  destinations the rule marks `selectable`. A destination added by override goes through
  the same disclosure rules as any other.
- No matched rule means no destination, and the screen says so. There is no implicit
  destination.
- Rule precedence (owner decision of 2026-10-24): the matched rules are united. A denial
  dominates, and the strictest override applies.
- A policy is versioned `draft → approved → retired`; only an `approved` version applies.
  Author and approver are distinct by default; an organization may relax that separation,
  and the relaxation is itself an approved, audited change.
- Evaluation is a pure function: the same policy, export, observed origin and discovered
  attributes give the same plan, byte for byte.
- Disclosure is decided per file. The classes are those of the export contract:
  `document`, `screenshot`, `video`. The decision is `transmit | withhold`, and the
  default is `withhold`. Removing a passage of the document requires a new local
  preparation (ADR-0005).
- Media delivery, for a profile that cannot upload an attachment, is `link | withhold`,
  default `withhold`. A `link` points to the artifact in the control plane, reachable by
  authenticated members of the organization only.

### D7 — Signed receipt per successful delivery

- Authenticity comes from a receipt, not from the export: the export contract
  `signalement-local-export-v1` is unchanged.
- The control plane produces one receipt per successful delivery. The receipt is
  canonicalized with JCS (RFC 8785) and signed with Ed25519 under strict verification
  (canonical A and R, not the identity, in the prime-order subgroup, canonical S). The
  motive is measured: the native Ed25519 verification of Bun accepted forgeries under an
  identity key (`libre-ai/schemas-and-contracts`,
  `docs/reviews/build-brief-v2-crypto-dependencies.md`).
- Minimum content (design §5.5): receipt version, `organization`, signing key id and
  timestamps; export digest, destination id and exact profile; remote id and URL;
  digests of the transmitted files, ids of the withheld files and the reason; renderer
  version and the digest of every request body actually sent; policy version and digest,
  and the approval reference.
- Offline verification checks the signature and the file digests against the export. It
  recomputes the rendered bodies when the same renderer version is available, and says
  explicitly when it is not.
- A receipt proves that this control plane sent these bytes to this remote identifier
  under this policy. It does not prove the identity or the intention of the person who
  reported, nor what the provider did afterwards.

### D8 — Delivery through the active tab

The extension delivers the reviewed export and the observed origin to the control plane
page through the active tab, on an explicit gesture, with one bounded addition to the
manifest: the `scripting` permission. The destination must match exactly (scheme, host,
port) the origin typed by the person, never one inferred from the page. The permission
surface, the injected fixed function, the chunked acknowledged transfer and the
unchanged `connect-src 'none'` are specified in the amendment of ADR-0005, which this ADR
cites and does not restate. No `host_permissions`, `content_scripts` or
`externally_connectable` appear.

### D9 — Denied destinations are masked

The person sees a single counter, "N destination(s) excluded by the policy", with no name
and no reason. The counter counts only the destinations the matched rules explicitly
deny; a destination that no rule mentions does not appear in it. The detail lives in
the audit log, readable by policy administrators.

### D10 — Routing on the observed origin

Routing keys on the origin observed at capture (scheme, host, port; no path, query or
fragment), kept in the encrypted draft, shown at review as an observation distinct from
the person's declarations, and removable. When it is removed it is `null`, it is not
transmitted, and only rules that match an absent origin can route. The origin is
falsifiable by whoever controls their browser. That is acceptable because disclosure
depends on the destination and not on the origin: a forged origin can only reroute to
another destination the policy already allows, with that destination's own disclosure
rules. It is not falsifiable by a typing mistake.

### D11 — The CLI is a client and an offline verifier

The CLI submits an export to the control plane, follows the state of the projections,
and verifies receipts offline. It never projects and never signs. There is one source of
state, audit and policy: the control plane.

### D12 — One deployment per customer, one organization per deployment

- Each customer hosts its own deployment, serving one organization. `organization` stays
  on every resource and row-level security on every table that carries organization
  data, kept as defense in depth; the `cross-organization-disclosure` suite still runs
  with two organizations in a test database.
- One signing key per deployment, with rotation, the key id in every receipt, and an
  export of the public keys. Retired keys stay in the exported set so that receipts they
  signed remain verifiable.
- Roles (reporter, policy administrator, auditor) come from the claims of the customer's
  OIDC provider, through a local mapping table.
- The CLI authenticates with attenuable Biscuit Ed25519 tokens issued by the control
  plane; the web session is a `__Host-` cookie.

### D13 — v1.0 ships projection only, with four qualified profiles

The v1.0 exit is projection only, with four profiles `qualified` against real instances:
GitHub Issues (github.com), GitLab Issues (gitlab.com), Jira Cloud, and self-hosted
Plane. Reproduction and verdict, and the Customer Edge Bridge, move to v1.1. The product
card stays under `usable-verifiable` (which requires an isolated worker) and says so
publicly. The connector interface is published under Apache-2.0 so that a Bridge can
implement it later without a fork.

### Owner decisions of 2026-10-24

These two decisions are recorded in the roadmap (`docs/superpowers/plans/2026-10-24-v1-roadmap.md`
§4.5 and §6); they belong to no numbered decision above.

- The GitLab.com profile uses a personal access token with the `api` scope on a dedicated
  service account, member of the target projects only. Project access tokens on
  GitLab.com require a Premium or Ultimate subscription (assumption
  `gitlab-project-token-tier`).
- The reception page checks the transport (length, announced SHA-256, readable archive,
  `manifest.json` present) and shows the `verifyExport` verdict rendered by the server.
  The vendored verifier does not run in a browser, so the conformance verdict is the
  server's.

### Proof component

`crates/policy-receipt/` (Rust; `crates/` is reserved for proof components) holds the
pure policy evaluation, JCS canonicalization, and Ed25519 receipt signing and
verification. It is compiled to WASM with the WIT world
`libre-ai:signalement-policy-receipt/api@1.0.0`, and the control plane and the CLI load
the same artifact. A native FFI is rejected: it would mean two artifacts to build,
qualify and keep identical. The secret key never leaves the control plane; the CLI holds
only public keys.

### Fan-out and idempotency

- A projection is identified by (`organization`, Dossier, destination). The first
  delivery creates the remote item; later deliveries post a comment on it.
- The idempotency key of a delivery is a hash of (projection, export digest, mapping
  version). The same export delivered twice produces no new delivery.
- The approval creates the deliveries and their outbound intents in the same transaction
  (outbox). The dispatcher is idempotent and resumes by cursor.
- Discovered attributes are read when the plan is computed and read again before sending.
  If an attribute changed, or the policy version was retired, the delivery becomes
  `to-resolve` and requires a new approval; it never leaves under a stale plan. A failed
  read withholds every file of that destination (reason `visibility-unknown`), which is
  stricter than treating it as public.
- An ambiguous outcome (request sent, response lost) never leads to a blind creation. The
  connector searches the remote item by projection marker through a strongly consistent
  read; if the profile offers none, the delivery ends in `to-resolve`. A search index with
  deferred consistency does not count. Documented case: per the Atlassian documentation
  (search and reconcile), Jira Cloud has no strongly consistent read-after-write
  lookup, so an ambiguous Jira creation ends in `to-resolve`
  (the Jira profile declares `lookup: unsupported`).
- Each destination has its own state, never derived from another's. The Dossier shows N
  states, not an aggregated "sent".

## Contracts

The public contracts are drafted and locked in `libre-ai/schemas-and-contracts` and
vendored here by pin, like the export contract (`vendor/contracts/pin.json`). No public
schema is redefined in this repository. The catalogue identifiers:

- `signalement-routing-policy-v1`: a policy version (destinations, routing rules, denials,
  disclosure, media delivery).
- `signalement-delivery-envelope-v1`: the delivery envelope (export digest and length,
  observed origin or `null`, delivery id).
- `signalement-projection-receipt-v1`: the signed projection receipt.
- `signalement-connector-profile-v1`: an exact connector profile (family, edition, API,
  authentication, attachment, visibility, lookup).
- `signalement-policy-receipt-v1`: the WIT world of the proof component.

The exact profile ids of v1.0 are `github-issues/github.com/rest-2022-11-28`,
`gitlab-issues/gitlab.com/rest-v4`, `jira-cloud/cloud/rest-v3` and
`plane/self-hosted/rest-v1`.

## Consequences and acceptance boundary

- The product card gains four criteria, `policy-routing`, `signed-receipt-offline`,
  `gesture-bound-delivery` and `stale-plan-refused`, and a stop predicate,
  `destination-disclosure-leak` ("a file withheld by the policy reaches a destination").
  `public-data-leak` keeps its current meaning and source.
- A receipt is a claim about what this control plane sent. A valid signature does not
  qualify a provider, a browser or a deployment.
- This ADR does not qualify any profile, enable any connector, promote any browser or
  authorize any publication. Each remains subject to its own evidence.
- The v1.0 card stays under `usable-verifiable`, and the public page says so.

## Alternatives rejected

- Linear as a v1.0 target (D3): replaced by self-hosted Plane.
- A standalone CLI that projects without a server, with local state and an operator key
  (D11): two sources of state, audit and policy.
- A multi-organization operator serving several customers from one instance (D12): the
  schema keeps `organization` everywhere so as not to close that door.
- OAuth or App profiles in v1.0 (GitHub App, Atlassian OAuth 2.0 3LO, GitLab OAuth): v1.0
  qualifies minimal-scope tokens.
- A native FFI for the proof component: two artifacts instead of one.
- AI routing: no model chooses a destination or a disclosure.
- A browser-managed policy to configure the control plane origin: it would need the
  `storage` permission and is not equivalent across the three browsers (hypothesis to
  verify); the origin is typed by the person.
- Changing the meaning of `public-data-leak`: a new predicate carries the new meaning.
