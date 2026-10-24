# L6 — Partie 3 : qualification (Tasks 14-19)

Index, Global Constraints et Review Focus : `2026-10-24-v1-L6-extension-delivery.md`.

### Task 14: Outillage partagé des contrôles navigateur de remise

**Files:**
- Create: `tools/browser-check/delivery-fixture.ts`, `tools/browser-check/delivery-receiver-max.browser-fixture.ts`
- Create: `tools/browser-check/rss-sampler.ts`, `tools/browser-check/delivery-receipt.ts`
- Modify: `tools/browser-check/evidence.ts:13-50` (`snapshotBuild` lève `Build variant must be release` si `variant !== "release"`)
- Test: `tools/browser-check/rss-sampler.test.ts`, `tools/browser-check/delivery-receipt.test.ts`, `tools/browser-check/evidence.test.ts`

**Interfaces:**
- Consumes: `startTestControlPlane` (registre §4.5) ; page L4 `apps/control-plane/web/receive.html` et `receive-host.ts` ; récepteur Task 13 ; `writeZip`.
- Produces:
  ```ts
  export const DELIVERY_REQUIRED_STEPS = [
    "release-build-installed-activeTab-scripting-only",
    "control-plane-origin-saved-validated-persisted",
    "observed-origin-captured-shown-withdrawable",
    "delivery-refused-without-gesture",
    "delivery-refused-on-other-origin",
    "delivery-refused-without-confirmation",
    "delivery-complete-verified-by-control-plane",
    "delivery-withdrawn-origin-transmitted-as-null",
    "delivery-memory-measured",
    "receiver-contract-max-memory-measured",
  ] as const;
  export function deliveryReceiptFailures(receipt: unknown): string[]; // receipt.shape|failed|blocked|steps|memory|variant
  export function parsePsRss(output: string): number;                  // somme en KiB ; lève sur sortie vide ou illisible
  export function sampleRss(rootPid: number, intervalMs?: number): { stop(): Promise<{ baselineKiB: number; peakKiB: number; samples: number }> };
  export function startDeliveryFixture(options: { root: string; output: string }): Promise<{ origin: string; otherOrigin: string;
    spkiSha256Base64: string; counters(): { deliveryMessagesSeen: number; uploads: { status: number; dossierId: string | null;
    created: boolean | null; observedOrigin: string | null; exportSha256: string; byteLength: number }[] }; stop(): Promise<void> }>;
  ```

Valeurs fixées :
- Certificat auto-signé P-256 d'un jour pour `DNS:localhost`, généré par
  `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 1 -subj /CN=localhost -addext subjectAltName=DNS:localhost`
  sous `mktemp -d`, retiré en `finally` ; empreinte SPKI SHA-256 en base64 par
  `node:crypto` `X509Certificate` (à vérifier sous Bun ; repli : chaîne `openssl x509
  -pubkey`, `openssl pkey -pubin -outform der`, `openssl dgst -sha256 -binary`, `base64`).
- Deux instances `Bun.serve` TLS `hostname: "localhost"`, ports libres : `origin` sert la
  vraie page de L4 (`receive.html` et le bundle de `receive-host.ts`, construit par
  `Bun.build`, cible `browser`) ; `otherOrigin` sert la fixture de capture et une page qui
  ouvre `/receive` par `window.open` et lui poste un `signalement.delivery.begin` valide sur
  ordre du harnais (aucun cadre : valable sous la CSP de L4).
- Un script de fixture placé avant le bundle réel compte tout événement `message` dont
  `data.type` commence par `signalement.delivery.` et le signale au serveur
  (`POST /fixture/count`).
- `POST /api/v1/deliveries/uploads` de `origin` est relayé tel quel (corps, en-tête
  `Signalement-Delivery-Envelope`) vers un `startTestControlPlane()` démarré par la
  fixture, avec l'en-tête `Authorization` de schéma `Bearer` portant
  `issueToken("reporter")` ajouté côté serveur de fixture (jamais exposé à la page) ; le
  verdict, `verifyExport` compris, est donc celui de L4. La session OIDC de la page n'est
  pas exercée ici : elle l'est par le contrôle navigateur de L4.
- RSS : `pgrep -P` récursif depuis le PID du navigateur lancé, `ps -o rss= -p <liste>`,
  toutes les 100 ms.
