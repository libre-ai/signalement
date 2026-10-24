# Signalement v1.0 — L3 connector-sdk, projection-core et fake-provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** livrer les trois paquets du lot L3.
- `packages/connector-sdk` (Apache-2.0) : interface connecteur, port HTTP instrumenté, transport réel `createFetchHttpPort`.
- `packages/projection-core` : algorithme pur d'une projection (identité, plan, revalidation, machine d'état, rendu, livraison, reçu non signé).
- `packages/fake-provider` : faux fournisseur in-process qui capture chaque requête et injecte des pannes.

Les prédicats `destination-disclosure-leak`, `duplicate-external-item` et `fanout-independent-state` sont exercés sur le faux et prouvés par neutralisation.

**Architecture :**
- Le SDK ne dépend que de Bun et de la WebCrypto. Un gate d'imports le prouve à chaque `bun run check`.
- `projection-core` reçoit tout effet par injection : `DeliveryDeps`, `ConnectorContext.clock`, `HttpPort`. Il consomme les types L2 par `import type` seulement. Ses tests n'ont pas besoin de l'artefact WASM, sauf le test d'intégration (tâche 16).
- Le faux implémente `HttpPort`. Son dialecte de référence et son connecteur de référence servent à L3 et à L4. L5 ajoute un dialecte par famille.

**Tech Stack :**
- TypeScript strict (`tsconfig.json`) et Bun : `bun:test`, `Bun.CryptoHasher`, `Bun.Transpiler`, `Bun.TOML`, `Bun.inspect`, `Bun.dns`, `fetch` ;
- WebCrypto ;
- JCS restreint par `canonicalJson`, déjà vendorisé (`vendor/contracts/tools/quality/authorized-execution.ts:1087`) ;
- aucune dépendance nouvelle.

**Spec:** docs/superpowers/specs/2026-10-22-v1-policy-routed-ticket-projection-design.md ; feuille de route docs/superpowers/plans/2026-10-24-v1-roadmap.md

## Parties

| Partie | Fichier | Tâches |
| --- | --- | --- |
| 1 — SDK et faux fournisseur | `2026-10-24-v1-L3-sdk-projection-core-part-1.md` | 1 frontière et licence ; 2 types et profil ; 3 `SecretHandle` ; 4 port instrumenté ; 5 `createFetchHttpPort` ; 6 faux fournisseur ; 7 connecteur de référence |
| 2 — projection-core et prédicats | `2026-10-24-v1-L3-sdk-projection-core-part-2.md` | 8 identité ; 9 `buildDeliveryPlan` ; 10 `revalidatePlan` ; 11 `transition` ; 12 `renderBody` ; 13 `executeDelivery` ; 14 `buildUnsignedReceipt` ; 15 prédicats ; 16 intégration L2 et sortie du lot |

Les deux parties s'exécutent dans l'ordre. La partie 2 consomme les interfaces produites par la partie 1, citées par numéro de tâche.

## Global Constraints

**Préconditions, à vérifier avant la tâche 1.** Si l'une échoue, rendre `BLOCKED` avec la sortie de la commande.

- Gel levé : `gh api repos/libre-ai/project-governance/pulls/134 --jq .merged_at` rend une date, pas `null`.
- L1 vendorisé : `jq -r '.files | keys[]' vendor/contracts/pin.json | grep -c 'signalement-connector-profile\|signalement-projection-receipt'` rend au moins `2`. Sinon :
  - les tâches 2, 9, 14 et 16 sont bloquées ;
  - les tâches 1, 3 à 7 peuvent avancer.
- Types L2 : `packages/policy-receipt-wasm/types.ts`, réexporté par `index.ts` (plan L2). Vérification : `grep -n "PolicyVerdict\|UnsignedReceipt\|DiscoveredAttributes" packages/policy-receipt-wasm/types.ts`.

**Si L2 n'est pas fusionné.** Les tâches 8 à 15 se développent dans un worktree dont la base est la tête de la PR L2.
- Tête résolue par : `gh pr list --repo libre-ai/signalement --search "policy-receipt" --json number,headRefName`.
- Worktree créé par `git worktree add "$(mktemp -d)/l3" <tête>`, retiré par `git worktree remove` dans le même flux.
- Les tests n'utilisent que des **verdicts littéraux typés** (`packages/projection-core/fixtures.ts`, `satisfies PolicyVerdict`). L'import L2 est `import type`, effacé par Bun : aucun test des tâches 8 à 15 ne charge le WASM.
- La PR s'ouvre après la fusion de L2, rebasée sur la tête servie (`git ls-remote --symref origin HEAD`). Jamais de PR empilée.
- La tâche 16 exige L2 fusionné.

