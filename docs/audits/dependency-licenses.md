# Dependency license and vulnerability audit

Audit date: 2026-09-10

Scope: the exact `bun.lock` dependency graph installed for the repository foundation.
The product has no runtime dependency at this stage; every package is development or
fleet-governance tooling.

## Result

- No AGPL, SSPL, proprietary, or missing license was found in installed package
  manifests.
- Accepted identifiers are EUPL-1.2, Apache-2.0, MIT, BSD-2-Clause, BSD-3-Clause, and
  ISC.
- `bun audit --json` returned an empty advisory object for the locked graph.
- `npm audit` is not evidence for this repository because npm refuses a Bun-only lock;
  no `package-lock.json` was generated to manufacture a second dependency authority.

## Package families

| Package family | Locked version | Declared license |
| --- | --- | --- |
| `@libre-ai/governance` | Git commit pinned in `package.json` | EUPL-1.2 |
| `@biomejs/biome`, platform CLI | 2.5.3 | MIT OR Apache-2.0 |
| `typescript`, platform binaries | 7.0.2 | Apache-2.0 |
| `@types/bun`, `bun-types` | 1.3.14 | MIT |
| `@types/node` | 26.4.1 | MIT |
| `ajv` | 8.20.0 | MIT |
| `ajv-formats` | 3.0.1 | MIT |
| `entities` | 8.0.0 | BSD-2-Clause |
| `fast-deep-equal` | 3.1.3 | MIT |
| `fast-uri` | 4.1.4 | BSD-3-Clause |
| `json-schema-traverse` | 1.0.0 | MIT |
| `require-from-string` | 2.0.2 | MIT |
| `undici-types` | 8.3.0 | MIT |

Development-only manifests nested in installed tools also declared ISC or MIT. They
do not become Signalement runtime dependencies.

## Reproduction

```sh
bun install --frozen-lockfile
bun pm ls --all
find node_modules -name package.json -type f -print0 \
  | xargs -0 jq -r '[.name, .version, .license] | @tsv' \
  | sort -u
bun audit --json
```

Re-run on every lockfile change. A changed, missing, ambiguous, AGPL, SSPL, or
proprietary license blocks adoption until reviewed explicitly.

## Product implementation recheck — 2026-10-07

Ajv 8.20.0 and ajv-formats 3.0.1 are now explicit development dependencies at the
versions already present in the locked governance graph. The standalone generated
validator is distributed under MIT with its upstream attribution; extension bundles
include that notice, the EUPL-1.2 license and the application attribution.

The fresh Bun audit initially rejected fast-uri 4.1.4 for
[host normalization](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj) and
[mailto header handling](https://github.com/advisories/GHSA-jvvf-x445-j334).
The exact override and lock were updated to the upstream patch 4.1.5.
`bun audit --json` then exited 0 with `{}`; `bun pm ls --all` lists only fast-uri
4.1.5 in the resolved graph. Old unreferenced install-cache manifests are not an
alternative lock authority. Installed manifest license inspection found the same
permitted license families, including BSD-3-Clause for the patch. The repository
toolchain gate passed. This is an advisory-database snapshot, not a claim that no
unknown vulnerabilities exist.
