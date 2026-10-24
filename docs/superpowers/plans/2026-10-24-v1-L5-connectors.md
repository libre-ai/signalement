# Signalement v1.0 — L5 connecteurs et qualification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** livrer quatre choses :
- les quatre connecteurs exacts de la v1.0 : GitHub Issues, GitLab Issues, Jira Cloud et Plane auto-hébergé ;
- une suite de conformité commune, exécutée sur le faux fournisseur en CI et contre une instance réelle en mode qualification ;
- le format de l'évidence datée de qualification ;
- l'extension du gate `check:qualification` qui permet à une entrée de `qualification/provider-matrix.yaml` de passer à `qualified`.

**Architecture:**
- `connectors/<famille>/` : un module par famille, avec son profil exact, des constructeurs de requêtes purs et une fabrique de connecteur liée à un profil.
- `connectors/shared/` : les primitives partagées.
- `connectors/conformance/dialects/` : un dialecte de faux fournisseur par famille, branché sur `createFakeProvider` (L3).
- `connectors/conformance/` : la suite, qui exerce chaque profil par `executeDelivery` (registre §4.4). `findLeaks` (L3) y sert d'instrument au prédicat de divulgation. En mode réel, elle passe par `createFetchHttpPort` (SDK, registre §4.3), restreint à une liste d'origines.
- Le gate `check:qualification` lit une évidence JSON fermée sous `qualification/evidence/`.
- `connectors/index.ts` exporte `connectorFor` et `CONNECTORS`, les seuls points d'entrée consommés par L4 (registre §4.4 bis).

**Tech Stack:** Bun (version de `packageManager`), TypeScript strict, `bun:test`, WebCrypto, Docker Compose pour l'instance Plane locale. Aucune dépendance npm nouvelle.

**Spec:** docs/superpowers/specs/2026-10-22-v1-policy-routed-ticket-projection-design.md ; feuille de route docs/superpowers/plans/2026-10-24-v1-roadmap.md

## Parties

Le plan est découpé pour que chaque fichier reste sous le plafond du gate de frontière (65 536 points de code). La numérotation des tâches est continue d'un fichier à l'autre.

| Partie | Fichier | Tâches |
| --- | --- | --- |
| 1 — socle, suite, GitHub | `2026-10-24-v1-L5-connectors-part-1.md` | 1 socle et échecs HTTP ; 2 primitives ; 3 noyau de la suite ; 4 connecteur GitHub ; 5 conformance GitHub et preuves de discrimination |
| 2 — GitLab, Jira, Plane, registre | `2026-10-24-v1-L5-connectors-part-2.md` | 6-7 GitLab ; 8-9 Jira ; 10-11 Plane ; 12 registre `connectorFor` / `CONNECTORS` |
| 3 — qualification | `2026-10-24-v1-L5-connectors-part-3.md` | 13 évidence ; 14 gate `qualified` ; 15 exécuteur réel ; 16 environnement Plane ; 17 [attend le propriétaire] comptes réels ; 18 critère de sortie |

## Global Constraints

