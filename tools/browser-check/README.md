# Installed-browser qualification

These harnesses load the real built WebExtension into a new temporary browser
profile. They never select a user's existing profile, loosen signature policy,
change global browser settings, or substitute a web page for the extension.
Only the repository's synthetic capture fixture is served on loopback.

## Reproduction

Build first with `bun run build:extensions`, then run:

- `bun tools/browser-check/chrome.ts`
- `GECKODRIVER_BINARY=/path/to/verified/geckodriver bun tools/browser-check/firefox.ts`

`CHROME_BINARY` and `FIREFOX_BINARY` select installed branded-browser executables;
defaults are the macOS application binaries. Firefox uses a visible disposable
window unless `BROWSER_HEADLESS=1` is set. Chrome currently runs headless. These
are separate qualification profiles; no Linux or headed Chrome result is implied.
The Firefox driver is not a repository dependency or a global installation.
This session used Mozilla's geckodriver 0.37.1 macOS arm64 archive, verified against
its release digest:
`d02b3f7003f999caf90974a2ef5da0286c05d01cee19112c86846d759fdba4f5`.

Every run writes a new opaque subdirectory under ignored
`test-results/browser-check/<browser>/`. Captures and downloaded archives never
enter Git. The extension is copied into temporary storage only after each file
matches the build's SHA-256 inventory. Evidence binds the browser version,
provider, no-model execution, recipe, helper and fixture hashes to that snapshot.
The profiles and launched processes are cleaned in `finally`; individual protocol
calls and waits have 25-second deadlines, except the first Chrome reply after a
launch, which waits for a cold browser start (60 s, `BROWSER_STARTUP_MS` in
`apps/extension-shared/browser-check-watchdog.ts`). Chrome lists the extension
service worker before its `chrome` API is bound, so `chrome.ts` polls the worker
until `chrome.runtime.id` and `chrome.tabs.captureVisibleTab` exist (bounded at
10 s, `extension-worker.ts`) and records the polls in `workerReadiness`. The
fixture-only checks (`video`, `editor`, draft storage, Firefox video) bound browser
startup and the silence between page beacons separately instead of one clock
from spawn. Do not interpret a successful launch,
installation, or partial result as a successful end-to-end journey.

## Observed scope — 2026-10-07

Chrome 154.0.8037.98 loaded the actual extension using CDP's extension installation
and toolbar-action APIs. The completed journey observed zero native screenshot
calls on opening the popup, one call after the explicit capture click, screenshot
preview, crop and opaque pixel redaction, encrypted draft save/lock/page-reload/unlock/resume,
and an actual downloaded ZIP accepted by the independent CLI verifier. The
capture-call counter forwards the original native browser API; it does not supply
or replace screenshot bytes. The redaction oracle independently decodes the
preview PNG and checks every pixel, including alpha. The downloaded PNG must also
match the exact reviewed media SHA-256. The latest receipt is the
authority for the exact build and recipe covered.

Firefox 157.0 with geckodriver 0.37.1 installed the temporary extension and opened
its action popup. Early attempts were blocked at popup activation: Classic
WebDriver rejected the XUL popup frame with `no such frame`; BiDi did not expose
that popup as a browsing context; keyboard actions did not open the capture
editor before the deadline. The same limitation was observed in headless and
headed disposable profiles. That was a harness limitation, not evidence that the
Firefox screenshot capability fails. The Firefox command deliberately exits
nonzero for blocked or partial runs. Those early attempts did not qualify draft, redaction or export. The later RDP
journey below supersedes that limitation for its exact build.

The native-control discovery also returned `FileNotFoundError` for the selected
`orca` executable. No user-profile window was inspected to work around it.

## Primary references