- Reçu refusé si une étape manque, est réordonnée ou en trop, si
  `receiverIgnoresForeignOrigin !== true`, si `build.variant !== "release"`, si
  `memory.peakDeltaKiB` ou `memory.exportByteLength` ne sont pas des entiers positifs, et
  toujours si `status === "blocked"`.

Fixture « contrat maximal » (`delivery-receiver-max.browser-fixture.ts`) : construit dans
la page par `writeZip` une archive de `README.md` (1 024 o), `manifest.json` (`{}` complété
à 1 024 o) et quatre `media/*.webm` totalisant 268 435 456 o (trois de 67 108 864 o, un de
67 108 864 − 2 048 o) remplis par tranches de 65 536 o de `crypto.getRandomValues`, et la
poste au vrai récepteur par le protocole, sans extension (mesure de la page, pas une
remise). Le serveur L4 la refuse (`upload.export_invalid`, manifeste synthétique) : l'étape
10 attend ce refus et consigne la mémoire, ce que le reçu dit.

- [ ] **Test rouge.** `delivery-receipt.test.ts` : reçu complet → `[]` ; étape manquante,
  réordonnée ou en trop → `["receipt.steps"]` ; `status: "blocked"` → `["receipt.blocked"]` ;
  `variant: "development"` → `["receipt.variant"]` ; mémoire absente → `["receipt.memory"]`.
  `rss-sampler.test.ts` : `parsePsRss(" 1024\n 2048\n")` → `3072` ; `"abc"` et `""` lèvent
  (aucun processus = échec, jamais 0). `evidence.test.ts` : `variant: "development"` fait
  lever `snapshotBuild`.
- [ ] **Exécution rouge.** `bun test tools/browser-check` → échecs.
- [ ] **Implémentation** selon les valeurs fixées.
- [ ] **Exécution verte.** `bun test tools/browser-check` → `0 fail`.
- [ ] **Neutralisation.** Refus `blocked` → `[]` : rouge ; `parsePsRss("")` → `return 0` : rouge.
- [ ] **Commit.**
  ```bash
  git add tools/browser-check/delivery-fixture.ts tools/browser-check/delivery-receiver-max.browser-fixture.ts tools/browser-check/rss-sampler.ts tools/browser-check/rss-sampler.test.ts tools/browser-check/delivery-receipt.ts tools/browser-check/delivery-receipt.test.ts tools/browser-check/evidence.ts tools/browser-check/evidence.test.ts
  git commit -s -m "test(browser-check): add HTTPS loopback delivery fixture relayed to the test control plane, RSS sampler and receipt verdict"
  ```

### Task 15: Contrôle réel Chrome (et CI)

**Files:**
- Create: `tools/browser-check/delivery-chrome.ts`
- Modify: `.github/workflows/ci.yml` après la ligne 72 (étape de remise Chrome sous `tools/ci/with-postgres.ts`, relecture du reçu publié, artefact `chrome-delivery-receipt`)

**Interfaces:**
- Consumes: Task 14 ; build `release` ; CDP comme `tools/browser-check/chrome.ts:51-160`.
- Produces: `test-results/browser-check/delivery-chrome/<uuid>/evidence.json` avec `deliveryReceiptFailures(...) === []`.

Recette, une étape du reçu par assertion indépendante :
1. lancement avec `--ignore-certificate-errors-spki-list=<empreinte>` (profil jetable
   seulement), `Extensions.loadUnpacked` du build copié par `snapshotBuild` ; manifest
   installé : `["activeTab","scripting"]` ;
2. éditeur : `http://localhost:<port>` refusé (« HTTPS requis. »), `origin` accepté,
   éditeur rechargé, valeur relue ;
3. capture sur la fixture de `otherOrigin` par `Extensions.triggerAction` + clic :
   `observed-origin` affiche `otherOrigin` ; enregistrement chiffré, verrouillage,
   reprise : origine restaurée ; « Retirer » → « Aucune origine observée. » ;
4. éditeur ouvert avec `#delivery=<identifiant aléatoire>` sans geste : section de remise
   masquée, compteur de messages = 0 ;
