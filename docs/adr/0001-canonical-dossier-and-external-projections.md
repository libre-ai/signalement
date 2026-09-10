# ADR-0001 — Canonical Dossier and external projections

- Status: accepted for the specified product foundation
- Decision owner: product owner through the approved qualification session
- Reopens when: an external system must become authoritative for canonical evidence

## Context

Organizations commonly use several ticketing, project-management, support, and house
systems at once. Making any one provider canonical would create lock-in and force the
capture/reproduction model to inherit that provider's fields and lifecycle.

## Decision

`Dossier` is the canonical internal aggregate. It separates user statements, observed
facts, hypotheses, approved evidence, Scenario versions, Execution results, and
Verdicts. An external ticket or task is an `ExternalProjection`, never the Dossier.

One `FederationGroup` selects one or more destinations. Each projection has an
independent idempotency key, cursor, delivery state, mapping version, remote identifier,
and receipt. Failure at one destination neither rolls back nor reports success for
another destination.

Authority is declared per mapped field and direction. Provider-owned lifecycle fields
remain provider-owned unless a qualified profile says otherwise. Dossier evidence and
assertions cannot be overwritten from external text. A conflict without an explicit
rule is recorded for human resolution; it is never settled by timestamps or AI output.

Enterprise house standards implement the same connector boundary through a deployable
adapter or Customer Edge Bridge. They do not fork the Dossier schema.

## Consequences

- Multi-provider fan-out is native, not a later batch export.
- Bidirectional synchronization requires loop-prevention receipts and field-level rules.
- The product deliberately does not offer a Jira/Linear-style planning authority.
- Adding a provider is reversible because provider concepts stop at the projection boundary.
