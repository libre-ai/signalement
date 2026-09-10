# ADR-0004 — Portable control plane and isolated execution points

- Status: accepted for the specified product foundation
- Reopens when: measured trust or scaling constraints require a new deployable boundary

## Context

The product needs reliable fan-out, isolated browser execution, self-hosting, and
enterprise-local adapters without turning each module into a service or binding the
domain to a Kafka-compatible broker.

## Decision

Use one modular Bun control plane backed by PostgreSQL. Canonical state changes and
outbound intents commit atomically through a transactional outbox. Workers and Customer
Edge Bridges are separate processes because they cross execution and network trust
boundaries; other modules remain in-process until evidence requires separation.

Integration events use versioned CloudEvents envelopes documented through AsyncAPI.
Payloads contain identifiers and classified metadata, never raw evidence bytes. The
transport interface supports an in-database dispatcher first and adapters such as NATS
JetStream or a Kafka-compatible broker later. Transport acknowledgements never become
canonical state; consumers are idempotent and cursor-based.

Artifacts use an interface with POSIX and minimal S3-compatible implementations plus
application-layer envelope encryption. Secrets are injected at execution. Execution
points connect outbound with mutually authenticated identity, advertise signed exact
capabilities, enforce quotas/timeouts/cancellation, and clean created resources.

The control API and CLI use versioned open contracts and portable exports. Optional AI
modules consume explicitly disclosed data and return proposals only; they are removable
without changing canonical workflows.

## Consequences

- The baseline has no Kafka operational dependency, while event interoperability remains possible.
- House systems can stay behind an outbound Customer Edge Bridge.
- macOS execution is a distinct operational profile required for real Safari.
- New microservices require a measured security, failure-isolation, or performance justification.
