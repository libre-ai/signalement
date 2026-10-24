# Signalement v1.0 L1 — contrats publics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** publier dans `libre-ai/schemas-and-contracts` les cinq contrats du registre §4.1
(`signalement-routing-policy-v1`, `signalement-delivery-envelope-v1`,
`signalement-projection-receipt-v1`, `signalement-connector-profile-v1`,
`signalement-policy-receipt-v1`), avec sémantique normative, fixtures, vérificateurs, corpus
de signature et oracle indépendant ; les verrouiller quand L2 passe leurs vecteurs ; les
vendoriser dans `signalement` par un `vendor/contracts/pin.json` généralisé à plusieurs
contrats, sans changer un octet normatif de l'export v1 ; livrer côté `signalement` le seul
constructeur d'enveloppe (`packages/domain/delivery-envelope.ts`).

**Architecture:** deux dépôts, trois phases. Phase A (autorité) : chaque contrat entre au
catalogue en `candidate` par le registre des ajouts post-verrou, sur la branche
`work/signalement-v1-contracts` ; la PR est fusionnée par le propriétaire en `candidate`
(précédent `p02-export-v1`, PR #30). Phase B (`signalement`) : le gate de dérive apprend à
épingler N contrats (fusionnable seul), puis une branche vendorise les candidats pour L2,
rouge par construction sur `contract.not_locked:*` (feuille de route §2, seule dérogation).
Phase C : revues par rôle, verrou quand L2 est vert, ré-épinglage, module d'enveloppe.
Aucun code consommateur ne fusionne avant le ré-épinglage (design §8.3).

**Tech Stack:** JSON Schema 2020-12 (Ajv 8 strict), Bun + TypeScript strict, WIT, Ed25519
strict via `@noble/curves` (TS) et `ed25519-dalek` `verify_strict` (Rust, oracle), JCS RFC
8785 (`canonicalJson`, `tools/quality/authorized-execution.ts:1087` de l'autorité),
WebCrypto (`crypto.subtle.digest`, `crypto.randomUUID`) pour le module d'enveloppe.

**Spec:** docs/superpowers/specs/2026-10-22-v1-policy-routed-ticket-projection-design.md ; feuille de route docs/superpowers/plans/2026-10-24-v1-roadmap.md

## Parties

| Partie | Phase | Tâches |
| --- | --- | --- |
| `2026-10-24-v1-L1-contracts-part-1.md` | A, autorité (1/2) | 1 ADR, dossier, inventaire ; 2 enveloppe ; 3 profil ; 4 politique ; 5 reçu (structure, jeu de clés) |
| `2026-10-24-v1-L1-contracts-part-2.md` | A, autorité (2/2) | 6 signature et corpus ; 7 oracle Rust ; 8 monde WIT ; 9 PR et fusion des candidats |
| `2026-10-24-v1-L1-contracts-part-3.md` | B et C, `signalement` puis verrou | 10 `pin.json` v2 ; 11 vendorisation des candidats ; 12 revues ; 13 verrou ; 14 ré-épinglage et sortie ; 15 `packages/domain/delivery-envelope.ts` |

Ordre : 1→9 séquentiel ; 10 en parallèle de 1-9 ; 11 après 9 et 10 ; 12 après 9 ; 13 après
L2 vert + 12 ; 14 après 13 ; 15 après 14.

## Global Constraints

Valent pour toutes les tâches, en plus de la feuille de route §1.

**Faits volatils, toujours résolus.**

| Fait | Commande |
| --- | --- |
| Branche servie de l'autorité | `gh api repos/libre-ai/schemas-and-contracts --jq .default_branch` |
| Tête de l'autorité | `gh api repos/libre-ai/schemas-and-contracts/commits/HEAD --jq .sha` |
| Commit épinglé dans `signalement` | `jq -r .commit vendor/contracts/pin.json` |
| Branche servie de `signalement` | `git ls-remote --symref origin HEAD` |
| Réf. d'outillage de l'autorité | `grep -m1 -oE 'tooling_ref: [0-9a-f]{40}' .github/workflows/code-validation.yml \| cut -d' ' -f2` |
| Version `@noble/curves` de l'autorité | `jq -r '.dependencies["@noble/curves"]' package.json` (clone de l'autorité) |
| Crates de l'oracle existant | `grep -E '^(base64\|curve25519-dalek\|ed25519-dalek\|serde_json) =' tools/quality/build-brief-crypto-oracle/Cargo.toml` ; `sha2` : `grep -A1 'name = "sha2"' tools/quality/build-brief-crypto-oracle/Cargo.lock` |
| Date de l'ADR de l'autorité | `date -u +%F` au moment de la PR |
| Commit de fusion d'une PR de l'autorité | `gh pr view <n> -R libre-ai/schemas-and-contracts --json mergeCommit --jq .mergeCommit.oid` |
| Checks requis de `signalement` | `gh api repos/libre-ai/signalement/branches/main/protection --jq '.required_status_checks.contexts'` |

**Espace de travail de l'autorité.** Clone neuf sous `mktemp -d`, retiré en fin de lot par
`~/.claude/bin/scratch-clean "$WORK"`, avec `project-governance` à côté (devDependency
`"@libre-ai/governance": "file:../project-governance"`) :

```sh
WORK=$(mktemp -d)
git clone https://github.com/libre-ai/schemas-and-contracts "$WORK/schemas-and-contracts"
cd "$WORK/schemas-and-contracts"
TOOLING=$(grep -m1 -oE 'tooling_ref: [0-9a-f]{40}' .github/workflows/code-validation.yml | cut -d' ' -f2)
git clone https://github.com/libre-ai/project-governance "$WORK/project-governance"
git -C "$WORK/project-governance" checkout -q "$TOOLING"
git switch -c work/signalement-v1-contracts "origin/$(gh api repos/libre-ai/schemas-and-contracts --jq .default_branch)"
bun install --frozen-lockfile && bun run check   # baseline verte avant tout changement
```

**Règles de l'autorité qui priment** (son `AGENTS.md`, son `check-contracts.ts`) :

- statut catalogue : seulement `locked` ou `candidate` (`check-contracts.ts:54`) ; un
  candidat porte `review.state: "pending-independent-agent-review"`, `review.required`
  contenant `architecture` et `security`, et un dossier sous `docs/reviews/` qui cite
  `AGENT-REVIEW-PROTOCOL.md` (`check-contracts.ts:381-414`) ;
- `contracts/STATUS.md` se régénère (`bun tools/quality/catalog-status-page.ts --write`) ;
  `contracts/CATALOG.md`, `COMPATIBILITY.md` et `README.md` portent un libellé figé par
  des preuves de revue et **ne s'éditent pas** (le précédent P02 n'y touche pas) ;
