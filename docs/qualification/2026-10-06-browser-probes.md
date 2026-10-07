# Browser capture probes — 2026-10-06

## Plan and provenance

Authority: the product-session runbook and ADR-0002. Scope: synthetic local fixture,
standalone capability probe, and measured browser limitations. No public export schema.
Inspected base: `0d3d304`; runtime results are separate from source/unit-test results.

1. Test a bounded PNG header reader and minimal-permission manifest invariants.
2. Create a deterministic defect fixture with synthetic sensitive canaries and a
   below-fold marker. Serve only on loopback; never record arbitrary page content.
3. Build an unpacked WebExtension with explicit screenshot, storage, and recording
   gestures, no automatic collection, no host permissions, and audio disabled.
4. Inspect installed branded browsers; use native browser installation workflows.
   Record exact diagnostics if developer mode, signing, or automation is unavailable.
5. Run probes only on the fixture, including persistence across popup reopen,
   deletion, capture dimensions, denied permission and recording lifecycle when possible.
   Store captures only in ignored `test-results/`; commit metadata and recipes only.

Acceptance: actual API execution with semantic assertions is required for a browser
capability. API presence, compilation and engine substitutes are not qualification.
Probe recipe: `bun test tools/probes`; `bun tools/probes/serve.ts`.

## Runtime observations

No browser capability is qualified. No screenshot, recording, storage API operation,
permission denial, revocation, restart, or deletion was executed in a branded browser.

| Surface | Observed result | Boundary |
| --- | --- | --- |
| Native CUA inventory | Succeeded; browser connector inventory empty, Firefox installed but not running | Inventory only; not API evidence |
| Chrome | `cua.getApp("com.google.Chrome")` did not return an app state; tool interrupted by coordinator after 1959.3 seconds | UI access incomplete; extension installation and developer-mode state unknown |
| Firefox | Not attempted after Chrome UI call interruption | Permissions, installation and all capture APIs unverified |
| Safari | Not attempted | Signing, unsigned-extension policy, remote automation and capture APIs unverified |

The tool labelled the cancellation “aborted by user”; the coordinator confirmed it
invoked agent interruption. This is not evidence of a user decision or refusal.

No security setting, developer mode, browser permission, signing setting or global
configuration was changed by this probe task. Installed versions reported by the lead
(Chrome 154.0.8037.98, Firefox 157, Safari 26.6.2, macOS 26.6.2, Xcode 27)
were not independently measured here and are not runtime qualification evidence.

## Source checks and limitations

- Red test: `bun test tools/probes/png.test.ts` exited 1 because implementation
  `png.ts` did not exist. This proves test wiring, not a browser regression.
- Green test: same command exited 0; 2 tests and 4 assertions validated PNG header
  dimensions and rejection of malformed, truncated, and excessive dimensions.
- Initial targeted Biome check exited 1 with formatting differences in two files;
  formatting was corrected; final targeted Biome check exited 0 (8 files).
- Final `bun test tools/probes` exited 0 (2 tests, 4 assertions).
- `bun run typecheck` exited 0. JavaScript extension code is not covered by the
  repository TypeScript include; this proves only the included TypeScript files.
- The probe's recording flow uses `getDisplayMedia`, audio false, a ten-second stop
  timer, pause/resume controls and byte counting. It retains no video chunks and
  is not a product recording implementation. Popup lifetime and browser-specific
  support remain untested. Capture preview remains local and is not exported.
- Storage quota exhaustion/error injection and browser restart are not implemented
  as automated scenarios. Failure reporting exposes only an error name, not raw
  page-containing browser messages. No claims about crash safety follow from this.
- The fixture contains only synthetic values and a deliberate double-increment
  defect. The screenshot action checks its loopback URL, but no screenshot was made.
- No probe server or build process was started. There is no task-owned process to
  stop. Native CUA may have launched Chrome before interruption; no returned state
  confirms whether it did. Do not close user browsers merely to clean up this task.

## Reproduction boundary

Serve the fixture with the recipe above. Load `tools/probes/extension/` through the
branded browser's supported local-extension workflow after its security requirements
are explicitly resolved. Activate the extension on the synthetic fixture. Inspect
API availability, save and reopen the popup to inspect the marker, capture the visible
fixture, and delete the marker. Test video only with an explicit fixture-selection
user gesture. Record observed results separately; source readiness is not execution.


## Review correction and bounded regression evidence

Root review identified acquired video tracks surviving a recorder constructor/start
failure. Four regression tests failed before correction (exit 1): both failures,
pagehide cleanup, and screenshot window binding. The corrected probe releases tracks
and its timer on recording errors and pagehide, including late media acquisition.
Screenshot capture now supplies the original window ID and checks the active tab ID,
window and URL after capture before exposing the preview. A same-URL navigation or
switch-away-and-back race cannot be excluded by those postconditions; browser runtime
qualification is still required and this is not a claim of atomic target binding.
The video probe continues to count bytes only; no chunks are retained.

Tests execute the actual probe script in a VM with explicit API/DOM doubles. They prove
bounded control flow only, not browser behavior. Final `bun test tools/probes` exited 0: 7 tests, 15 assertions. Final targeted
Biome check exited 0: 9 files. `bun run typecheck` exited 0. TypeScript checks still do not type-check the extension JavaScript itself.

Additional access evidence supplied by the coordinator: `ORCA_CLI_COMMAND` and
`ORCA_DEV_REPO_ROOT` were absent, `command -v orca` exited 1 with no result. The
computer-use CLI fallback was unavailable in PATH; no alternative binary was attempted
and no browser setting was modified.
