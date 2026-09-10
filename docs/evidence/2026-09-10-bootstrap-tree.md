# Bootstrap staged-tree evidence — 2026-09-10

## Scope

This record covers the staged product tree before the root commit. It contains no
captured content, provider-instance configuration, credential, or private identity.
The final ref/object manifest is necessarily produced outside this repository after
the commit, because embedding that manifest here would change the objects it attests.

## Toolchain and authority

- Bun revision: `1.4.0-canary.1+57f349f63`
- Governance pin: `94fc054c6b16e047eb0736e12444a08d50728efc`
- Governance enrollment: merged by owner in `libre-ai/governance#106`

## Negative counterproof

A synthetic file outside the repository contained a constructed authorization header.
It was passed explicitly to:

```sh
bun tools/ci/check-public-boundary.ts --path <external-synthetic-canary>
```

Observed result:

- exit code: `1`
- finding code: `captured-credential`
- output disclosed the synthetic basename and code only, never its bytes or ambient path
- the external canary was deleted and verified absent before the positive gate

## Positive staged-tree proof

The tree was staged with `git add --all`. Before this evidence file was added, the
candidate content comprised 55 files and had this Git tree OID:

```text
06ee47286b047117cb8b8a16e8cd7366faae3ffd
```

This OID deliberately identifies the pre-evidence content tree, not the later root
commit or its final tree. The non-recursive final manifest is retained in Governance.

The exact staged content then passed:

```sh
bun install --frozen-lockfile
bun run check:tree
```

Observed result:

- dependency install: no changes
- public boundary: 55 files, 0 findings
- project cards: 1 assertion
- qualification baseline: 8 documents, 0 findings
- Biome: 16 files, no warnings or fixes
- TypeScript: exit code 0
- tests: 62 passed, 0 failed, 96 assertions
- overall exit code: `0`

The complete gate is rerun after this file is staged and again after the immutable root
commit, so this record cannot substitute for the final history proof.