- le catalogue égale la ligne de base transitionnée suivie exactement des `entry` de
  `contracts/catalog-post-lock-additions.v1.json`, dont l'empreinte est épinglée dans
  `tools/quality/specification-lock.ts` (`POST_LOCK_ADDITIONS_DIGEST`) ;
- un monde WIT : `contracts/wit/<nom>-v<N>/world.wit`, `package libre-ai:<nom>@<N>.0.0;`,
  `world <nom> {`, aucun `import`, un `export` et un `result<` (`check-contracts.ts:1257-1276`) ;
- adjoints `profiles`/`vectors` admis pour `kind: "wit"` seulement (`check-contracts.ts:419-437`).

**Procédure d'admission d'un contrat candidat (PAC).** Les tâches 2 à 5 et 8 l'appliquent.

1. Schéma `contracts/schemas/<fichier>` : `$schema` 2020-12, `$id`
   `https://contracts.libre-ai.fr/schemas/<fichier>`, `title`, `additionalProperties:
   false` partout, `maxItems` sur chaque tableau (`check-contracts.ts:132-144`), chaînes
   bornées, `$defs` locaux sans `$ref` vers `common.v1` (DL3).
2. `contracts/<id>/SEMANTICS.md` normatif (RFC 2119) : portée et ce que le contrat ne
   prouve pas, bornes, codes d'échec du vérificateur dans l'ordre produit, matériel de
   test synthétique, renvoi à `https://github.com/libre-ai/project-governance/blob/HEAD/docs/reviews/AGENT-REVIEW-PROTOCOL.md`.
3. `contracts/fixtures/<id>/schema-fixtures.json` (`libre-ai.schema-fixtures.v1`,
   **exactement un** cas `{ schema, valid, invalidMutations }`) et `vectors.json`
   (`{ schemaVersion: "libre-ai.<id>-vectors.v1", valid: [{ name, document }], invalid:
   [{ name, document | raw, failures }] }`, `raw` en base64url pour les octets non JSON,
   `failures` = tableau exact attendu).