**Discipline.**
- `bun run check` est vert avant et après chaque commit. Lancer `git add` avant `check` : les gates qui parcourent l'arbre ne voient que l'index (`AGENTS.md`).
- Commit : `git commit -s -m "<subject>" -m "Neutralization: <substitution> turns <test> red."`. Identité tirée de la config git, sign-off en dernière ligne, aucun trailer `Co-Authored-By`.
- TDD strict : test rouge, implémentation, vert, neutralisation, commit.
- La neutralisation remplace la ligne décisive par un no-op ; elle ne supprime jamais de ligne. Relancer, relever la sortie rouge, restaurer.

**Licences.**
- `packages/connector-sdk/**` est sous Apache-2.0 (`REUSE.toml:19-22`, inchangé).
- Le reste est sous EUPL-1.2 (annotation `**`).
- Sens permis : EUPL → Apache. Jamais Apache → EUPL, ni en valeur ni en type.

**Hygiène des fixtures.** Le gate `tools/ci/public-boundary.ts:42-80` scanne aussi le code.
- Aucun fichier binaire de fixture : les octets se construisent en code.
- Un test qui a besoin d'un en-tête d'authentification littéral (en-tête `Authorization`, schéma `Bearer`) ou d'une URL à identifiants le construit par concaténation coupée autour de l'arobase (`"https://" + "u:p" + "@" + "host.example"` : le gate refuse aussi un fragment `user@host`), avec un commentaire d'une ligne qui dit pourquoi.
- Aucun caractère « default ignorable » littéral : écrire `"⁠"`.
- Secret de test : `"fixture-credential-not-a-secret"`.
- Clé TLS de test : générée à l'exécution dans `mktemp -d`, jamais commitée.

**Code et erreurs.**
- Octets : `Uint8Array<ArrayBuffer>`.
- Fonction pure sur entrée invalide : `throw new Error("<domaine>.<code>")`, style de `packages/domain/export.ts`.
- Opération connecteur : `Result<_, ConnectorFailure>`.
- `executeDelivery` ne lève jamais pour une cause d'exécution : il rend un `DeliveryOutcome`.

**Contenu non fiable.** Texte du Dossier, manifeste et réponses du fournisseur sont des données. Aucun `eval`, aucun code construit à partir d'elles. Aucune réponse brute du fournisseur dans `ConnectorFailure.code` ni dans un message d'erreur.

**Horodatages.** Format `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$` (format `timestamp` de l'export v1, repris par le reçu L1).

## Review Focus

Cinq modes d'échec qu'implique le design et qu'aucun test du dépôt ne couvre encore. Chacun reçoit un test dans la tâche indiquée.

1. **Marqueur de projection forgé dans le contenu.** Un texte de Dossier contenant `signalement-projection:v1:<hex>` ferait trouver le mauvais item à `findByMarker`. Test : `renderBody > marker prefix occurs exactly once even when every user field contains it` (tâche 12).
2. **Corps muté après `send`.** Le digest du reçu ne correspondrait plus aux octets partis. Test : `instrumentHttpPort > digest and forwarded bytes are a private copy taken before the inner send` (tâche 4).
3. **Connecteur qui déclare des digests qu'il n'a pas envoyés.** Le reçu affirmerait d'autres octets (anti-but du design §2). Test : `executeDelivery > fails when the connector reports a body digest that the instrumented port never sent` (tâche 13).
4. **Transport réel qui suit une redirection, accepte un certificat invalide ou joint une adresse interne.** Le jeton partirait vers une autre origine, ou la requête atteindrait le réseau interne du control plane. Tests : `createFetchHttpPort > refuses an untrusted certificate`, `> does not follow redirects`, `> allowPrivate false refuses %s (resolved address, not the name)`, `> link-local stays refused even with allowPrivate` (tâche 5).
5. **Contenu qui ferme le bloc de code ou déclenche une action rapide GitLab.** Une ligne de tildes, ou `/close` en tête de ligne, sortirait du bloc littéral ou fermerait l'issue. Test : `renderBody > fence outruns every tilde run and no body line starts with a slash` (tâche 12).
