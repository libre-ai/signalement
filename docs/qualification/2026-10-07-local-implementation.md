# Local implementation evidence — 2026-10-07

## Provenance and admission boundary

The owner authorized the local browser journey, passphrase-held draft key and
locked export v1. The inspected implementation base is
`0d3d3044b67297cef00be15e8fb4b751dd1df5bb`; source and browser receipts bind later
work to exact file or bundle hashes. This report supersedes the absence of runtime
results in the historical 2026-10-06 probe report, without rewriting that evidence.

The product is experimental. It has no qualified three-browser release. A local
build, a passing unit suite and a successful launcher are distinct from an installed
extension journey. The repository has no live backend or ticket connector.

## Evidence by surface

| Surface | Observed evidence | Remaining boundary |
| --- | --- | --- |
| Export authority | Contracts PR 19 locked v1 at `812c7d8b64976054201a0da6a3af2ce93bf9cc0b`; byte-exact vendoring and drift checks | Integrity is not authenticated human consent |
| Screenshot derivatives | Pure pixel tests plus native Chrome decoded PNG oracle; crop, opaque masks and exact reviewed/exported bytes | Runtime navigation and permission edge cases require each browser profile |
| Vault | Native Chrome IndexedDB, WebCrypto, actual application quota refusal, CAS conflict and native transaction abort preserve ciphertext/revision | Native engine quota exhaustion remains unverified |
| Chrome installed extension | Explicit native capture, pixel review, encrypted save/lock/unlock, true process restart and independent ZIP verification | Exact receipt identifies build; no headed/Linux result inferred |
| Firefox installed extension | Firefox 157 native toolbar action then exact popup DOM click; PNG pixel oracle, encrypted draft reload/resume and independent downloaded ZIP verifier passed | No OS hit-test, native recording picker or Firefox process-restart qualification inferred |
| Firefox video | Firefox 157 synthetic native pipeline: 10 assertions, exit 0; silent/audio decoding, masks across frames, container filtering, nonzero approved PCM | Does not qualify source-picker or microphone permissions |
| Safari native package | Converter plus unsigned macOS native build succeeded with case-consistent `fr.libre-ai.Signalement` bundle ID | Runtime refused: Safari remote automation disabled; no host setting changed |
| Independent review | Storage, export and UI/video hash-bound reviews under `docs/reviews/local-capture-20261007/` | Mutable-source review is not immutable-commit or merge approval |

Firefox installed-extension receipt at `2026-10-07T07:40:24.168Z` passed on
editor bundle `8688825f115ecc65cc3ec6d05dd291aec2b474f26f7bb497991319cf50b9c361` (full inventory in its receipt). The native
action grants the ordinary active-tab context; the harness never grants extra
permissions or substitutes capture bytes. Popup evaluation uses a bounded local
Mozilla DevTools pipe, an internal Firefox API, without a listening socket.

Firefox video receipt at `2026-10-07T07:31:50.518Z` binds bundle
`a71cd7e6a23e0c9ac01ba88591db0cf38619406b257d6738a34d5d2087ce9e0a`.
See `tools/browser-check/README.md` and `apps/extension-shared/video.README.md`
for ordinary reproduction commands, exact browser versions and subsequent receipts.
Synthetic media remain in ignored output directories; committed evidence contains
metadata and hashes only.

## Limits that prevent full acceptance

- Native recording source selection, permission refusal/revocation and microphone
  lifecycle have not completed the full three-browser acceptance matrix.
- Safari installation and runtime require the unresolved host-policy choice.
- Chrome accepted a one-byte quota override but still saved a second screenshot;
  that experiment did not produce `QuotaExceededError`. Its qualification result
  remains partial, with nonzero command exit. Application quota and native abort
  evidence must not be relabeled as engine exhaustion.
- The maximum-size vault benchmark is a Bun memory measurement, not browser
  qualification: approximately 2.61 GB RSS at the end of a near-limit two-draft
  exercise includes unreclaimed allocations. Large-vault browser memory remains
  unqualified. The full encrypted envelope trades metadata privacy for copying.
- Expired content is purged on access/maintenance; a closed browser cannot erase
  on a wall-clock deadline. Memory key lifetime is controlled, but JavaScript
  string/Blob physical erasure and whole-vault rollback resistance are not claimed.

## Local source gates

`bun run check` exited 0 on the pre-publication working snapshot: 366 tests,
917 assertions, 24 historical commits and 283 objects with zero findings.
The core and export suites enforce 90% coverage thresholds; this is not a claim
of coverage for every editor/browser branch. `reuse lint` passed on 160 files,
and `bun audit --json` returned `{}` with exit 0 after the fast-uri patch.
The final commit and hosted CI remain separate checks.

## Host interaction failures

Native app discovery stalled twice despite requested call deadlines. The later
Firefox discovery returned only after 1,428 seconds, after the disposable fixture
had already closed. No action was performed on the ordinary Firefox window it
returned. Further qualification uses bounded disposable-profile harnesses; no
ordinary user profile is inspected or modified for test cleanup.
