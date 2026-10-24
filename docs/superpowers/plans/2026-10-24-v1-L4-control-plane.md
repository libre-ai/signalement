# Signalement v1.0 — L4 control plane auto-hébergé Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** livrer `apps/control-plane/`, le control plane mono-organisation auto-hébergé de
la v1.0 : réception et revérification des exports, Dossiers et révisions, politique de
routage versionnée, plan par destination, approbation liée au plan exact, outbox et
dispatcher en processus, reçus signés Ed25519, identité OIDC + Biscuit, interface web
d'envoi, d'administration et d'audit, banc de test pour L6 et L7 ; avec les critères
`cross-organization-disclosure` et `stale-plan-refused` verts (feuille de route §2,
ligne L4) et l'API exacte du registre §4.5.

**Architecture:** un seul processus Bun (`Bun.serve`) adossé à PostgreSQL par `Bun.SQL`
(ADR-0004 : modules en processus tant qu'aucune preuve n'exige une séparation). L'état
canonique et les intentions sortantes sont écrits dans la même transaction (outbox) ;
un dispatcher en processus les consomme par `FOR UPDATE SKIP LOCKED`, appelle
`executeDelivery` (registre §4.4) et signe le reçu par `PolicyReceiptApi.signReceipt`
(registre §4.2). Les connecteurs viennent de `connectors/index.ts` (L5, registre §4.4
bis), filtrés par la matrice de qualification. Chaque table d'organisation porte
`organization` et une politique RLS forcée ; le rôle applicatif n'a ni `BYPASSRLS` ni
`SUPERUSER`. Secrets (jetons fournisseurs, clés de signature, clé racine Biscuit) et
artefacts sont chiffrés au repos par enveloppe applicative (AES-256-GCM, clé de données
enveloppée par AES-KW sous une clé maîtresse injectée). Le web est servi par les imports
HTML natifs de `Bun.serve`, sans framework. Quatre phases, chacune verte et testable
seule : **A** données et isolation, **B** API et dispatcher, **C** identité (et banc de
test), **D** web.

**Tech Stack:** Bun (version épinglée par `packageManager` de `package.json`, vérifiée par
`bun run check:toolchain`), TypeScript strict, `Bun.serve` (routes + imports HTML),
`Bun.SQL` (PostgreSQL), `Bun.S3Client`, `Bun.YAML`, WebCrypto (Ed25519, AES-GCM, AES-KW,
SHA-256). Deux dépendances nouvelles, « à vérifier à l'exécution » : `oauth4webapi`
(Task 21) et `@biscuit-auth/biscuit-wasm` (Task 22). PostgreSQL en conteneur pour les
tests (Docker en local, service conteneur en CI).

**Spec:** docs/superpowers/specs/2026-10-22-v1-policy-routed-ticket-projection-design.md ; feuille de route docs/superpowers/plans/2026-10-24-v1-roadmap.md

## Parties

Le plan est découpé pour rester sous le plafond de taille du gate de frontière publique.
Numérotation continue ; une tâche n'est jamais coupée entre deux fichiers.

| Partie | Fichier | Phase | Tâches |
| --- | --- | --- | --- |
| 1 | `2026-10-24-v1-L4-control-plane-part-1.md` | A — données et isolation | 1 PostgreSQL de test · 2 configuration · 3 migrations · 4 schéma et RLS · 5 accès scopé et `cross-organization-disclosure` · 6 enveloppe · 7 clés Ed25519 · 8 artefacts · 9 audit et journal |
| 2 | `2026-10-24-v1-L4-control-plane-part-2.md` | B — API (1/2) | 10 noyau HTTP · 11 profils qualifiés et connecteurs · 12 destinations · 13 politiques · 14 téléversement · 15 lecture des Dossiers · 16 plan |
| 3 | `2026-10-24-v1-L4-control-plane-part-3.md` | B — dispatcher (2/2) | 17 approbations et outbox · 18 dispatcher, reçus, `stale-plan-refused` · 19 reçus, clés, artefacts · 20 état distant |
| 4 | `2026-10-24-v1-L4-control-plane-part-4.md` | C — identité | 21 OIDC et sessions · 22 Biscuit · 23 matrice d'autorisation · 24 banc de test `startTestControlPlane` |
| 5 | `2026-10-24-v1-L4-control-plane-part-5.md` | D — web | 25 coquille et hôte de réception · 26 écran d'envoi · 27 administration et audit · 28 contrôle navigateur · 29 déploiement de référence · 30 critère de sortie |

