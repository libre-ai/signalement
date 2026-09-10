# ADR-0003 — Scenario IR and deterministic verdicts

- Status: accepted for the specified product foundation
- Reopens when: a new execution engine cannot compile the canonical Scenario semantics

## Context

A recorded click sequence is insufficient proof of a defect or correction. Execution
engines and browsers vary, while assertions and expected outcomes must remain reviewable
and portable outside the service.

## Decision

A versioned engine-neutral `Scenario` contains preconditions, target environment,
required test data, typed actions, explicit assertions, expected result, preparation,
cleanup, and declared side effects. Approved versions are immutable. AI or automatic
repair may propose a new version but cannot change an assertion or visual baseline.

Compiler adapters target Playwright first for supported web profiles and W3C WebDriver
where required, including real Safari through a qualified macOS execution point. Tests
prefer semantic roles and test identifiers and mark fragile selectors explicitly.

`Verdict` is derived deterministically from the Scenario version, required assertion
results, environment, known application version, and execution state. Its closed values
are defect-reproduced, defect-not-reproduced, fix-validated, verification-failed,
execution-blocked, and inconclusive. Any missing required assertion prevents
`fix-validated`. A worker crash is `execution-blocked`.

Payments, deletion, message sending, or real mutations are denied by default and require
an explicit environment execution policy. Dedicated test environments are the default;
captured user cookies and sessions are never replayed.

## Consequences

- The same Scenario can demonstrate fail-on-defective then pass-on-corrected.
- Exports include runnable engine projections but keep the canonical Scenario version.
- Retries are bounded and visible; they cannot erase flakiness.