4. `tools/quality/<id>.ts` (« Authority-fixture verifier only »), `.test.ts`,
   `.bunfig.toml` copié de `tools/quality/signalement-local-export-v1.bunfig.toml`
   (seuil 0.9). Imports admis : `./authorized-execution`, `./policy-core-raw-inputs`,
   `ajv`, `ajv-formats`, et `@noble/curves` pour le reçu : le jeu vendorisé reste clos.
5. `package.json` : `"check:<id>": "bun run check:bun:runtime && bun test
   --config=tools/quality/<id>.bunfig.toml tools/quality/<id>.test.ts"`, ajouté en fin de
   `check:contracts`.
6. Ajouter `<id>` à `SIGNALEMENT_V1_FIXTURE_DIRECTORIES` (tâche 1).
7. Entrée en fin de `contracts/catalog.v1.json` et même `entry` en fin du registre
   post-verrou (`decision` = ADR de la tâche 1, `ownerArbitration` = valeur donnée par le
   propriétaire, question Q2 de la tâche 1) ; `POST_LOCK_ADDITIONS_DIGEST` = `shasum -a 256
   contracts/catalog-post-lock-additions.v1.json | cut -d' ' -f1`. Champs : `owners:
   ["signalement"]` (+ `"specialized-rust"` pour le WIT), `consumers: ["signalement"]`,
   `compatibility: "major-versioned"`, `classification` et `review.required` de DL12,
   `review.dossier: "docs/reviews/signalement-v1-contracts-review.md"`, `status: "candidate"`.
8. Projections SDK (JSON Schema seulement) : `bun run --cwd packages/sdk-ts schemas:sync &&
   bun run --cwd packages/sdk-ts generate` ; `(cd crates/sdk-rs && bun
   scripts/check-vendored-schemas.ts --write)` ; chargement du `schema-fixtures.json` dans
   `packages/sdk-ts/src/registry.test.ts` et `crates/sdk-rs/tests/schema_fixtures.rs`
   (modèle : blocs P02).
9. Régénérer `contracts/STATUS.md`.
10. `bun run check` vert ; la ligne `Contracts verified: N catalog entries, M schema
    fixture pairs, …` gagne +1/+1 par schéma (+1/0 pour le WIT).
11. Commit des fichiers exacts : ceux de la tâche, plus `contracts/catalog.v1.json`,
    `contracts/catalog-post-lock-additions.v1.json`, `tools/quality/specification-lock.ts`,
    `contracts/STATUS.md`, `package.json`, `tools/quality/signalement-v1-fixture-inventory*.ts`,
    `packages/sdk-ts/schemas/<fichier>`, `packages/sdk-ts/src/generated/<nom>.d.ts`,
    `packages/sdk-ts/src/generated/manifest.json`, `packages/sdk-ts/src/registry.test.ts`,
    `crates/sdk-rs/schemas/<fichier>`, `crates/sdk-rs/tests/schema_fixtures.rs` ; puis
    `git status --short` vide avant `git commit -s`.

**Commits.** `git commit -s -m "<anglais>"`, sign-off en dernière ligne, aucun
`Co-Authored-By`. Tout commit qui ajoute un test répond aux deux questions de
`gate-integrity` §5 (neutralisation qui le fait rougir ; un refactor équivalent le
ferait-il rougir — l'attendu vient de la sémantique, pas de la sortie du code).

**Gouvernance.** L'agent n'écrit jamais `Owner-arbitration:` ni la valeur
`ownerArbitration` sans instruction explicite. L'ADR de l'autorité est `Status: proposed`
et cite D3, D6, D7, D8, D10, D12, D13 comme référence d'arbitrage (modèle
`docs/adr/2026-10-22-p02-v1-contracts.md`). Les fusions dans l'autorité sont faites par le
propriétaire.

## Décisions fixées par ce plan

