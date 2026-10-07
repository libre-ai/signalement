# Native video sanitation and evidence boundary

No new dependency. The raw recording is quarantined locally. A new derivative is
created by decoding video frames, painting an opaque canvas with optional permanent
black masks, and recording that canvas. Audio is off by default at collection and
again at derivative creation. Opted-in audio is decoded through WebAudio and routed
only to a MediaStreamDestination, never implicitly to speakers. Playback and explicit
video/audio review are separate conditions before export. Seeking or changing speed
cannot satisfy uninterrupted playback evidence. That evidence cannot prove attention.

All rectangles apply throughout the clip. Temporal trimming, moving masks and selective
speech removal are unavailable; discard the whole audio track or video when necessary.
No automatic transcript/captions are fabricated. The UI exposes that limitation and
asks for an accessible written account in the observed-behavior field.

## Boundaries

- 60-second source recording; 64 MiB source/output; 16,777,216 decoded pixels;
  at most 128 bounded masks; sanitation cancels after 70 seconds.
- Frame zero is presented and rewound before canvas capture begins. Chrome uses
  explicit `CanvasCaptureMediaStreamTrack.requestFrame`. When unavailable, the
  separate fallback uses captureStream(30), subject to its own browser evidence.
- The page lock, pagehide and video-removal action abort active sanitation and stop
  capture tracks. The original and derivative are encrypted with the existing draft
  vault. Resume invalidates prior human review. Only the exact reviewed derivative
  is sent to the export domain.
- Fresh WebM output is parsed under an allowlist. Free-form names, timestamps, tags,
  attachments, chapters, seek tables and source software strings are discarded.
  Required software fields contain the constant `signalement`; TrackUIDs use local
  track numbers. Codec data is restricted to VP8/VP9 and the bounded OpusHead profile.
  Unknown elements fail closed. This restricted parser is for freshly reencoded
  streams, not arbitrary imported WebM containers or encrypted input formats.
- Container metadata removal is distinct from visual/acoustic redaction. Rendering
  can change color, cadence and compression; output must be reviewed. This pipeline
  does not claim lossless frame accuracy or perfect anonymization. Real-time capture
  and transcoding can be throttled in background tabs; timeout is a visible failure.
- The format constants follow the primary [Matroska element specification](https://www.matroska.org/technical/elements.html).

## Reproducible synthetic checks

`bun test apps/extension-shared/video-*.test.ts apps/extension-shared/browser-media.test.ts`
checks container rejection, geometry, review gates, playback seeking and resource
cleanup with explicit doubles; these are not browser qualification.

`bun apps/extension-shared/video.browser-check.ts` creates a fresh branded Chrome
profile and synthetic canvas/oscillator source. It decodes the resulting WebM to
check black masks, retained green pixels and nonzero decoded PCM; it verifies no
audio track in the silent variant and idempotent container filtering. The runner's
process-local autoplay override is synthetic-fixture setup, not evidence of real
permission or gesture behavior. No captured media is written to the repository.

`bun apps/extension-shared/editor.browser-check.ts` exercises the real UI with a
synthetic getDisplayMedia double, including raw-video refusal, sanitation, exact ZIP
bytes, encrypted save/resume and reapproval. Native MediaRecorder, canvas, WebCrypto
and IndexedDB run in the real browser. The download anchor is intercepted, so archive
byte equality is proved without claiming a filesystem download receipt.

Firefox and Safari require separately observed evidence; an engine substitute or
successful package build never qualifies them. Maximum resource workloads, background
throttling and spoken-word intelligibility remain separate qualification work.

Observed checkpoint (Chrome 154.0.8037.98, 2026-10-07): pipeline runner exited 0
with 10 semantic assertions including every presented derivative frame in the synthetic
clip and decoded audio energy, then passed again with a 2.2-second multi-cluster
source. UI runner exited 0 with 20 assertions, including exact
video bytes in ZIP, encrypted resume requiring fresh review, re-preparation resetting
approval, and lock during Blob conversion preserving the old durable draft. A separate
late-capture-after-lock run passed two assertions. The `--audio-fixture` UI variant
passed 23 assertions, including separate audio approval, encrypted audio resume and
subsequent audio removal. Lock also pauses and unloads preview decoders. Unit suites:
14 tests, 36 assertions. Strict TypeScript and targeted Biome checks passed.

Firefox 157 initially stalled after transcoding recorder stop. Requesting VP8 alone
for silent output resolved termination. The next explicit refusal identified the
optional CodecName element (0x258688); it is now dropped as free-form descriptive
text, while unknown track elements remain rejected. A red/green unit test covers
that difference. Firefox 157 then passed all 10 native pipeline assertions on the same synthetic
silent/audio fixture (2026-10-07, bundle SHA-256
`a71cd7e6a23e0c9ac01ba88591db0cf38619406b257d6738a34d5d2087ce9e0a`):
container policy, absent audio in silent output, nonzero decoded PCM, masked and
retained pixels, and masks on every presented derivative frame. This page-fixture
evidence does not qualify extension capture permissions or the installed extension
journey. Browser qualification results are tracked separately; no Safari video claim follows.

## Portable Chrome runner commands

Both runners honor `CHROME_BINARY`. The local default is the standard Google Chrome
application on macOS and `google-chrome` on other platforms. A missing executable
fails before creating a server or profile. Set the path explicitly in Linux CI;
installing a browser is a CI responsibility, and no sandbox-disabling flag is added.
Run as a non-root user with the browser sandbox available.

```sh
CHROME_BINARY=/usr/bin/google-chrome bun apps/extension-shared/video.browser-check.ts
CHROME_BINARY=/usr/bin/google-chrome bun apps/extension-shared/editor.browser-check.ts
CHROME_BINARY=/usr/bin/google-chrome bun apps/extension-shared/editor.browser-check.ts --audio-fixture
CHROME_BINARY=/usr/bin/google-chrome bun apps/extension-shared/editor.browser-check.ts --init-lock
```

These recipes are portable configuration; Linux execution must be separately observed.
The override was validated locally with branded Chrome on macOS. A nonexistent
binary is rejected with exit 1 by both runners; the pre-fix video runner ignored
that override and incorrectly succeeded.
