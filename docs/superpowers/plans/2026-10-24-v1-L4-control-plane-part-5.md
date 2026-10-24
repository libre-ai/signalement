# L4 control plane — partie 5 : phase D, web, déploiement, sortie

Index, Global Constraints et Review Focus : `2026-10-24-v1-L4-control-plane.md`.

Sortie de phase : écrans servis par les imports HTML de `Bun.serve`, sans framework,
couleurs par variables CSS, accessibles au clavier, erreurs annoncées ; hôte de la page
« Recevoir un signalement » prêt pour L6 ; contrôle navigateur réel en CI ; déploiement de
référence documenté ; critère de sortie L4 vérifié.

### Task 25: Coquille web, connexion, liste des Dossiers, hôte de réception pour L6

**Files:**
- Create (sous `apps/control-plane/web/`) : `index.html`, `app.ts`, `styles.css`,
  `api-client.ts`, `announce.ts`, `receive.html`, `receive-host.ts`,
  `receive-contract.ts`, `receive/index.ts`, `web.test.ts`
- Modify: `apps/control-plane/src/http/server.ts` (routes HTML)
- Test: `apps/control-plane/web/web.test.ts`

**Interfaces:**
- Consumes: Tasks 14, 15 ; `DeliveryEnvelope` (L1).
- Produces (registre §4.5 : `ReceiverHost` et `MountReceiver` définis ici, `mountReceiver`
  et le récepteur fournis par L6) :
  ```ts
  // web/receive-contract.ts — owned by L4, consumed by L6
  export interface ReceiverHost {
    readonly uploadEndpoint: "/api/v1/deliveries/uploads";
    readonly controlPlaneOrigin: string;   // location.origin, the exact origin the extension compares against
    upload(exportBytes: Uint8Array, envelope: DeliveryEnvelope): Promise<{ ok: true; dossierId: string; revisionId: string; exportSha256: string; created: boolean } | { ok: false; code: string }>;
    announce(message: string): void;       // aria-live polite region
    goToSend(dossierId: string): void;     // navigates to /dossiers/<id>/send
  }
  export type MountReceiver = (root: HTMLElement, host: ReceiverHost) => void;
  // web/receive/index.ts — placeholder replaced wholesale by L6, which keeps the mountReceiver export
  export const RECEIVER_UNAVAILABLE_TEXT = "La réception depuis l'extension n'est pas disponible dans cette version.";
  export const mountReceiver: MountReceiver;
  ```
  `upload` envoie les octets en corps `application/zip` et l'enveloppe JCS en base64url
  dans l'en-tête `Signalement-Delivery-Envelope` (Task 14). Un refus serveur rend `{ ok:
  false, code }` avec le code tel quel (par exemple `upload.export_invalid`, verdict
  `verifyExport` affiché par la page, registre §4.5).
  `web/styles.css` commence par `@import "../../extension-shared/styles.css";`.
  Il n'ajoute que des règles fondées sur ces variables (`--background`, `--surface`,
  `--text`, `--border`, `--accent`, `--focus`) ou sur des variables déclarées dans
  `:root`.

- [ ] **Test qui échoue :**
  ```ts
  test("pages are served with the strict CSP and no inline script", async () => {
    for (const path of ["/", "/receive"]) {
      const res = await fetchAs(path, reporterSession);
      expect(res.headers.get("content-security-policy")).toContain("script-src 'self'");
      expect(await res.text()).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    }
  });
  test("web styles declare colours only in :root", async () => {
    const css = await Bun.file("apps/control-plane/web/styles.css").text();
    expect(css.replace(/:root\s*\{[^}]*\}/g, "")).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
  });
  test("the placeholder receiver exports mountReceiver and the exact absence text", async () => {
    const mod = await import("./receive/index.ts");
    expect(typeof mod.mountReceiver).toBe("function");
    expect(mod.RECEIVER_UNAVAILABLE_TEXT).toBe("La réception depuis l'extension n'est pas disponible dans cette version.");
  });
  ```
  Plus :
  - une page demandée sans session → `303` vers `/auth/login?returnTo=%2Freceive` ;
  - l'hôte passe au récepteur l'endpoint et l'origine exacts (un `mountReceiver` de test
    capture `host`) ;
  - `upload` émet `Content-Type: application/zip` et un en-tête d'enveloppe décodable en
    JCS identique à l'enveloppe donnée.

  Le rendu du texte d'absence est vérifié en navigateur réel (Task 28), sans DOM simulé.
- [ ] **Exécution rouge.**
- [ ] **Implémentation.**
  - Routes `Bun.serve` : `"/"`, `"/receive"`, `"/dossiers/:id/send"`, `"/admin/*"`, vers
    les imports HTML.
  - `development: false` en production.
  - `announce.ts` tient une région `aria-live="polite"` et une région `role="alert"`.
- [ ] **Exécution verte.**
- [ ] **Neutralisation :** un `<script>` en ligne dans `index.html` → le premier test rougit.
- [ ] **Commit :** `git add apps/control-plane/web/index.html apps/control-plane/web/app.ts apps/control-plane/web/styles.css apps/control-plane/web/api-client.ts apps/control-plane/web/announce.ts apps/control-plane/web/receive.html apps/control-plane/web/receive-host.ts apps/control-plane/web/receive-contract.ts apps/control-plane/web/receive/index.ts apps/control-plane/web/web.test.ts apps/control-plane/src/http/server.ts`
  puis `git commit -s -m "feat(control-plane): web shell, Dossier list and receive host for extension delivery"`.

### Task 26: Écran d'envoi (design §5.4)

**Files:**
- Create: `apps/control-plane/web/send.html`, `apps/control-plane/web/send.ts`,
  `apps/control-plane/web/send-model.ts`, `apps/control-plane/web/send-model.test.ts`
- Test: `apps/control-plane/web/send-model.test.ts`

**Interfaces:**
- Consumes: `GET …/plan`, `POST …/approvals`, `GET /api/v1/dossiers/{id}`,
  `PROJECTION_STATE_LABELS`, `WITHHOLD_REASON_LABELS` (Task 15), `ApprovalBody` (Task 17).
- Produces:
  ```ts
  type Cell = { destinationId: string; text: "Transmis" | "Retenu"; reason: string | null };
  export interface SendViewModel {
    imposed: { destinationId: string; profileId: string; checked: true; disabled: true }[];
    optional: { destinationId: string; profileId: string; checked: boolean }[];
    selectable: { destinationId: string; profileId: string; added: boolean }[] | null;   // verdict destinations with routing "selectable"; null when override = "denied"
    excludedLabel: string;                                                             // "N destination(s) exclue(s) par la politique"
    table: { path: string; role: string; cells: Cell[] }[];                            // one column per shown destination, added selectable ones included
    approvals: { destinationId: string; approved: boolean }[];
    approveAllLabel: "Approuver les destinations cochées";
  }
  export function buildSendViewModel(plan: PlanResponse, ui: UiState): SendViewModel;
  export function approvalBody(plan: PlanResponse, model: SendViewModel, ui: UiState): ApprovalBody;
  export function stateRows(dossier: DossierResponse): { destinationId: string; label: string; remoteUrl: string | null; receiptId: string | null; failureCode: string | null }[];
  // UiState = { optionalChecked: string[]; added: string[]; extraWithheld: Record<string, string[]>; approved: string[] }
  ```

- [ ] **Test qui échoue :**
  ```ts
  test("the exclusion counter carries the number only", () => {
    expect(buildSendViewModel(planWith({ deniedCount: 2 }), ui()).excludedLabel).toBe("2 destination(s) exclue(s) par la politique");
    expect(buildSendViewModel(planWith({ deniedCount: 0 }), ui()).excludedLabel).toBe("0 destination(s) exclue(s) par la politique");
  });
  test("selectable destinations appear in the selector only when override is allowed, with their own Transmis/Retenu column once added", () => {
    expect(buildSendViewModel(planWith({ override: "denied" }), ui()).selectable).toBeNull();
    const m = buildSendViewModel(planWith({ override: "allowed", selectable: [["x", [["media/a.png", "withhold", "public-destination"]]]] }), ui({ added: ["x"] }));
    expect(m.selectable).toEqual([{ destinationId: "x", profileId: P_TEST, added: true }]);
    expect(m.table.find((r) => r.path === "media/a.png")!.cells.find((c) => c.destinationId === "x")).toEqual({ destinationId: "x", text: "Retenu", reason: "dépôt public" });
  });
  test("approve-all approves only checked destinations and binds the exact transmitted digests", () => {
    const body = approvalBody(plan, model, ui({ optionalChecked: [], approved: ["dest-a", "dest-opt"] }));
    expect(body.approvals.map((a) => a.destinationId)).toEqual(["dest-a"]);
    expect(body.approvals[0]!.transmitted).toEqual([sha("README.md")]);
    expect(body.verdictDigest).toBe(plan.verdictDigest);
  });
  ```
  ```ts
  test("imposed destinations are shown checked and cannot be unchecked", () => {
    expect(buildSendViewModel(planWith({ imposed: ["dest-a"] }), ui({ optionalChecked: [] })).imposed)
      .toEqual([{ destinationId: "dest-a", profileId: P_TEST, checked: true, disabled: true }]);
  });
  test("the table shows Transmis / Retenu with the design reasons", () => {
    const m = buildSendViewModel(planWithFiles([["media/a.png", "withhold", "public-destination"], ["README.md", "transmit", null]]), ui());
    expect(m.table.find((r) => r.path === "media/a.png")!.cells[0]).toEqual({ destinationId: "dest-a", text: "Retenu", reason: "dépôt public" });
    expect(m.table.find((r) => r.path === "README.md")!.cells[0]).toEqual({ destinationId: "dest-a", text: "Transmis", reason: null });
  });
  test("a user can withhold more, never transmit more", () => {
    expect(approvalBody(plan, model, ui({ extraWithheld: { "dest-a": ["README.md"] } })).approvals[0]!.transmitted).toEqual([]);
    expect(() => approvalBody(plan, model, ui({ forceTransmit: { "dest-a": ["media/a.png"] } } as any))).toThrow("selection.escalation");
  });
  test("post-send states use the French labels", () => {
    expect(stateRows(dossierWithStates(["created", "updated", "pending", "dispatching", "to-resolve", "failed"])).map((r) => r.label))
      .toEqual(["créé", "mis à jour", "en attente", "en attente", "à résoudre", "échec"]);
  });
  ```
  Plus : les motifs « résidence hors UE » et « pièce jointe non prise en charge »
  s'affichent pour `residency` et `attachment-unsupported` ; `no rule matched: the screen
  says so and offers no implicit destination` (`imposed`, `optional` et
  `matchedRuleIds` vides → `imposed: []`).
- [ ] **Exécution rouge.**
- [ ] **Implémentation** de `send.ts` : rendu DOM sans framework à partir du modèle.
  - **Contrôles.** Cases natives ; les imposées sont `disabled`, avec `aria-describedby`
    « imposée par la politique ». Sélecteur d'override listant les seules destinations
    `selectable` ; ajouter l'une d'elles fait apparaître sa colonne.
  - **Tableau.** `<caption>` « Ce que chaque destination recevra », `<th scope="col">`
    par destination, `<th scope="row">` par fichier.
  - **Approbation.** « Approuver » par destination, et « Approuver les destinations
    cochées ».
  - **Verdict vide.** « Aucune règle ne s'applique à cette origine : aucune
    destination ».
  - **Erreurs annoncées en `role="alert"`.** `plan.stale` et `plan.mismatch` → « Le plan
    a changé, rechargez-le avant d'approuver » ; `selection.escalation` → « Sélection
    refusée par la politique ».
  - **Après envoi.** Rafraîchissement toutes les 5 s tant qu'un état est `en attente`,
    avec liens distant et de reçu.
- [ ] **Exécution verte.**
- [ ] **Neutralisation :** filtre `approved ∩ checked` remplacé par `approved` → le
  troisième test rougit.
- [ ] **Commit :** `git add apps/control-plane/web/send.html apps/control-plane/web/send.ts apps/control-plane/web/send-model.ts apps/control-plane/web/send-model.test.ts`
  puis `git commit -s -m "feat(control-plane): send screen with per-destination approval bound to the exact plan"`.

### Task 27: Administration de la politique, des destinations, journal d'audit, jetons

**Files:**
- Create (sous `apps/control-plane/web/`) : `admin-policies.html|ts`,
  `admin-destinations.html|ts`, `admin-audit.html|ts`, `tokens.html|ts`,
  `admin-model.ts`, `admin-model.test.ts` ; et `apps/control-plane/src/routes/admin-audit.ts`
- Test: `apps/control-plane/web/admin-model.test.ts`

**Interfaces:**
- Consumes: routes admin des Tasks 12, 13, 19 ; `verifyAuditChain` (Task 9).
- Produces : `GET /api/v1/admin/audit?cursor=&type=` (`policy-admin`, `auditor`) → `{
  data: AuditRow[], meta: { nextCursor, chain: { status, inspected, atSeq? } } }`. Pour
  chaque `plan.evaluated`, la vue résout les destinations refusées à partir de la version
  de politique et des `matchedRuleIds`. C'est le détail que la personne qui signale ne
  voit jamais (design B8).
  ```ts
  export function deniedDestinationsFor(policy: RoutingPolicy, matchedRuleIds: string[]): string[];
  export function qualificationBanner(destinations: { mode: "production" | "qualification" }[]): string | null;
  // "Mode de qualification : ces destinations ne sont pas publiées comme prises en charge."
  ```

- [ ] **Test qui échoue :**
  ```ts
  test("the audit view resolves denied destinations for administrators", () => {
    expect(deniedDestinationsFor(POLICY_WITH_DENIED, ["rule-app"])).toEqual(["internal-secops"]);
  });
  ```
  Plus :
  - bannière de qualification : texte exact, ou `null` sans destination en mode
    qualification ;
  - l'audit rend `meta.chain = { status: "intact", inspected: n }` ;
  - un `reporter` → `403` ;
  - l'écran de politique montre auteur, approbateur et état, et désactive « Approuver »
    pour l'auteur tant que la séparation est exigée.
- [ ] **Exécution rouge.**
- [ ] **Implémentation.** Formulaires natifs envoyés par `fetch` same-origin. Le jeton
  émis n'est affiché qu'une fois, en lecture seule, avec « Copier » ; il n'est jamais
  stocké dans le navigateur.
- [ ] **Exécution verte.**
- [ ] **Neutralisation :** `deniedDestinationsFor` rend `[]` → le test rougit.
- [ ] **Commit :** `git add apps/control-plane/web/admin-policies.html apps/control-plane/web/admin-policies.ts apps/control-plane/web/admin-destinations.html apps/control-plane/web/admin-destinations.ts apps/control-plane/web/admin-audit.html apps/control-plane/web/admin-audit.ts apps/control-plane/web/tokens.html apps/control-plane/web/tokens.ts apps/control-plane/web/admin-model.ts apps/control-plane/web/admin-model.test.ts apps/control-plane/src/routes/admin-audit.ts`
  puis `git commit -s -m "feat(control-plane): policy, destination, audit and token administration screens"`.

### Task 28: Contrôle navigateur réel (clavier, noms accessibles, erreurs annoncées, en-têtes)

**Files:**
- Create: `apps/control-plane/web/send.browser-check.ts`
- Modify: `.github/workflows/ci.yml` (étape après `bun run check:tree`, job `bun-quality`)
- Test: `apps/control-plane/web/send.browser-check.ts`

**Interfaces:**
- Consumes: le modèle de `apps/extension-shared/editor.browser-check.ts` (Chrome par CDP,
  `CHROME_BINARY`, `browser-check-watchdog.ts`) ; `startTestControlPlane` (Task 24).
- Produces: `bun tools/ci/with-postgres.ts -- bun apps/control-plane/web/send.browser-check.ts`.
  Code `0` si les 7 assertions passent, `1` sinon ; le compte est imprimé.

- [ ] **Assertions écrites d'abord**, sur un banc `startTestControlPlane()` avec une
  politique d'essai (une imposée, une optionnelle, une refusée, override autorisé) :
  1. parcours au clavier seul (`Tab`, `Space`, `Enter`) : cocher l'optionnelle,
     approuver, voir `en attente` puis `créé` après `drainOutbox` ;
  2. chaque contrôle interactif a un nom accessible non vide (`Accessibility.getFullAXTree`) ;
  3. la case imposée est `disabled` et son nom contient « imposée par la politique » ;
  4. un `409 plan.stale` provoqué (visibilité basculée par `fakeProvider.store` entre
     l'affichage et l'approbation) produit « Le plan a changé, rechargez-le avant
     d'approuver » dans un nœud `role=alert` ;
  5. « 1 destination(s) exclue(s) par la politique » est présent, et le nom de la
     destination refusée est absent du DOM ;
  6. un `POST` émis par la page porte `Sec-Fetch-Site: same-origin`
     (`Network.requestWillBeSentExtraInfo`), ce qui confirme pour Chrome l'hypothèse de
     la Task 10 ;
  7. `/receive` affiche le texte exact du récepteur absent.
- [ ] **Exécution rouge :** retirer le `<label>` d'une case → l'assertion 2 rougit. Cette
  étape tient lieu de neutralisation ; la consigner dans le commit.
- [ ] **Exécution verte :** `CHROME_BINARY=… bun tools/ci/with-postgres.ts -- bun
  apps/control-plane/web/send.browser-check.ts` → `send browser check: 7/7 assertions`.
  Le banc `startTestControlPlane` remplace le `send.browser-fixture.ts` dédié de la
  version précédente du plan.
- [ ] **CI :** étape ajoutée au job `bun-quality`, avec `CHROME_BINARY:
  /usr/bin/google-chrome` et la base du service conteneur. Firefox et Safari relèvent de
  L6 (`browser-matrix-real`) ; le dire dans le commit.
- [ ] **Commit :** `git add apps/control-plane/web/send.browser-check.ts .github/workflows/ci.yml`
  puis `git commit -s -m "test(control-plane): real Chrome keyboard, accessible-name and alert checks for the send screen"`.

### Task 29: Déploiement de référence Clever Cloud (Paris), PostgreSQL géré, Cellar S3

**Files:**
- Create: `docs/runbooks/control-plane-clever-cloud.md`, `apps/control-plane/README.md`,
  `apps/control-plane/src/admin/rewrap.ts`, `apps/control-plane/src/admin/rewrap.test.ts`,
  `apps/control-plane/src/admin/smoke.ts`
- Test: `apps/control-plane/src/admin/rewrap.test.ts`

**Interfaces:**
- Consumes: `rewrap` (Task 6), `migrate`, `applyGrants`, `bootstrap.ts`.
- Produces:
  ```
  bun apps/control-plane/src/admin/rewrap.ts              # re-seal every envelope under the active master key; per-table counts
  bun apps/control-plane/src/admin/smoke.ts <publicOrigin> # /healthz, CSP header, /api/v1/profiles 401 without auth, runtime role check; exit 0/1
  ```

- [ ] **Test qui échoue :**
  ```ts
  test("rewrap re-seals every envelope and reports per-table counts that sum", async () => {
    expect(await runRewrap(db, ringWithActive("k2"))).toEqual({ provider_credentials: 2, signing_keys: 3, artifacts: 0, total: 5, failed: 0 });
  });
  ```
  Plus : enveloppe sous une clé maîtresse inconnue → échec nommé (`failed: 1`, code `1`),
  jamais un saut.
- [ ] **Exécution rouge.** **Implémentation** (`rewrap` traite aussi les objets du
  stockage, compteur `artifacts`). **Exécution verte.**
- [ ] **Runbook** (français, sans valeur d'instance, sans URL à mot de passe, sans
  identifiant réel) :
  - **Application.** Bun en région `par`. Démarrage `bun apps/control-plane/src/main.ts`,
    pré-démarrage `bun apps/control-plane/src/db/migrate.ts`.
  - **PostgreSQL géré** (Paris). Rôle applicatif distinct si l'offre le permet, sinon
    mode mono-rôle (RLS forcée). Relever `select rolsuper, rolbypassrls, rolcreaterole
    from pg_roles where rolname = current_user` dans la preuve de déploiement ;
    `rolbypassrls = true` interdit le déploiement.
  - **Cellar.** Bucket privé, variables `SIGNALEMENT_S3_*`.
  - **Variables.** Celles de la Task 2, injectées par la console ou la CLI Clever, jamais
    commitées. Trousseau maître par `openssl rand -base64 32`.
  - **Amorçage.** `bootstrap.ts`, avec un JSON de correspondance de rôles conservé hors
    dépôt.
  - **Effets externes.** `SIGNALEMENT_EXTERNAL_EFFECTS=enabled` seulement après la
    vérification post-déploiement. Une restauration repasse les effets à désactivés
    jusqu'à revue.
  - **Post-déploiement.** `smoke.ts <origine>`, puis `s3-live.test.ts` avec
    `SIGNALEMENT_REQUIRE_S3_LIVE=true` contre Cellar. Échec → redéploiement de la
    révision précédente (`clever deploy` de la révision antérieure).
  - **Rotations.**
    - Clés de signature : endpoint admin.
    - Trousseau maître : nouvelle clé active, puis `rewrap.ts`, puis retrait de
      l'ancienne.
    - `biscuit-root` : rotation, puis attente du TTL maximal avant retrait.
    - Matrice de qualification : redémarrage.
  - **Limite.** Les garanties contractuelles Clever Cloud (localisation,
    sous-traitants) ne sont pas établies (fondation). Aucune donnée de production avant
    cette preuve.
- [ ] **README** `apps/control-plane/README.md` : tableau des routes du registre §4.5
  recopié, routes internes, commandes, variables, modèle de rôles, banc
  `startTestControlPlane`.
- [ ] **Commit :** `git add docs/runbooks/control-plane-clever-cloud.md apps/control-plane/README.md apps/control-plane/src/admin/rewrap.ts apps/control-plane/src/admin/rewrap.test.ts apps/control-plane/src/admin/smoke.ts`
  puis `git commit -s -m "docs(control-plane): Clever Cloud reference deployment, rewrap and smoke commands"`.

### Task 30: Vérification du critère de sortie L4

**Files:**
- Create: `tools/ci/control-plane-coverage.toml`
- Modify: `package.json:43` (`check:tree`), `package.json` (script `check:control-plane`)
- Test: commandes ci-dessous.

**Interfaces:**
- Consumes: tout le lot.
- Produces: preuve de sortie dans la description de PR.

- [ ] **Couverture.**
  - `tools/ci/control-plane-coverage.toml`, sur le modèle de `tools/ci/core-coverage.toml`
    : `coverageThreshold = 0.9`, `coverageDir = "./coverage/control-plane"`.
  - Script `"check:control-plane": "bun run check:bun:runtime && bun
    tools/ci/with-postgres.ts -- bun test --config=tools/ci/control-plane-coverage.toml
    apps/control-plane"`, inséré dans `check:tree` avant `bun run lint`.
  - `shortcut: la suite PostgreSQL du control plane tourne deux fois dans check:tree,
    upgrade trigger : check:tree au-delà de 10 min ou exclusion de chemins fiable dans bun
    test`.
  - Commit : `git add tools/ci/control-plane-coverage.toml package.json` puis
    `git commit -s -m "ci(control-plane): blocking coverage threshold for the control plane"`.