Sortie de phase : A = schéma, RLS prouvée, crypto, stockage, audit (aucune route) ;
B = API §4.5 avec un principal de test, dispatcher contre le faux fournisseur ;
C = sessions OIDC, Biscuit, matrice d'autorisation, banc de test publié ; D = écrans,
contrôle navigateur, déploiement documenté, critère L4 vérifié. Chaque dernière tâche
de phase lance `bun run check`.

## Global Constraints

- **Préalables bloquants.** Aucun commit ne fusionne avant : L3 fusionné
  (`packages/connector-sdk`, `packages/projection-core`, `packages/fake-provider`), L2
  fusionné (`packages/policy-receipt-wasm`), contrats du registre §4.1 en `locked`
  (`jq -r '.contracts[] | "\(.contract) \(.status)"' vendor/contracts/pin.json`, format
  `signalement.contract-pin.v2`), gel ADR-0042 §1 levé (design §8.1). La Task 11 exige
  en plus `connectors/index.ts` (L5) ; tant qu'il manque, elle s'arrête après ses tests
  sur connecteurs injectés et le dit. Vérifier : `git ls-remote --symref origin HEAD`,
  puis `git log --oneline origin/main -30`.
- **Noms du registre, importés tels quels, jamais redéfinis.**
  - L2 (§4.2) : `PolicyReceiptApi`, `loadPolicyReceipt`, `RoutingPolicy`,
    `EvaluationInput`, `PolicyVerdict`, `VerdictDestination`, `WithholdReason`,
    `DiscoveredAttributes`, `UnsignedReceipt`, `SignedReceipt`, `ProjectionReceipt`,
    `ReceiptVerification`, `PublicKeySet`. `signReceipt(unsigned, secretKey)` lit le
    `keyId` dans `unsigned.keyId` ; `secretKey` = graine Ed25519 de 32 octets.
  - L3 SDK (§4.3) : `Result`, `ConnectorFailure`, `HttpPort`, `Connector`,
    `ConnectorProfile`, `ConnectorContext`, `SecretHandle` (`SecretHandle.fromString`,
    `revealSecret`), `Discovery`, `DestinationTarget`, `FindOutcome`,
    `RemoteItemReceipt`, `ProjectionMarker`, `profileIdOf`, `attachmentModeOf`,
    `lookupOf`, `createFetchHttpPort`, `instrumentHttpPort`.
  - L3 projection-core (§4.4) : `ProjectionState`, `projectionId`, `idempotencyKey`,
    `buildDeliveryPlan(verdict, selection, profileFor)` (`profileFor` dérivé de
    `connectorFor` et de la matrice qualifiée, Task 11), `revalidatePlan`, `transition`,
    `renderBody`,
    `executeDelivery`, `buildUnsignedReceipt`, `DeliveryJob`, `DeliveryDeps`,
    `DeliveryOutcome`, `DeliverySuccess`, `DeliveryPlan`, `UserSelection`, et, d'après
    le plan L3, `RENDERER_VERSIONS`, `RemoteAttributes` et les champs de `DeliveryJob`
    (`previousAttemptAmbiguous`, `priorSentBodyDigests`, `plannedAttributes`,
    `currentPolicy`, `mediaLinks`, `approvalRef`, `firstAttemptAt`).
  - L3 faux fournisseur : `createFakeProvider(options: { dialect, search, baseUrl })`,
    `FakeProvider`, `FakeDialect`, `findLeaks`, et, d'après le plan L3, `referenceDialect`, `FAKE_BASE_URL`, pannes `drop-after-send` et
    `visibility-read-failure`, `createReferenceConnector`, `referenceProfile`,
    `fileNeedles`, `buildExportFixture`. `referenceProfile` est non qualifié par
    construction : les tests L4 le qualifient par une matrice de test
    (`TEST_PROFILE = "fake-reference/test/v1"`), jamais par la matrice du dépôt.
  - L5 (§4.4 bis) : `connectorFor(profileId): Connector | null`, `CONNECTORS`, depuis
    `connectors/index.ts` ; `fakeDialectFor(profileId): FakeDialect | null`, depuis
    `connectors/conformance/dialects/index.ts` (banc de test, Task 24). Aucun registre
    concurrent côté L4.
  - L1 : `DeliveryEnvelope` et `buildDeliveryEnvelope` de
    `packages/domain/delivery-envelope.ts` ; vérificateurs `rawRoutingPolicyFailures`,
    `rawDeliveryEnvelopeFailures`, `rawSigningKeySetFailures`, chemins résolus par
    `jq -r '.files | keys[]' vendor/contracts/pin.json | grep quality/`.
  - Chemins d'import supposés `packages/<nom>/index.ts` : ajuster au point d'entrée
    livré, sans renommer un symbole.