- [Chrome CDP Extensions protocol](https://chromedevtools.github.io/devtools-protocol/tot/Extensions/)
- [Official protocol schema, including loadUnpacked and triggerAction](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json)
- [Mozilla geckodriver usage](https://firefox-source-docs.mozilla.org/testing/geckodriver/Usage.html)
- [Mozilla temporary profiles](https://firefox-source-docs.mozilla.org/testing/geckodriver/Profiles.html)
- [Mozilla flags and the explicit UI-testing system-access flag](https://firefox-source-docs.mozilla.org/testing/geckodriver/Flags.html)
- [Mozilla geckodriver releases](https://github.com/mozilla/geckodriver/releases/tag/v0.37.1)

Chrome's unsafe-extension-debugging flag and Firefox's UI-testing system-access
flag are restricted to these synthetic temporary profiles. They are not
instructions to weaken a user's usual browser configuration.

## Separate Firefox video fixture

`bun tools/browser-check/firefox-video.ts` runs the synthetic canvas/oscillator
fixture as a normal page in a fresh Firefox profile. It does not qualify extension
installation, screen-source permission, or microphone permission. Autoplay is
allowed only inside that disposable profile. The diagnostic wrapper forwards
native media calls unchanged and records only opaque object IDs, method names and event names; no video/audio bytes
are logged. Bundle and recipe hashes identify each run.

The initial Firefox 157 runs timed out after 25 seconds, including one run where
recording, playback and frame callbacks were observed. No decoded-video or audio
success is claimed from those partial events. The receipt records `unverified`
and the command exits nonzero when the fixture does not report completion.

A later run against the explicit canvas-frame implementation returned a concrete
refusal on Firefox 157: `Capture de frame explicite indisponible`. Bundle
`57dfeb6f300c01f6d8941c00a8293d8c55db584f61ceb39e01de7433ec4c6c04`
reached native recording/playback and rejected the unavailable explicit-frame
method before reencoding. This is a fail-closed capability refusal, not a pass.

## Native quota and process restart — 2026-10-07

The Chrome run at `2026-10-07T06:57:56.492Z` covered editor bundle
`0554b6d78b7bede888914461bd173999c585b0c8b20fc2013edc460f4b0c2ae2`.
It closed the browser process, relaunched the same disposable profile, checked
that the editor initially had no passphrase or screenshot, rejected loading while
locked, then recovered the original draft after unlocking. The encrypted envelope
revision and ciphertext hash remained identical across that process restart.
The resumed draft exported successfully through the independent ZIP verifier.

The separate native quota experiment is **unverified**: on the extension's page
session, `Storage.overrideQuotaForOrigin` was accepted and usage reporting exposed
an active one-byte quota, but saving a second real screenshot of synthetic random
pixels succeeded without `QuotaExceededError`. The override was restored before
restart. This does not establish atomic preservation on native quota failure;
the receipt is partial. No product storage error was injected to replace that
missing browser evidence.

The verdict over that receipt is taken twice (`receipt.ts`). The required
`Bun quality` job runs `chrome.ts --native-quota=non-required`: it admits a
`partial` receipt only when native quota is the sole shortfall and all nine
other steps are present in order, and fails on any other missing, extra,
reordered or failed step. The same job then re-reads the published file with
`receipt.ts test-results/browser-check/chrome --native-quota=non-required`,
because `chrome.ts` judges its in-memory evidence: without that step, a run
that wrote no `evidence.json` kept `Bun quality` green (mutation run
37929950167). The receipt is published as the
`chrome-qualification-receipt` artifact on every run. The separate, non-required
`Native quota qualification` job downloads that same receipt and applies
`--native-quota=advisory`: the `required` verdict, except that an unverified
native quota (`quota.unverified`, and that code alone) is reported as the
warning annotation `native quota unverified (non-required, owner decision D2)`
and in the job's step summary instead of failing the job, so the workflow
conclusion stays green while native refusal is unobserved. A missing,
unreadable, ambiguous, failed or inconsistent receipt still fails that job.
The workflow uses no `continue-on-error`, which would swallow those failures too.
Without a flag, `chrome.ts` keeps requiring native quota; `advisory` is
accepted only by `receipt.ts`.

Firefox video's latest diagnostic run reached native `seeked`, playback `ended`,
and the transcode recorder's `stop()` invocation, but no corresponding recorder
`stop` event arrived before the 25-second deadline. That run remains unverified.

Native UI hold mode has been removed. The host CUA attempt exceeded its requested
timeout and returned after the disposable window closed; no UI action followed.
Qualification now uses only isolated CLI-controlled browser profiles.

## Separate production storage probe

The Chrome runner first opens a separate synthetic page whose bundle imports the
real `DraftVault` and `IndexedDbStore` modules. On 2026-10-07, its five assertions
passed: a real WebCrypto ciphertext persisted in native IndexedDB; an actual
256 MiB + 1 byte buffer was rejected by the application before disk write; the
production compare-and-swap conflict aborted; a native `put` success followed by
`transaction.abort()` rolled back; and the original draft decrypted afterward.
Ciphertext hashes and revision equality are independently checked after each
refusal or abort. The test database is deleted and the page closed afterward.
This proves the application guard and transaction atomicity, not engine quota
exhaustion. The native engine-quota probe remains a separate unverified result.
The first run failed on the unimplemented fixture; the implemented fixture then
passed with bundle `b8dc8563b35b692e981e4e82acab18c9bd288d6eedcc9576808f7d915c1a6efc`.

The Firefox MIME correction (sanitizer SHA-256
`8e9a18dbb3f7a4957168f9fd46f14e4fc65766f0224c0d18c2413e5010250e3d`)
resolved the missing recorder stop event in a later run. That run instead refused
the resulting WebM container. The diagnostic runner adds only container element
IDs to that synthetic refusal through a build-time fixture transform; it does not
change the production filter or emit video payload bytes.

### Latest Firefox video result

Firefox 157 passed all ten synthetic video assertions at
`2026-10-07T07:31:50.518Z` (exit 0), after dropping the optional CodecName metadata.
Parser source was `804a6a52aa555875176fd53fa327166855a8500a6e49a99ab6beb261d00a526a`;
sanitizer source was `746a169dd99f2020a4a250c7d274696223e22a5ab8016bfee9dec51e5b6a1d44`.
The executed bundle was
`a71cd7e6a23e0c9ac01ba88591db0cf38619406b257d6738a34d5d2087ce9e0a`.
Both silent and audio transcodes passed container policy, decoded masking, and
mask checks across all decoded frames. The silent result had no audio track;
the audio result had nonzero decoded PCM energy. This supersedes the earlier
pipeline failures for this exact snapshot, without qualifying extension source
selection or microphone permission. Temporary profile and processes were removed.

## Latest installed-extension results — 2026-10-07

Firefox 157 completed the installed-extension journey (exit 0) at
`2026-10-07T07:43:22.171Z`, with editor bundle
`8688825f115ecc65cc3ec6d05dd291aec2b474f26f7bb497991319cf50b9c361`.
The native extension action supplies the ordinary activeTab authorization; a local
DevTools connection then selects the exact existing popup by URL and browsing
context and clicks its real capture button. No manual permission grant, debugger
TCP listener, product handler replacement, or ordinary profile is involved. This
qualifies native-action activation plus programmatic popup DOM interaction; it
does not prove operating-system mouse hit-testing.

The run verified no editor before the explicit capture click, PNG preview,
400x300 opaque black pixels after crop/mask, encrypted draft save/lock/page-reload/
unlock/resume, and the downloaded ZIP with the independent CLI verifier. A
transparent observer forwards native URL.createObjectURL and hashes its original
Blob; the exported PNG matches the exact reviewed Blob hash
`654d5d5e3c27428661e85c8f8a9ff90ba6f05b13433a4ae503549f82b3149e23`.
This avoids the test context's blocked blob fetch without substituting media.
Firefox recipe hash:
`bc3703c733c2c38e62d18d8ffb53cd969debe26d008bc164a60b446bf7c4c821`.
Popup RDP recipe hash:
`eb2714bd69f657b09c1ad82baf2590e2e2790657e3a01d53fc78e76aa0ee5181`.

Chrome 154 requalified the same editor bundle at `2026-10-07T07:43:26.491Z`,
including the separate application-storage probe and actual browser-process
restart. Its receipt remains **partial, exit 1**, because engine quota refusal
could not be induced with the native one-byte override. The required CI command
intentionally stays red for this missing qualification; application quota and
native transaction-abort assertions do not replace it. A draft PR must remain
non-mergeable while this gate is incomplete.

Additional Mozilla primary references for the local DevTools route:

- [Debugging extension popups](https://extensionworkshop.com/documentation/develop/debugging/#debugging-popups)
- [Firefox debugging protocol](https://firefox-source-docs.mozilla.org/devtools/backend/protocol.html)
- [Addon command factory](https://github.com/mozilla-firefox/firefox/blob/main/devtools/shared/commands/commands-factory.js)
- [Script command target selection](https://github.com/mozilla-firefox/firefox/blob/main/devtools/shared/commands/script/script-command.js)

The final reruns include the rebuilt third-party notice digest
`9b6a90e9be78799534e4030d71b6817271fb99aa10e261f9f9f6dec1cff4177a`.
The public-source scanner initially rejected the compressed inline editor RDP
script; formatting it as readable statements with an explicit addon identifier
resolved the finding without changing the identifier, behavior or scanner rule.
The full Firefox journey was rerun successfully after that formatting change.