- [ ] **`bun run check` vert.** Relever : nombre de tests, `rls sweep: 21 tables
  inspected`, `cross-organization-disclosure: <n> tables x 3 operations`, `authz matrix:
  <n> routes`, couverture du control plane.
- [ ] **Critères de la feuille de route §2 (ligne L4).** Chaque commande est préfixée par
  `bun tools/ci/with-postgres.ts --` :

  | Critère | Commande |
  | --- | --- |
  | schéma et RLS | `bun test apps/control-plane/src/db` |
  | outbox et dispatcher | `bun test apps/control-plane/src/dispatcher` |
  | OIDC, Biscuit | `bun test apps/control-plane/src/auth` |
  | politique et audit | `bun test apps/control-plane/src/domain/policies.test.ts apps/control-plane/src/audit` |
  | écran d'envoi | `bun test apps/control-plane/web`, puis Task 28 |
  | `cross-organization-disclosure` | `bun test apps/control-plane/test/cross-organization-disclosure.test.ts` |
  | `stale-plan-refused` | `bun test apps/control-plane/test/stale-plan-refused.test.ts` |
  | `capability-overclaim` (côté L4) | `bun test apps/control-plane/src/routes/profiles.test.ts apps/control-plane/src/domain/destinations.test.ts` |
  | banc L6/L7 | `bun test apps/control-plane/testing` |

- [ ] **Statut par critère.** Chaque critère est rapporté en `pass`, `fail`,
  `unavailable` ou `blocked`. `s3-live` est `unavailable` sans bucket de test. Le test sur
  les `CONNECTORS` réels est `blocked (L5)` tant que `connectors/index.ts` manque.
- [ ] **Revue.** Proposer `/code-review:code-review` sur la PR avant fusion ; la PR liste
  les écarts au registre de ce plan non encore résorbés dans la feuille de route.
