# Execution engine boundary

This document specifies the internal engine boundary. Public Scenario and Execution
wire contracts will be authored and locked in `libre-ai/contracts`.

An engine adapter compiles one immutable Scenario version into an independently runnable
artifact, validates exact browser/OS/viewport capabilities, executes inside an isolated
point, and returns assertion-level observations plus artifact references. It never owns
the Verdict.

The boundary requires preparation, actions, assertions, cleanup, cancellation, deadline,
bounded retry reporting, side-effect classification, and secret handles. Secrets and
captured user sessions are not serialized into the Scenario or export.

Playwright is the first intended compiler target for qualified Chromium and Firefox
profiles. Safari remains a separate WebDriver/macOS profile until real-device evidence
proves its exact capabilities. Engine success without every required assertion result is
not evidence of correction.