- **Discipline de test.** Sécurité > qualité > performance > complétude. TDD strict. Chaque test se prouve par neutralisation : substitution no-op, jamais suppression de ligne. Les réponses aux deux questions de `gate-integrity` §5 vont dans le message de commit (`-m "Neutralization: …"`).
- **Gates.** `bun run check` vert avant et après chaque commit. Les fichiers neufs sont stagés **avant** `bun run check`, parce que les gates de frontière lisent l'index.
- **Commits.** En anglais, `git commit -s` (identité de la config git, sign-off en dernière ligne). Aucun trailer `Co-Authored-By`, aucune ligne `Owner-arbitration:`.
- **Noms.** Les noms du registre (§4) sont repris tels quels. Les types SDK sont consommés tels que les fixe le plan L3, Task 2, avec le champ `ProjectionMarker.notBefore` du registre §4.3 :
  - requêtes et réponses : `OutboundRequest` (`auth: OutboundAuth | null`, jamais d'en-tête secret en clair), `OutboundResponse.requestBodyDigest` ;
  - cible et découverte : `DestinationTarget { destinationId, profileId, baseUrl, coordinates }`, `Discovery`, `RemoteAttributes`, `MappingReport` ;
  - items et marqueurs : `RemoteItemRef { kind, remoteId, remoteUrl }`, `ProjectionMarker { projectionId, deliveryKey, text, within, notBefore }` ;
  - contenus et requêtes d'écriture : `RenderedContent`, `CreateRequest`, `CommentRequest`, `AttachRequest`, `AttachmentReceipt`, `ChangePage`.
- **Helpers SDK.** `ok`, `err`, `connectorFailure`, `parseRetryAfter`, `instrumentHttpPort`, `createFetchHttpPort`, `SecretHandle`, ainsi que les accesseurs `profileIdOf`, `attachmentModeOf` et `lookupOf`, seuls moyens de lire les capacités d'un profil.
- **Imports.** Imports L3 en chemins relatifs avec extension `.ts` : `packages/connector-sdk/index.ts`, `packages/projection-core/index.ts`, `packages/fake-provider/index.ts`. Aucun import depuis `apps/`.
- **Secrets.** Les connecteurs n'appellent jamais `revealSecret` : l'authentification passe par `request.auth`, et seul le transport révèle le secret.
- **Digests.** Les connecteurs ne calculent jamais le digest d'un corps envoyé. Ils recopient `response.requestBodyDigest`, ou une liste vide si la valeur est `null`.
- **Codes d'échec.** Ils sont construits par `connectorFailure`, sous la forme `<famille>.<motif>`, avec `<famille>` parmi `github`, `gitlab`, `jira` et `plane`. Jamais de texte fournisseur.
- **Contenu non fiable.** Le texte d'un fournisseur (corps, titres, URL, noms de champs) est une donnée non fiable. Toute URL renvoyée par un fournisseur est validée avant d'entrer dans un reçu ou de recevoir des octets.
- **Capacités non prouvées.** Une capacité `unproven` du profil publié n'est jamais exercée en production : les accesseurs `attachmentModeOf` et `lookupOf` la traitent comme absente. La suite l'exerce comme hypothèse, par `asHypothesis(profile)` (Task 3). Une qualification réussie la publie en `supported`. Une capacité ne passe jamais de `unsupported` à `supported`.
- **Profils.** Chaque profil égale l'entrée de la fixture L1 `profiles.v1.json`, aux cellules `unproven` résolues près (`resolvesOnlyUnproven`, Task 3). La fixture porte déjà les décisions du registre §6 : l'authentification GitLab choisie par le propriétaire, et `lookup: unsupported` pour Jira.
- **Reprise par liste.** Elle est bornée deux fois : par la date de la première tentative (`marker.notBefore` moins 300 000 ms de tolérance d'horloge) et par un budget de 10 pages. Un budget épuisé rend `unavailable`, jamais une création.
- **Pièges du gate de frontière** (`tools/ci/public-boundary.ts:44-80`), dans le code comme dans la documentation :
  - aucune ligne d'en-tête d'autorisation littérale : la prose dit « en-tête `Authorization`, schéma `Bearer` » ;
  - aucune URL à identifiants intégrés : un test qui en a besoin la construit par concaténation, avec un commentaire d'une ligne ;
  - aucun chemin absolu sous un répertoire personnel, même comme segment d'URL (le motif est insensible à la casse) ;
  - aucun jeton à la forme d'un émetteur réel : les jetons de test valent `test-token-not-a-secret` ;
  - aucun fichier sous un segment `instance/`, `instances/`, `data/` ou `exports/`, aucun `.env` hors `.env.example`, aucun binaire `.png`/`.webm`/`.mp4`/`.zip` suivi.
- **Plane.** Plane est sous AGPL-3.0 (`gh api repos/makeplane/plane --jq .license.spdx_id`). C'est une cible d'API, tirée en image à l'exécution, jamais vendorisée ni importée. Les observations tirées de son code source datent d'une lecture au tag `v1.4.2`, le 2026-10-24 : ce sont des hypothèses, à rejouer sur la version épinglée.

## Review Focus

1. **Écriture répondue en 5xx après création effective.** La passerelle renvoie 502 alors que l'item existe ; un simple « retry » relancerait une création à l'aveugle.
   - Tests : « 5xx on a write is ambiguous » (Task 1) ; cas `resume-after-cut-create-5xx` sur `serverError(match, 502, true)` (Task 3, exercé par chaque famille).
2. **Item planté portant le marqueur.** Dans un dépôt public, n'importe quel compte peut publier le marqueur ; adopter cet item ferait publier les révisions chez un tiers.
   - Tests : `findByMarker ignores an item carrying the marker but authored by another account` (Tasks 4, 6, 10) ; cas `recover-ignores-foreign-marker` (Task 3).
3. **URL fournisseur vers une autre origine** : URL distante d'un reçu, ou URL présignée de Plane.
   - Tests : `checkedRemoteUrl` (Task 2) ; `presigned upload URL outside the storage origin is refused with zero storage request` et `storage request carries no auth` (Task 10) ; cas `remote-url-untrusted-refused` (Task 3).
4. **Pièce jointe Plane lisible anonymement, ou tronquée en silence.** L'exemple de l'API porte `acl: public-read`, et le serveur applique `min(size, FILE_SIZE_LIMIT)`.
   - Tests : `acl other than private → unsupported, no storage request` et `file above the declared limit → unsupported before any request` (Task 10).
   - Assertion réelle : « GET anonyme de l'URL d'actif refusé » (Task 16).
5. **Commentaire de révision dupliqué après coupure.** Quand `marker.within` est non nul, `findByMarker` cherche dans les commentaires de cet item ; sinon, une reprise republierait la révision.
   - Tests : `findByMarker with within searches comments only` (Tasks 4, 6, 10) ; cas `resume-after-cut-comment` (Task 3).
