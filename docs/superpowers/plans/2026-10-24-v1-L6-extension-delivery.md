# L6 — Origine observée et remise de l'extension au control plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** l'extension conserve l'origine observée à la capture (relue, retirable, chiffrée
dans le brouillon) et, sur un geste explicite dans l'onglet du control plane configuré,
remet l'export ZIP `signalement-local-export-v1` relu et l'origine observée à la page
« Recevoir un signalement » par un protocole par morceaux acquittés, avec la seule
permission supplémentaire `scripting` ; `gesture-bound-delivery` est prouvé par
neutralisation et `browser-matrix-real` est étendu à l'origine et à la remise, par navigateur.

**Architecture:** trois couches. (1) `packages/delivery-protocol` (pur, partagé par
l'extension et la page) : constantes, `DeliveryMessage`, `DeliveryAck`, `DeliveryAckCode`,
base64 strict, découpage `deliveryMessages`, réassemblage borné `createReassembler` ; il
ne construit pas l'enveloppe, qui vient de `packages/domain/delivery-envelope.ts` (L1).
(2) `apps/extension-shared` : règles d'origine pures, réglage stocké en IndexedDB de
l'origine de l'extension (sans `storage`), ticket de remise à usage unique émis par le
service worker sur un geste dans la popup, garde `authorizeInjection` et émetteur
`sendDelivery` exécutés par l'éditeur (seul détenteur de la clé et des octets), fonction
injectée fixe et autonome `deliverOne`. (3) `apps/control-plane/web/receive/` : récepteur
monté dans la page `/receive` de L4 par son point d'accroche `mountReceiver`, qui vérifie
le transport puis téléverse par `ReceiverHost.upload` (L4). Le service worker ne détient
ni clé ni octet ; aucune I/O hors des ports injectés dans les modules testés.

**Tech Stack:** TypeScript strict, Bun (`bun test`, `Bun.build`), WebExtension MV3
(`activeTab`, `scripting.executeScript` avec `func`), WebCrypto, IndexedDB, `node:vm`
(tests de la fonction injectée), CDP (Chrome), geckodriver + Marionette/RDP (Firefox),
Xcode `safari-web-extension-converter` + `safaridriver` (Safari), banc L4
`startTestControlPlane` sous `tools/ci/with-postgres.ts`. Aucune dépendance npm nouvelle.
Outil hôte pour les contrôles navigateur seulement : `openssl` (certificat de bouclage
éphémère), à vérifier à l'exécution par `command -v openssl`.

**Spec:** docs/superpowers/specs/2026-10-22-v1-policy-routed-ticket-projection-design.md ; feuille de route docs/superpowers/plans/2026-10-24-v1-roadmap.md

## Global Constraints

- **Dépendances de lot (feuille de route §2).** L6 démarre quand L1 (contrat
  `signalement-delivery-envelope-v1` `locked`, module `packages/domain/delivery-envelope.ts`)
  et L4 (route `POST /api/v1/deliveries/uploads`, `ReceiverHost`/`MountReceiver`, banc
  `startTestControlPlane`) sont fusionnés, ainsi que l'amendement d'ADR-0005 de L0. La
  Task 1 le vérifie et s'arrête sinon. L'amendement est **cité, jamais réécrit** (plan L0,
  Task 2) : « Permission surface is voluntary active-tab capture, observed origin
  retention, and gesture-bound delivery to one configured origin, with no host
  permissions or content-script collection. »
- **Worktree.** L6 ∥ L7 : worktree créé sous un chemin temporaire et retiré dans le même
  flux (`git worktree add "$(mktemp -d)/l6" -b <branche>`, puis `git worktree remove
  <chemin>`, y compris en cas d'échec).
- **Manifest.** `permissions` = `["activeTab", "scripting"]` exactement ; jamais
  `host_permissions`, `content_scripts`, `externally_connectable`, `storage` ;
  `connect-src 'none'` reste dans `content_security_policy.extension_pages`.
- **Injection.** Uniquement `scripting.executeScript({ target: { tabId }, world:
  "ISOLATED", func: deliverOne, args: [message, targetOrigin, ACK_TIMEOUT_MS] })`. Jamais
  `files`, `allFrames`, `world: "MAIN"` ni chaîne de code. `deliverOne` ne lit ni DOM, ni
  stockage, ni cookie, ni `location`, et poste avec l'origine cible explicite, jamais `"*"`.
  Compatibilité relevée le 2026-10-24 dans `mdn/browser-compat-data` : `executeScript` et
  `world` listés Chrome 88/95, Firefox 102, Safari 15.4 ; à rejouer :
  `curl -sL https://raw.githubusercontent.com/mdn/browser-compat-data/main/webextensions/api/scripting.json | jq '.webextensions.api.scripting.executeScript | {base: .__compat.support, world: .world.__compat.support}'`.
- **Enveloppe (registre §4.1, §4.6).** `DeliveryEnvelope` et `buildDeliveryEnvelope(exportBytes,
  observedOrigin): Promise<DeliveryEnvelope>` viennent de `packages/domain/delivery-envelope.ts`
  (L1), seul constructeur, partagé avec L7. Champs : `deliveryId`, `exportSha256`,
  `exportByteLength`, `observedOrigin`. L6 ne construit ni ne redéfinit l'enveloppe.
- **Contrat d'export inchangé.** La remise transporte les octets exacts de
  `ExportReview.toZip()` (`packages/domain/export.ts:222-224`). L'origine observée n'entre
  jamais dans l'export, ni dans l'export local téléchargé ; elle ne voyage que dans
  l'enveloppe.
- **Vérification côté page — écart au design §5.2 point 5, soumis au propriétaire
  (registre §4.5).** Le vérificateur vendorisé appelé par `verifyExport`
  (`vendor/contracts/tools/quality/signalement-local-export-v1.ts`) ne tourne pas en
  page : `node:crypto` (l.2), `await Bun.file(...)` au chargement (l.43-49), Ajv compilé à
  l'exécution qui exigerait `'unsafe-eval'` ; son en-tête dit « Authority-fixture verifier
  only; no browser ». Option A appliquée : la page vérifie le transport (bornes, longueur,
  SHA-256, archive lisible par `readZip`, présence de `manifest.json`) ; le verdict
  `verifyExport` est rendu par le serveur (L4 Task 14, `upload.export_invalid`) et affiché.
  La Task 13 **dépend de cette décision** (question 1).
- **Frontière avec L4.** Page `/receive`, CSP, authentification, `ReceiverHost`,
  `MountReceiver` et format HTTP du téléversement appartiennent à L4 (Tasks 14 et 25 de
  son plan). Registre §4.5 : corps `application/zip`, en-tête
  `Signalement-Delivery-Envelope` (JCS en base64url, ≤ 4096 octets), réponse
  `{ dossierId, revisionId, exportSha256, created }`. L6 remplit `mountReceiver` et ne
  redéfinit aucun de ces éléments.
- **Contenu non fiable.** Texte venu d'une page, d'un acquittement ou d'une réponse
  serveur : `textContent` seulement, codes d'erreur fermés seulement.
- **Gate de frontière publique.** Une URL à identifiants ou un en-tête d'authentification
  dont un test a besoin se construit par concaténation, avec un commentaire d'une ligne ;
  la prose décrit l'en-tête sans le citer.
- **Interface.** Couleurs par les variables de `apps/extension-shared/styles.css` ;
  clavier, noms accessibles, erreurs annoncées (`role="status"`, `aria-live="polite"`).
- **TDD et preuve.** Chaque test : rouge, vert, puis neutralisation par substitution no-op
  de la garde vérifiée (jamais une suppression de ligne). Le commit répond aux deux
  questions de `gate-integrity` §5 (erreur qui fait rougir ; un refactor équivalent
  ferait-il rougir).
- **Commits.** Anglais, `git commit -s` (sign-off en dernière ligne), aucun
  `Co-Authored-By`. `bun run check` vert avant et après chaque commit ; stager les
  fichiers neufs avant les gates.
- **Faits volatils.** Base : `git ls-remote --symref origin HEAD`. Dernier ADR :
  `ls docs/adr | tail -1`. Vendorisation : `jq -r '.contracts[].id' vendor/contracts/pin.json`.
  Date d'un relevé : `date -u +%FT%TZ`.
- **Chemins de doctrine** (`qualification/**`, `project.v1.yaml`, `docs/adr/**`) :
  artefact de revue ; la ligne `Owner-arbitration:` est écrite par le propriétaire, jamais
  par l'agent.

## Review Focus

1. **Message de remise forgé par un autre script de la page** (autre extension, script
   injecté ; même `event.origin`, même `event.source`) : Task 7 (`a second begin during an
   active delivery is refused busy and never replaces it`), Task 13 (`the page uploads
   only after end with matching length and digest`) ; la page affiche les 12 premiers
   caractères du digest, que la confirmation de l'éditeur affiche aussi (Task 12).
2. **Onglet naviguant entre le geste et l'injection** : Task 11 (`tab now on another
   origin: zero executeScript calls`, `executeScript rejecting mid-stream stops every
   later call`).
3. **Réglage altéré dans IndexedDB** : Task 3 (`a tampered or non-canonical stored value
   reads as unset`).
4. **Préparation périmée** (brouillon modifié, verrouillé, repris après confirmation) :
   Task 11 (`a generation change after confirmation refuses stale-preparation`).
5. **Annonce surdimensionnée ou incohérente avant allocation** : Task 7
   (`out-of-bounds announcements are refused before any allocation`).

## Parties

Découpage imposé par le plafond de taille du gate de frontière publique. Numérotation
continue ; aucune tâche n'est coupée entre deux fichiers.

| Partie | Fichier | Phase | Tâches |
| --- | --- | --- | --- |
| 1 | `2026-10-24-v1-L6-extension-delivery-part-1.md` | A — fondations extension et protocole | 1 préconditions, `scripting`, variante · 2 règles d'origine · 3 réglage · 4 capture et origine · 5 brouillon v2 · 6 protocole : constantes, messages, découpage · 7 réassemblage |
| 2 | `2026-10-24-v1-L6-extension-delivery-part-2.md` | B — remise | 8 sonde `executeScript` et taille de morceau · 9 `deliverOne` · 10 ticket sur geste · 11 garde et émetteur (`gesture-bound-delivery`) · 12 popup et éditeur · 13 récepteur de page et bout en bout |
| 3 | `2026-10-24-v1-L6-extension-delivery-part-3.md` | C — qualification | 14 outillage partagé · 15 Chrome · 16 Firefox · 17 Safari · 18 documentation et preuves · 19 critère de sortie |

Sortie de phase : A = fondations testées sous Bun, `bun run check` vert ; B =
`gesture-bound-delivery` prouvé par neutralisation et bout en bout contre
`startTestControlPlane` ; C = reçus navigateur Chrome et Firefox verts, Safari `blocked`
explicite tant que la question 2 est ouverte, critère L6 vérifié.
