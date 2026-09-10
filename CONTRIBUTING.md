# Contributing

Signalement follows the [Libre AI contribution policy](https://github.com/libre-ai/governance/blob/main/CONTRIBUTING.md).
Every commit must satisfy the Developer Certificate of Origin with an author-matching
`Signed-off-by` trailer. No Contributor License Agreement grants proprietary relicensing.

## Before opening a pull request

```sh
bun install --frozen-lockfile
bun run check
```

Logic changes start with a failing test and include contract, integration, and end-to-end
coverage proportional to the affected boundary. Lint and typecheck warnings are failures.

Do not commit captured pages, screenshots, videos, production configuration, credentials,
personal data, or provider-instance fixtures. Use reserved `.test` or `.invalid` identities
and synthetic artifacts generated outside Git history.

Suspected vulnerabilities, exposed secrets, and exploit details must never enter a public
issue or pull request. Use the [private fleet security intake](https://github.com/libre-ai/governance/security/advisories/new).

Architecture or public-contract changes require an ADR. A provider, browser, or execution
capability remains unqualified until its exact versioned acceptance suite passes; a mock or
interface alone is not an operational integration.