| # | Décision | Pourquoi |
| --- | --- | --- |
| DL1 | Statut `candidate` partout avant le verrou | seul statut non verrouillé admis ; feuille de route §2 alignée |
| DL2 | Candidats fusionnés sur la branche servie de l'autorité avant L2 ; verrou = seconde PR | précédent P02 ; L2 épingle un commit de la ligne servie, le gate ne remonte que `contract.not_locked:<id>` |
| DL3 | Schémas autonomes, motifs repris de `signalement-local-export.v1.schema.json` (`id`, `digest`, `timestamp` sans fraction, `path`, `role`) | précédent du même produit ; jeu vendorisé fermé ; validateur autonome générable |
| DL4 | L'état `draft → approved → retired` vit **à côté** du document de politique (enregistrement d'organisation L4 qui référence `policyId`, `version`, `digest`) ; le document est immuable par (`policyId`, `version`) | dans le document, approuver ou retirer changerait ses octets donc `policyDigest` : digest approuvé, digest évalué et digest cité par les reçus divergeraient. À côté, `policyDigest` = SHA-256(JCS(document)) est stable sur tout le cycle ; `SEMANTICS.md` fixe états, transitions et « seule une version `approved` s'évalue » (refus porté par l'appelant) |
| DL5 | Reçu signé = reçu non signé + membre `signature: { algorithm: "ed25519", value }` ; `keyId` unique, dans le contenu ; message = UTF-8 `libre-ai.signalement-projection-receipt.v1` ‖ `0x00` ‖ SHA-256(JCS(reçu sans `signature`)) ; document entier exigé sous forme JCS | registre §4.2 : `UnsignedReceipt` = même contenu sans signature, `keyId` compris ; séparation de domaine sur le modèle `build-brief-acceptance-statement.v2` |
| DL6 | `exportSha256` (enveloppe) et `exportDigest` (reçu) = SHA-256 des octets exacts du ZIP | registre §4.1 ; vérifiable sans parser (L4, L6, L7) |
| DL7 | `PublicKeySet` = `$defs/signingKeySet` du schéma du reçu, ≤ 1024 clés, `status: active \| retired`, fenêtre `notBefore`/`notAfter` | registre §4.2 ; clés retirées gardées pour vérifier les anciens reçus |
| DL8 | Sémantique d'évaluation de la tâche 4 (union des règles appariées, refus dominant, retenue dominante, visibilité inconnue = tout retenir ; jamais `attachment-unsupported` ni `user-withheld`) | `evaluate` pur, reproduit octet pour octet par L2 ; registre §4.2 |
| DL9 | Oracle Rust neuf `tools/quality/signalement-receipt-crypto-oracle/`, versions exactes de `build-brief-crypto-oracle` | l'oracle existant ne lit que `libre-ai.build-brief-strict-ed25519-vectors.v2` ; aucune version de crate nouvelle |
| DL10 | `signalement` ajoute `@noble/curves` en devDependency, version exacte de l'autorité | le vérificateur vendorisé du reçu l'importe ; Ed25519 natif de Bun a accepté des falsifications à clé identité ; aucune dépendance installée ne fait d'Ed25519 strict |
| DL11 | `pin.json` v2 : `contracts[]` + table `files` unique | registre §4.1 ; fichiers partagés entre contrats |
| DL12 | Classification et revues requises ci-dessous | politique et reçu nomment des systèmes internes (D9) ; l'enveloppe porte l'origine observée d'une personne ; le profil est publié |

| Contrat | `classification` | `review.required` |
| --- | --- | --- |
| `signalement-routing-policy-v1` | `tenant-private` | `architecture`, `security`, `privacy` |
| `signalement-delivery-envelope-v1` | `personal` | `architecture`, `security`, `privacy` |
| `signalement-projection-receipt-v1` | `tenant-private` | `architecture`, `security`, `cryptography`, `privacy` |
| `signalement-connector-profile-v1` | `public` | `architecture`, `security` |
| `signalement-policy-receipt-v1` | `tenant-private` | `architecture`, `security`, `cryptography` |

## Review Focus

Cinq modes d'échec que le design implique et qu'aucun test existant ne couvre :

1. **Vérificateur vendorisé incompilable sous le `tsconfig` de `signalement`**
   (`exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`, absents de
   l'autorité). Test : tâche 9, typecheck sous les options du consommateur ; tâche 11,
   `bun run typecheck`.
2. **Vecteur adverse qui échoue pour la mauvaise raison** (rejet structurel avant la
   cryptographie, ou par l'équation avant le contrôle de point). Test : tâche 6, raison
   exacte par vecteur, et preuve que chaque vecteur de point est **accepté** par un
   vérificateur permissif (`zip215: true`) et que `s-non-canonical` passe une fois S
   réduit.
3. **Verrou qui modifie l'entrée du registre sans la ligne du catalogue.** Test : tâche
   13, égalité `entry` = ligne pour les 5 ids, `locked`, sans `review`.
4. **Ré-épinglage sur un commit hors ligne servie** (tête de PR écrasée par un squash).
   Test : tâche 14, commit résolu par `mergeCommit`, `merge-base --is-ancestor`, absence
   de `authority.unmerged`.
5. **Ré-épinglage qui change un octet normatif de l'export v1** (B5). Test : tâche 10,
   `local export normative files keep their bytes`, rejoué en tâche 14.
