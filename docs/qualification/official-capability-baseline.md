# Official capability baseline

Verified against primary vendor documentation on 2026-09-10. This document records
documented platform capabilities and constraints; it does not qualify any Signalement
implementation. Every browser and provider row remains `unresolved` until a pinned real
environment passes its acceptance suite.

## Browser capture

### Chrome

- `tabs.captureVisibleTab()` captures only the visible area. It requires `activeTab` or
  `<all_urls>`, is capped at two calls per second, and can reach otherwise restricted
  pages when `activeTab` is granted. Signalement must therefore deny unsupported schemes
  itself and must never infer that a screenshot is a full-page capture.
- `tabCapture` provides a tab `MediaStream` only after a user invokes the extension.
  Audio is optional in the API, but remains disabled by Signalement unless the user
  explicitly includes it for that recording.

Sources:

- [Chrome `tabs` API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Chrome `tabCapture` API](https://developer.chrome.com/docs/extensions/reference/api/tabCapture)
- [Chrome screen-capture guide](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture)

### Firefox

- `tabs.captureVisibleTab()` captures the visible area and requires `activeTab` or
  `<all_urls>`; `activeTab` support for this method begins with Firefox 126.
- The shared WebExtension screenshot surface is not evidence of an extension-native
  tab-video API equivalent to Chrome `tabCapture`. Recording must be qualified through
  the exact Firefox path selected after an explicit user gesture.

Sources:

- [Mozilla `tabs` API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs)
- [Mozilla `tabs.captureVisibleTab()`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/captureVisibleTab)
- [Web `getDisplayMedia()`](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)

### Safari

- Safari Web Extensions share common manifest and JavaScript formats, but ship inside
  an Apple app extension. Distribution requires Apple packaging and signing; this is a
  separate delivery profile, not a build alias for Chrome.
- Apple recommends `activeTab`, host permissions, and optional permissions rather than
  `<all_urls>`. The current official Safari Web Extension documentation found here does
  not establish parity with Chrome `tabCapture`; video and audio capture therefore stay
  unresolved until tested in the pinned Safari/macOS/Xcode profile.
- Real Safari execution uses Apple's `safaridriver`. Playwright's patched WebKit build
  is useful preflight coverage but Playwright explicitly does not drive branded Safari,
  so WebKit success cannot qualify Safari.

Sources:

- [Safari Web Extensions](https://developer.apple.com/documentation/safariservices/safari-web-extensions)
- [Safari Web Extension permissions](https://developer.apple.com/documentation/safariservices/managing-safari-web-extension-permissions)
- [Safari WebDriver](https://developer.apple.com/documentation/safari-developer-tools/webdriver)
- [Playwright browser support](https://playwright.dev/docs/browsers)

## First provider profiles

### GitHub Issues and Projects

- The versioned Issues REST API documents issue creation and comments with repository
  `Issues: write` permission. The documented create-issue body contains text and issue
  metadata, not a binary attachment field. Binary evidence publication therefore needs
  a separately qualified storage/link strategy; UI automation is forbidden.
- GitHub Projects is a distinct GraphQL projection. Linking an Issue to a Project and
  updating its fields are separate mutations, so their idempotency and partial-failure
  states must be modeled independently.

Sources:

- [GitHub create-issue REST endpoint](https://docs.github.com/en/rest/issues/issues)
- [GitHub issue-comment REST endpoint](https://docs.github.com/en/rest/issues/comments)
- [GitHub Projects GraphQL API](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects)

### Jira Cloud

Jira Cloud REST v3 documents multipart attachment upload and requires the
`X-Atlassian-Token: no-check` header for that endpoint. Cloud authentication, scopes,
fields, limits, and error behavior form one exact provider profile.

Source: [Jira Cloud REST v3 attachments](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-attachments/)

### Jira Data Center

Jira Data Center exposes REST `api/2`, has version-specific references, and documents
PAT or OAuth 2.0 as preferred authentication. Atlassian explicitly directs integrators
to the documentation matching the installed Jira version. No Data Center adapter can be
qualified before the target instance reports its exact product and version.

Sources:

- [Jira Data Center REST introduction](https://developer.atlassian.com/server/jira/platform/rest/v10001/intro)
- [Jira Data Center REST examples](https://developer.atlassian.com/server/jira/platform/jira-rest-api-examples/)

## Consequences locked by this baseline

1. Chrome, Firefox, and Safari have separate manifests, packaging, permissions, and
   evidence even where source code is shared.
2. Playwright is the first portable scenario engine, not proof of branded Safari or
   branded Firefox behavior. Native WebDriver profiles complement it where required.
3. GitHub Issues and GitHub Projects are separate projections. Jira Cloud and each
   pinned Jira Data Center profile are separate adapters.
4. A documented API surface is only an input to qualification. It never changes a
   provider or browser status to operational without a real acceptance run.
