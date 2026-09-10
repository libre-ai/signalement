# Connector boundary

This document specifies the internal adoption boundary. Public wire contracts will be
authored and locked in `libre-ai/contracts`; this file is not a substitute authority.

An exact `ConnectorProfile` identifies provider family, edition, API version, auth mode,
capability set, limits, and qualification evidence. “Jira”, “GitLab”, or “enterprise”
alone is never a profile.

Required operations are discovery, mapping validation, idempotent create, attach to an
existing item, attachment upload, comment/result publication, cursor-based change read,
and capability reporting. Every operation returns a typed receipt or typed failure;
raw provider responses and secrets never enter logs.

Each projection owns its idempotency key and sync cursor. Conflict policy is explicit per
field as `dossier-owned`, `provider-owned`, `merge-set`, or `human-resolution`. Connector
code cannot mutate canonical evidence, assertions, Verdicts, or another destination's
state. Unsupported capability is data, never simulated success.

The Customer Edge Bridge implements this same contract for house systems. It connects
outbound, receives only target-approved projections, holds provider credentials locally,
and returns signed receipts. It does not become a second canonical control plane.