- **Export.** Revérifié par `verifyExport` importé de `tools/contracts/verify-export.ts`,
  sans copie ; le verdict est rendu par le serveur (code `upload.export_invalid`) et
  affiché par la page (registre §4.5).
- **API.** Enveloppe `{ data, meta }`, pagination par curseur (`meta.nextCursor`, `null`
  en fin), erreurs `{ error: { code, message } }` ; `message` est un texte fixe par code,
  jamais une donnée fournisseur, un chemin de fichier ou un nom de destination refusée.
  Exception imposée par le registre : `GET /api/v1/receipts/{id}` renvoie les octets JCS.
- **Aucune donnée personnelle en journal applicatif.** `src/log.ts` n'accepte qu'une
  liste fermée de champs (Task 9) : jamais de jeton, de cookie, de `sub`, de corps, de
  réponse fournisseur.
- **Gate de frontière publique, sur le plan comme sur le code.** Refusés : tout `.sql`
  hors d'un répertoire `migrations/` (le SQL d'amorçage des rôles de test vit en
  TypeScript) ; une ligne d'en-tête d'autorisation avec schéma et valeur ; une ligne
  commençant par un en-tête de cookie ; une URL portant un mot de passe (y compris une URI
  PostgreSQL). Un test qui en a besoin construit la valeur par concaténation, avec un
  commentaire d'une ligne ; les URL de connexion se construisent par `new URL()` ; les
  fixtures n'utilisent que des domaines RFC 2606 et aucune adresse électronique.
- **Tests PostgreSQL sans saut silencieux.** Base par `createTestDatabase()` (Task 1) ;
  indisponible = échec `postgres.unavailable`, jamais un saut (gate-integrity §6).
- **Effets externes désactivés par défaut.** Dispatcher et scrutateur d'état distant ne
  démarrent que si `SIGNALEMENT_EXTERNAL_EFFECTS=enabled`.
- **Faits volatils** (image PostgreSQL, versions, SHA) : résolus par commande à
  l'exécution, jamais recopiés de ce plan.
- **Commits.** `git commit -s` (sign-off en dernière ligne, identité de la config git),
  message anglais, aucun trailer `Co-Authored-By`, `bun run check` vert avant et après ;
  le corps de chaque commit qui ajoute un test cite la neutralisation qui le fait rougir.

## Review Focus

Cinq modes d'échec impliqués par le design qu'aucun test des lots L1-L3 ne couvre ;
chacun a son test dans la tâche propriétaire.

1. **Politique retirée pendant une livraison déjà réclamée.** La fenêtre entre la
   réclamation et l'envoi ne se ferme pas sans transaction ouverte pendant l'I/O.
   Décision : la réclamation verrouille la version en `FOR SHARE` et refuse une version
   non `approved` ; la livraison en vol s'achève sous la version approuvée à la
   réclamation ; les livraisons non réclamées passent en `to-resolve` dans la
   transaction de retrait. Test `retirement during an in-flight delivery never sends a
   later claim` (Task 18).
2. **Signature du reçu en échec après une création distante réussie.** Test `a signing
   failure keeps the remote id and retries signing without a second create` (Task 18).
3. **Échange de chiffrés entre lignes.** Les données authentifiées lient chaque chiffré
   à (`organization`, table, ligne, usage). Test `a ciphertext moved to another row
   fails to decrypt` (Task 6).
4. **Oracle de nom de destination refusée.** Même erreur pour un identifiant refusé et
   un identifiant inconnu (anti-but du design §2). Test `a denied destination id in a
   selection is indistinguishable from an unknown id` (Task 17).
5. **Corps de remise plus long que déclaré.** Test `an upload larger than the bound is
   refused at the bound without buffering the rest` (Task 14).