5. action de la popup sur l'onglet de `otherOrigin` : texte `origin-mismatch`, aucun
   éditeur ouvert, compteur = 0 et aucun contexte isolé de l'extension créé dans l'onglet
   de réception (second instrument : `Runtime.enable` sur la cible, comptage des
   `Runtime.executionContextCreated` avec `auxData.type === "isolated"` et `name` = nom de
   l'extension) ; la page de `otherOrigin` poste un `begin` à `/receive` ouvert par
   `window.open` : état `idle` (`receiverIgnoresForeignOrigin = true`) ;
6. action de la popup sur l'onglet de réception : éditeur avec ticket ; préparation ;
   « Confirmer et remettre » sans cocher : refus `not-confirmed`, compteur = 0, contextes
   isolés = 0 ;
7. cocher, remettre : page `accepted` ; l'envoi relayé rend `201`, `created: true`,
   `observedOrigin` = `otherOrigin`, `exportSha256` = empreinte affichée par l'éditeur ;
   contextes isolés = `chunkCount + 2` ;
8. nouveau geste après « Retirer l'origine observée » et modification d'un champ (nouvel
   export) : `observedOrigin` reçu `null` ;
9. RSS pendant l'étape 7 : `baselineKiB`, `peakKiB`, `peakDeltaKiB`, `exportByteLength`,
   `chunkCount`, durée ;
10. fixture « contrat maximal » : refus `upload.export_invalid` attendu, longueur relayée
    égale à l'archive construite, RSS pic et delta.

Le reçu porte versions, recette et empreintes (`recipeEvidence`), variante et relevés de
mémoire verbatim. Aucun seuil mémoire tant que la question 3 est ouverte : la mesure est
consignée, pas jugée.

- [ ] **Exécution rouge.** Avant la Task 12 dans l'arbre, la recette échoue à l'étape 2 ;
  sortie consignée (la recette lit la page réelle).
- [ ] **Exécution verte.** `bun run build:extensions && bun tools/ci/with-postgres.ts -- bun tools/browser-check/delivery-chrome.ts`,
  puis `bun tools/browser-check/delivery-receipt.ts test-results/browser-check/delivery-chrome`
  → sortie 0, résumé des dix étapes et des compteurs.
- [ ] **Neutralisation en navigateur réel.** Construire une fois, dans un répertoire
  temporaire jamais commité, l'extension avec la garde N2 de la Task 11 neutralisée et
  rejouer : l'étape 5 échoue ; sortie dans le message de commit ; reconstruire depuis
  l'arbre propre.
- [ ] **CI.** Étapes sur le modèle des étapes Chrome existantes (`CHROME_BINARY`,
  `test -x`, relecture du reçu publié, `if-no-files-found: error`).
- [ ] **Commit.**
  ```bash
  git add tools/browser-check/delivery-chrome.ts .github/workflows/ci.yml
  git commit -s -m "test(browser-check): qualify observed origin and gesture-bound delivery on installed Chrome"
  ```

### Task 16: Contrôle réel Firefox

**Files:**
- Create: `tools/browser-check/delivery-firefox.ts`
- Modify: `tools/browser-check/popup-rdp.ts:1-34` (exporter `popupClickScript(buttonId: "capture" | "deliver")` ; `popupRdpScript` = `popupClickScript("capture")`, `firefox.ts` inchangé)
- Test: `tools/browser-check/popup-rdp.test.ts`

**Interfaces:**
- Consumes: Task 14 ; recette `tools/browser-check/firefox.ts:13-240` (geckodriver,
  Marionette contexte `chrome`, action native, clic par RDP) ; capacité geckodriver
  `acceptInsecureCerts: true` limitée à la session jetable.
- Produces: `test-results/browser-check/delivery-firefox/<uuid>/evidence.json`, mêmes dix
  étapes ; instrument d'injection : compteur de messages de la page
  (`injectionInstrument: "page-message-counter"`), Firefox n'exposant pas ici l'équivalent
  CDP des contextes isolés.

- [ ] **Test rouge.** `popupClickScript("capture") === popupRdpScript` ; le script `deliver`
  vise `getElementById('deliver')` → module sans export, rouge.
- [ ] **Implémentation** de `popupClickScript`, puis de la recette (étapes et textes de la Task 15).
- [ ] **Exécution verte.** `bun test tools/browser-check/popup-rdp.test.ts` → `0 fail` ;
  `GECKODRIVER_BINARY=<binaire vérifié par son digest> bun tools/ci/with-postgres.ts -- bun tools/browser-check/delivery-firefox.ts`,
  puis `bun tools/browser-check/delivery-receipt.ts test-results/browser-check/delivery-firefox` → sortie 0.
- [ ] **Neutralisation en navigateur réel.** Procédure de la Task 15 (N2 neutralisée) : l'étape 5 échoue.
- [ ] **Commit.**
  ```bash
  git add tools/browser-check/delivery-firefox.ts tools/browser-check/popup-rdp.ts tools/browser-check/popup-rdp.test.ts
  git commit -s -m "test(browser-check): qualify observed origin and gesture-bound delivery on installed Firefox"
  ```

### Task 17: Empaquetage et contrôle réel Safari (bloqué tant que les prérequis du propriétaire manquent)

**Files:**
- Create: `tools/build/safari-package.ts`, `tools/browser-check/delivery-safari.ts`
- Test: `tools/browser-check/delivery-safari.test.ts`

**Interfaces:**
- Consumes: `dist/extensions/safari` ; Task 14 ; `xcrun safari-web-extension-converter`, `xcodebuild`, `safaridriver`.
- Produces:
  ```ts
  export type SafariPrerequisite = "signing-identity" | "safaridriver-enabled" | "toolbar-action-trigger";
  export function safariPrerequisiteFailures(env: { signingIdentity: string | null; safaridriverEnabled: boolean;
    toolbarTrigger: "owner-approved" | null }): SafariPrerequisite[];
  ```
  et `test-results/browser-check/delivery-safari/<uuid>/evidence.json` : `status: "blocked"`
  avec `prerequisites` tant qu'il en manque un (sortie 1), sinon les dix étapes.

Constat : aucun contrôle Safari n'a jamais été exécuté
(`docs/qualification/2026-10-06-browser-probes.md`, « Safari | Not attempted ») et le
harnais s'interdit tout changement de réglage hôte ou assouplissement de signature
(`tools/browser-check/README.md:3-6`, ADR-0005). Safari exige pourtant une identité de
signature Apple ou « Allow Unsigned Extensions », l'autorisation `safaridriver --enable`,
et un déclenchement de l'action de barre d'outils que WebDriver n'offre pas (Accessibilité
macOS). Ce sont des décisions du propriétaire (question 2) : la tâche livre l'outillage et
un reçu `blocked` explicite, jamais un vert simulé.

- [ ] **Test rouge.** Tous absents → les trois codes dans cet ordre ; tous fournis → `[]`.
- [ ] **Implémentation.** `safari-package.ts` : options relevées à l'exécution par
  `xcrun safari-web-extension-converter --help` (à vérifier : `--project-location`,
  `--macos-only`, `--no-open`, `--no-prompt`, `--force`, `--copy-resources`), projet sous
  `mktemp -d` retiré en `finally`. `delivery-safari.ts` : prérequis lus dans
  `SAFARI_SIGNING_IDENTITY`, `safaridriver --version` plus une session d'essai,
  `SAFARI_TOOLBAR_TRIGGER=owner-approved` ; reçu `blocked` et sortie 1 s'il en manque ;
  sinon sonde de la Task 8 puis dix étapes.
- [ ] **Exécution.** `bun test tools/browser-check/delivery-safari.test.ts` → `0 fail` ;
  `bun tools/browser-check/delivery-safari.ts` → `blocked` (sortie 1) tant que la question
  2 est ouverte ; `bun tools/browser-check/delivery-receipt.ts test-results/browser-check/delivery-safari` → `receipt.blocked`.
- [ ] **Neutralisation.** Retour de `safariPrerequisiteFailures` → `[]` : test rouge.
- [ ] **Commit.**
  ```bash
  git add tools/build/safari-package.ts tools/browser-check/delivery-safari.ts tools/browser-check/delivery-safari.test.ts
  git commit -s -m "test(browser-check): add Safari packaging and an explicit blocked delivery receipt pending owner prerequisites"
  ```

### Task 18: Documentation, couverture et preuves de qualification

**Files:**
- Create: `packages/delivery-protocol/README.md` (API, constantes, codes d'acquittement, modèle de menace : messages forgés par la page, borne mémoire, base64)
- Create: `apps/extension-shared/delivery.README.md` (séquence geste → ticket → préparation → confirmation → injection ; chaque propriété du design §5.2 rattachée à son test)
- Create: `docs/qualification/<date -u +%F>-delivery-browser-matrix.md` (sorties verbatim des Tasks 15-17, versions, mémoire, réponse à l'hypothèse « arguments en JSON »)
- Modify: `tools/browser-check/README.md` (section « Delivery qualification » : recettes, drapeaux limités aux profils jetables, certificat éphémère, relais vers le banc L4, Safari bloqué et pourquoi)
- Modify: `package.json:48` (`check:core` : `packages/delivery-protocol`, `apps/extension-shared/{origin,settings,draft-content,delivery-injected,delivery,editor-hash,popup-messages}.test.ts`, `apps/control-plane/web/receive/receiver.test.ts`)
- Modify (chemins de doctrine, artefact de revue) : `qualification/browser-matrix.yaml` (énoncés étendus à « origine observée et remise », statuts inchangés sauf preuve), `project.v1.yaml` (preuve proposée pour `gesture-bound-delivery`)

**Interfaces:** Consumes : sorties des Tasks 8, 15, 16, 17. Produces : documentation d'API, preuves datées.

- [ ] **Couverture.** `bun run check:core` → seuil 0.9 (`tools/ci/core-coverage.toml:5`), sortie relayée verbatim.
- [ ] **Docs.** Deux README et la section de contrôle ; chaque chiffre suivi de sa commande.
- [ ] **Qualification.** Reçus Chrome et Firefox (`jq . evidence.json`), reçu Safari `blocked` et ses prérequis, mémoire verbatim.
- [ ] **Chemins de doctrine.** Modifications proposées avec l'artefact de revue ; aucune
  ligne `Owner-arbitration:` écrite par l'agent ; `gesture-bound-delivery` reste `pending`
  avant la revue ; `browser-matrix-real` reste `pending` tant que Safari est `blocked`.
- [ ] **Exécution.** `bun run check` → vert.
- [ ] **Commit.**
  ```bash
  git add packages/delivery-protocol/README.md apps/extension-shared/delivery.README.md docs/qualification/*-delivery-browser-matrix.md tools/browser-check/README.md package.json qualification/browser-matrix.yaml project.v1.yaml
  git commit -s -m "docs(delivery): document the delivery protocol and record per-browser delivery qualification"
  ```

### Task 19: Critère de sortie du lot L6

**Files:** aucun ; vérification. **Interfaces:** —

Critère (feuille de route §2) : « origine observée, remise par morceaux, `scripting`
borné ; `gesture-bound-delivery` prouvé par neutralisation ; contrôle navigateur réel sur
Chrome, Firefox, Safari ».

- [ ] **Gate complet.** `bun run check` → sortie 0, avant et après le dernier commit.
- [ ] **Commandes du lot.**
  ```bash
  bun test tools/build packages/delivery-protocol apps/extension-shared apps/control-plane/web/receive tools/browser-check
  bun tools/ci/with-postgres.ts -- bun test apps/control-plane/web/receive/receive.e2e.test.ts
  bun run build:extensions && jq -c '.permissions' dist/extensions/{chrome,firefox,safari}/manifest.json
  jq -c '{host: has("host_permissions"), cs: has("content_scripts"), ec: has("externally_connectable")}' dist/extensions/{chrome,firefox,safari}/manifest.json
  grep -c "connect-src 'none'" dist/extensions/{chrome,firefox,safari}/manifest.json
  for b in chrome firefox safari; do bun tools/browser-check/delivery-receipt.ts test-results/browser-check/delivery-$b; done
  ```
  Attendu : `0 fail` (deux fois) ; trois fois `["activeTab","scripting"]` ; trois fois
  `{"host":false,"cs":false,"ec":false}` ; trois fois `1` ; Chrome et Firefox `[]`.
- [ ] **Neutralisations.** Rejouer N1-N7 (Task 11) et a-c (Task 10) une à une ; table
  jointe à la PR : substitution, test rouge, état (pass/fail/unavailable/blocked).
- [ ] **Verdict en quatre états, rapportés séparément.** `gesture-bound-delivery` (pass si
  toutes les neutralisations rougissent), Chrome, Firefox, Safari (`blocked` tant que la
  question 2 est ouverte), Task 13 (dépendante de la question 1). Le lot ne se déclare
  **pas** sorti tant que Safari est `blocked` : la PR peut fusionner son code (revue
  passée, `bun run check` vert), le critère L6 et `browser-matrix-real` restent ouverts et
  la PR le dit.
- [ ] **Revue.** Proposer `/code-review:code-review` avant fusion ; retirer le worktree (`git worktree remove <chemin>`).
