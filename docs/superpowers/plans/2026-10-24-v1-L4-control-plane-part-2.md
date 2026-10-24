# L4 control plane — partie 2 : phase B (1/2), API

Index, Global Constraints et Review Focus : `2026-10-24-v1-L4-control-plane.md`.
Suite de la phase B : partie 3.

Sortie de phase B (fin de la partie 3) : API `/api/v1` du registre §4.5 servie par
`Bun.serve` avec un principal de test injecté (authentification réelle en phase C),
outbox et dispatcher contre le faux fournisseur L3, `stale-plan-refused` et
`cross-organization-disclosure` verts.

### Task 10: Noyau HTTP (serveur, enveloppe, erreurs, en-têtes, CSRF, principal)

**Files:**
- Create (sous `apps/control-plane/src/`) : `http/server.ts`, `http/envelope.ts`,
  `http/errors.ts`, `http/security-headers.ts`, `http/csrf.ts`, `http/bounded-body.ts`,
  `auth/principal.ts`, `main.ts`, `http/server.test.ts`, `http/csrf.test.ts` ; et
  `apps/control-plane/test/http.ts`
- Test: `apps/control-plane/src/http/server.test.ts`, `apps/control-plane/src/http/csrf.test.ts`

**Interfaces:**
- Consumes: `AppConfig`, `assertRuntimeRole`, `log`, `encryptedStore`, `connectorFor` (L5).
- Produces:
  ```ts
  export type Role = "reporter" | "policy-admin" | "auditor";
  export interface Principal { organization: string; principalRef: string; issuer: string; subject: string; roles: readonly Role[]; auth: "session" | "biscuit"; }
  export function principalRef(issuer: string, subject: string): string;   // sha256 hex of JSON.stringify([issuer, subject])
  export type Authenticator = (request: Request) => Promise<Principal | null>;
  export interface AppDeps {
    config: AppConfig; app: Bun.SQL; api: PolicyReceiptApi; store: ReturnType<typeof encryptedStore>;
    connectorFor: (profileId: string) => Connector | null;   // L5 connectorFor in production; injected in tests
    httpFor: (destination: DestinationTarget) => HttpPort;     // createFetchHttpPort (L3 SDK) in production; fake provider in tests
    authenticate: Authenticator; now(): Date;
  }
  export function createServer(deps: AppDeps, options: { port: number; hostname: string }): Bun.Server;
  export function ok<T>(data: T, meta?: Record<string, unknown>, status?: number): Response;
  export function fail(status: number, code: ApiErrorCode): Response;
  export type ApiErrorCode = string;   // closed union grown task by task in errors.ts, fixed message per code
  export function csrfVerdict(request: Request, auth: Principal["auth"] | null, publicOrigin: string): "allowed" | "refused";
  export function readBounded(request: Request, limit: number): Promise<Uint8Array>;   // throws "body.too_large"
  ```

- [ ] **Test qui échoue** (`csrf.test.ts`) :
  ```ts
  test.each(["POST", "PUT", "PATCH", "DELETE"])("session %s needs Sec-Fetch-Site same-origin and a matching Origin", (method) => {
    expect(csrfVerdict(req(method, { "sec-fetch-site": "same-origin", origin: ORIGIN }), "session", ORIGIN)).toBe("allowed");
    for (const site of ["same-site", "cross-site", "none"]) expect(csrfVerdict(req(method, { "sec-fetch-site": site, origin: ORIGIN }), "session", ORIGIN)).toBe("refused");
    expect(csrfVerdict(req(method, { origin: ORIGIN }), "session", ORIGIN)).toBe("refused");   // header absent: fail closed
    expect(csrfVerdict(req(method, { "sec-fetch-site": "same-origin", origin: "https://evil.example.test" }), "session", ORIGIN)).toBe("refused");
  });
  ```
  Plus : `bearer requests carry no ambient credential and are not subject to the
  fetch-metadata check` (`csrfVerdict(req("POST", {}), "biscuit", ORIGIN)` →
  `allowed`) ; `safe methods are allowed` (`GET` avec `sec-fetch-site: cross-site` →
  `allowed`).
  Décision : pas de jeton anti-CSRF. Cookie `SameSite=Lax`, `Sec-Fetch-Site` exigé sur
  toute méthode non sûre authentifiée par cookie. Si le contrôle navigateur (Task 28,
  ou L6 pour Firefox et Safari) montre un navigateur qualifié sans cet en-tête, ajouter
  `Bun.CSRF.generate`/`verify` (natif) avant fusion.
- [ ] **Test qui échoue** (`server.test.ts`, port éphémère, `testDeps()` de
  `test/http.ts` avec un `Authenticator` de test) :
  ```ts
  test("every response carries the security headers", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    expect(res.headers.get("strict-transport-security")).toBe("max-age=63072000; includeSubDomains");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  ```
  Plus : `/healthz` → `{ data: { status: "ok" }, meta: {} }` ; route inconnue → `404`
  `{ error: { code: "route.not_found", message: "Route not found." } }` ; appel API non
  authentifié → `401 auth.required` ; exception dans un handler → `500 internal.error`
  sans pile ni message (un handler qui lève `"secret-detail"` → corps sans ce texte) ;
  `readBounded` s'arrête à la borne (`limit + 1` octets → `body.too_large`) ; `main`
  refuse de démarrer avec un rôle `BYPASSRLS` (code `1`, `db.runtime_role_bypassrls`).
  Câblage du transport (le port lui-même est testé par L3) : `main wires
  createFetchHttpPort with allowPrivate from config` — `httpFor` de production refuse
  `https://169.254.169.254/` dans tous les cas, et refuse `https://10.0.0.1/` quand
  `SIGNALEMENT_ALLOW_PRIVATE_DESTINATIONS` est absent ; aucune déclaration de
  `createFetchHttpPort` sous `apps/control-plane`
  (`grep -rn "function createFetchHttpPort" apps/control-plane` vide).
- [ ] **Exécution rouge.**
- [ ] **Implémentation.** `Bun.serve({ routes, fetch, error, maxRequestBodySize: 269500416
  + 65536 })`, routage par la table `routes` (paramètres `:id`) ; chaîne fixe par route : en-têtes → authentification → CSRF →
  `requireRole` → handler ; exception → `fail(500, "internal.error")` et `log("error", {
  event: "http.unhandled", route, requestId })`. `main.ts` : `loadConfig`, `Bun.SQL`,
  `assertRuntimeRole`, `loadPolicyReceipt()`, dépendances (`connectorFor` de
  `connectors/index.ts` filtré par la Task 11, `httpFor` = `createFetchHttpPort({
  timeoutMs: 30000, maxResponseBytes: 8388608, allowPrivate:
  config.allowPrivateDestinations })` du SDK L3), `createServer`, puis dispatcher et
  scrutateur seulement si `externalEffects === "enabled"` ; arrêt propre sur `SIGTERM`.
- [ ] **Exécution verte.**
- [ ] **Neutralisation :** `"allowed"` quand `Sec-Fetch-Site` est absent → le cas « header
  absent » rougit.
- [ ] **Commit :** `git add apps/control-plane/src/http apps/control-plane/src/auth/principal.ts apps/control-plane/src/main.ts apps/control-plane/test/http.ts`
  puis `git commit -s -m "feat(control-plane): Bun.serve core with envelope, security headers and fetch-metadata CSRF guard"`.

### Task 11: Profils qualifiés et résolution des connecteurs

**Files:**
- Create: `apps/control-plane/src/connectors/matrix.ts`, `apps/control-plane/src/connectors/resolve.ts`,
  `apps/control-plane/src/routes/profiles.ts`, `apps/control-plane/src/connectors/matrix.test.ts`,
  `apps/control-plane/src/routes/profiles.test.ts`
- Test: `apps/control-plane/src/connectors/matrix.test.ts`, `apps/control-plane/src/routes/profiles.test.ts`

**Interfaces:**
- Consumes: `connectorFor`, `CONNECTORS` (`connectors/index.ts`, L5) ; `profileIdOf`
  (L3 SDK) ; matrice `qualification/provider-matrix.yaml` (lue, jamais écrite).
- Produces:
  ```ts
  export function qualifiedProfileIds(matrixYaml: string): ReadonlySet<string>;
  export function qualifiedConnectorFor(lookup: (profileId: string) => Connector | null, qualified: ReadonlySet<string>): (profileId: string) => Connector | null;
  export function servedProfiles(connectors: readonly Connector[], qualified: ReadonlySet<string>): ConnectorProfile[];
  // third argument of buildDeliveryPlan(verdict, selection, profileFor) (registry §4.4)
  export function qualifiedProfileFor(resolve: (profileId: string) => Connector | null): (profileId: string) => ConnectorProfile | null;
  // GET /api/v1/profiles → { data: { profileId: string; profile: ConnectorProfile }[], meta: { nextCursor: null } }
  ```

Règle (design §5.6, prédicat `capability-overclaim`, registre §4.4 bis et §4.5) : un
profil est servi et résolu si et seulement si une entrée de la matrice a `status:
qualified` et `profile` égal à son identifiant exact, **et** `connectorFor` le connaît.
Sinon `qualifiedConnectorFor` rend `null`. L5 étend le validateur
(`tools/ci/qualification.ts:13`) à `qualified` et `profile` ; L4 ne modifie pas la
matrice.

- [ ] **Test qui échoue :**
  ```ts
  const MATRIX = `schema_version: libre-ai.signalement.qualification.v1
  kind: provider-matrix
  entries:
    - { id: reference, status: qualified, profile: "fake-reference/test/v1", statement: "x", source: "y", reopens_on: "z" }
    - { id: gitlab-issues, status: unresolved, profile: "gitlab-issues/gitlab.com/rest-v4", statement: "x", source: "y", reopens_on: "z" }
    - { id: jira-cloud, status: qualified, statement: "x", source: "y", reopens_on: "z" }
    - { id: plane, status: verified, profile: "plane/self-hosted/rest-v1", statement: "x", source: "y", reopens_on: "z" }`;
  test("only qualified entries with an exact profile id qualify", () => {
    expect([...qualifiedProfileIds(MATRIX)]).toEqual(["fake-reference/test/v1"]);
  });
  test("the repository matrix qualifies nothing today", async () => {
    expect(qualifiedProfileIds(await Bun.file("qualification/provider-matrix.yaml").text()).size).toBe(0);
  });
  test("an unqualified or unknown profile resolves to null", () => {
    const resolve = qualifiedConnectorFor((id) => (id === TEST_PROFILE || id === GITLAB ? reference : null), qualifiedProfileIds(MATRIX));
    expect(resolve(TEST_PROFILE)).toBe(reference);
    expect(resolve(GITLAB)).toBeNull();
    expect(resolve("nope/x/y")).toBeNull();
  });
  test("GET /api/v1/profiles lists the intersection of qualified and known, never more", async () => {
    const body = await (await authedFetch("/api/v1/profiles", { roles: ["reporter"] })).json();
    expect(body.data.map((p: { profileId: string }) => p.profileId)).toEqual([TEST_PROFILE]);
    expect(body.meta).toEqual({ nextCursor: null });
  });
  test("with the real CONNECTORS and the repository matrix, nothing is served", () => {
    expect(servedProfiles(CONNECTORS, qualifiedProfileIds(REPO_MATRIX))).toEqual([]);
  });
  ```
  Plus : `a qualified profile without a known connector is not listed` (matrice
  qualifiant `plane/self-hosted/rest-v1`, `connectorFor` qui ne le connaît pas → `[]`) ;
  `qualifiedProfileFor` rend le `ConnectorProfile` exact (par `profileIdOf`) d'un profil
  résolu, et `null` pour un profil non qualifié.
  Le test sur les `CONNECTORS` réels n'est écrit que si `connectors/index.ts` existe sur la base ; sinon la
  tâche le note comme `blocked (L5)` dans le commit et `main.ts` garde `connectorFor`
  injecté.
- [ ] **Exécution rouge.** **Implémentation** (matrice lue une fois au démarrage,
  `config.matrixPath` ; modification = redémarrage, documenté Task 29). **Exécution verte.**
- [ ] **Neutralisation :** accepter `status !== "unresolved"` → le premier test rougit
  (l'entrée `verified` passe).
- [ ] **Commit :** `git add apps/control-plane/src/connectors apps/control-plane/src/routes/profiles.ts apps/control-plane/src/routes/profiles.test.ts`
  puis `git commit -s -m "feat(control-plane): serve and resolve only qualified connector profiles"`.

### Task 12: Destinations, jetons fournisseurs chiffrés, mode de qualification

**Files:**
- Create: `apps/control-plane/src/domain/destinations.ts`, `apps/control-plane/src/routes/admin-destinations.ts`,
  `apps/control-plane/src/domain/destinations.test.ts`
- Test: `apps/control-plane/src/domain/destinations.test.ts`

**Interfaces:**
- Consumes: `qualifiedConnectorFor` (Task 11), `connectorFor` (L5, mode qualification),
  `seal`/`open`, `appendAudit`, `Connector.discover`, `Connector.validateMapping`,
  `Discovery.profileId`, `SecretHandle.fromString` (L3).
- Produces:
  ```ts
  export interface DestinationInput { destinationId: string; profileId: string; target: DestinationTarget; declared: Record<string, string>; credential: string; mode: "production" | "qualification"; }
  export function configureDestination(deps: AppDeps, principal: Principal, input: DestinationInput): Promise<Result<{ destinationRowId: string }, { code: string }>>;
  export function connectorContextFor(deps: AppDeps, tx: ScopedTx, destinationId: string): Promise<{ connector: Connector; ctx: ConnectorContext; target: DestinationTarget; mode: "production" | "qualification" }>;
  ```
  Routes internes (rôle `policy-admin`) : `GET|POST /api/v1/admin/destinations`,
  `PUT /api/v1/admin/destinations/{id}/credential`, `POST /api/v1/admin/destinations/{id}/disable`.

- [ ] **Test qui échoue :**
  ```ts
  test("a production destination whose discovery matches no qualified profile is refused", async () => {
    expect(await configureDestination(deps(matrix([])), admin, input({ mode: "production" })))
      .toEqual({ ok: false, error: { code: "destination.profile_unqualified" } });
    expect(await auditTypes()).toContain("destination.refused");
  });
  test("the credential never appears in any response, audit row or log line", async () => {
    const secret = "tok-" + crypto.randomUUID();
    await configureDestination(deps(), admin, input({ credential: secret }));
    expect(JSON.stringify([await listResponse(), await readAudit(ORG_A), capturedLogs()])).not.toContain(secret);
    const [row] = await db.owner`select envelope from signalement.provider_credentials`;
    expect(Buffer.from(row.envelope).includes(Buffer.from(secret))).toBe(false);
  });
  ```
  Plus : découverte rendant un autre profil que celui déclaré →
  `destination.profile_mismatch` ; destination en mode qualification acceptée pour tout
  profil connu de `connectorFor`, listée avec `mode: "qualification"` et `meta:
  { qualificationMode: true }` ; mode qualification réservé aux administrateurs (`403`
  pour un `reporter`) ; `String(ctx.credential)` = `"[secret]"` et
  `JSON.stringify(ctx.credential)` = `'"[secret]"'`.
- [ ] **Exécution rouge.**
- [ ] **Implémentation.** Jeton scellé (`purpose: "provider-credential"`, `table:
  "provider_credentials"`, `rowId` = id de ligne) ; `ctx = { http:
  deps.httpFor(target), credential: SecretHandle.fromString(clair), clock }`, où
  `clock` rend l'heure ISO 8601 de `deps.now` ;
  découverte limitée à 30 s, échec → `destination.discovery_failed` (rien d'écrit) ;
  `validateMapping` invalide → `destination.invalid_mapping`. Les destinations en mode
  qualification servent à exécuter la suite de conformité contre une instance réelle,
  jamais à une politique approuvée (Task 13).
- [ ] **Exécution verte.**
- [ ] **Neutralisation :** court-circuiter `qualifiedConnectorFor` en mode production →
  le premier test rougit.
- [ ] **Commit :** `git add apps/control-plane/src/domain/destinations.ts apps/control-plane/src/routes/admin-destinations.ts apps/control-plane/src/domain/destinations.test.ts`
  puis `git commit -s -m "feat(control-plane): destinations with sealed provider tokens and admin-only qualification mode"`.

### Task 13: Politiques versionnées (`draft → approved → retired`) et séparation auteur/approbateur

**Files:**
- Create: `apps/control-plane/src/domain/policies.ts`, `apps/control-plane/src/domain/settings.ts`,
  `apps/control-plane/src/routes/admin-policies.ts`, `apps/control-plane/src/domain/policies.test.ts`,
  `apps/control-plane/migrations/0007_policy_immutability.sql`
- Test: `apps/control-plane/src/domain/policies.test.ts`

**Interfaces:**
- Consumes: `rawRoutingPolicyFailures` (L1), `RoutingPolicy` (L2), `canonicalize`,
  `appendAudit`, destinations (Task 12).
- Produces:
  ```ts
  export function draftPolicy(deps: AppDeps, author: Principal, document: Uint8Array): Promise<Result<{ policyVersionId: string; version: number; digest: string }, { code: string; failures?: string[] }>>;
  export function approvePolicy(deps: AppDeps, approver: Principal, policyVersionId: string): Promise<Result<{ retiredPolicyVersionId: string | null; deliveriesToResolve: number }, { code: string }>>;
  export function retirePolicy(deps: AppDeps, admin: Principal, policyVersionId: string): Promise<Result<{ deliveriesToResolve: number }, { code: string }>>;
  export function activePolicy(tx: ScopedTx, organization: string): Promise<{ policyVersionId: string; version: number; digest: string; policy: RoutingPolicy } | null>;
  export function requestSettingChange(deps: AppDeps, author: Principal, value: "required" | "relaxed"): Promise<{ changeId: string }>;
  export function decideSettingChange(deps: AppDeps, approver: Principal, changeId: string, decision: "approved" | "rejected"): Promise<Result<void, { code: string }>>;
  ```
  Routes internes (`policy-admin` ; lecture aussi `auditor`) : `GET|POST
  /api/v1/admin/policies`, `POST …/policies/{id}/approve`, `POST …/policies/{id}/retire`,
  `GET|POST /api/v1/admin/settings/changes`, `POST …/settings/changes/{id}/decide`.

- [ ] **Test qui échoue :**
  ```ts
  test("the author cannot approve their own draft by default", async () => {
    const d = await draft(alice);
    expect(await approvePolicy(deps(), alice, d.policyVersionId)).toEqual({ ok: false, error: { code: "policy.self_approval" } });
    expect((await approvePolicy(deps(), bob, d.policyVersionId)).ok).toBe(true);
  });
  test("relaxing separation is itself an approved, audited change and cannot be self-approved", async () => {
    const { changeId } = await requestSettingChange(deps(), alice, "relaxed");
    expect(await decideSettingChange(deps(), alice, changeId, "approved")).toEqual({ ok: false, error: { code: "setting.self_approval" } });
    expect((await decideSettingChange(deps(), bob, changeId, "approved")).ok).toBe(true);
    expect((await approvePolicy(deps(), alice, (await draft(alice)).policyVersionId)).ok).toBe(true);
    expect(await auditTypes()).toEqual(expect.arrayContaining(["setting.change.requested", "setting.change.approved", "policy.approved"]));
  });
  ```
  Plus : document hors contrat → `policy.invalid` avec `failures` non vide ; approuver v2
  retire v1 et passe ses livraisons non réclamées en `to-resolve` (`deliveriesToResolve:
  1`) ; une politique qui référence une destination absente ou désactivée
  (`policy.destination_unconfigured`), en mode qualification
  (`policy.destination_in_qualification`) ou de profil non qualifié
  (`policy.profile_unqualified`) n'est pas approuvable ; deux approbations concurrentes →
  une seule version `approved` ; version approuvée ou retirée immuable (réapprobation →
  `policy.state` ; `UPDATE` direct de `document` → déclencheur
  `policy_versions.immutable`, migration 0007).
- [ ] **Exécution rouge.**
- [ ] **Implémentation.** Document stocké canonique, `digest` = SHA-256 du canonique,
  `version = max + 1` sous verrou consultatif par organisation. `approvePolicy` en une
  transaction : état, séparation (`organizations.policy_approval_separation`),
  destinations (actives, `production`, profil résolu par `qualifiedConnectorFor`),
  retrait de l'ancienne version, `to-resolve` de ses livraisons `pending` (outbox
  `done`), audits `policy.retired` puis `policy.approved`.
- [ ] **Exécution verte.**
- [ ] **Neutralisation :** supprimer la comparaison auteur ≠ approbateur → le premier test
  rougit.
- [ ] **Commit :** `git add apps/control-plane/src/domain/policies.ts apps/control-plane/src/domain/settings.ts apps/control-plane/src/routes/admin-policies.ts apps/control-plane/src/domain/policies.test.ts apps/control-plane/migrations/0007_policy_immutability.sql`
  puis `git commit -s -m "feat(control-plane): versioned routing policies with audited author/approver separation"`.

### Task 14: `POST /api/v1/deliveries/uploads` — réception, revérification, Dossier lié à la personne

**Files:**
- Create: `apps/control-plane/src/domain/dossiers.ts`, `apps/control-plane/src/routes/uploads.ts`,
  `apps/control-plane/src/routes/uploads.test.ts`, `apps/control-plane/test/export-fixture.ts`
- Test: `apps/control-plane/src/routes/uploads.test.ts`

**Interfaces:**
- Consumes: `verifyExport` (`tools/contracts/verify-export.ts:5`), `readZip`
  (`packages/domain/zip.ts`), `DeliveryEnvelope`, `buildDeliveryEnvelope`
  (`packages/domain/delivery-envelope.ts`, L1), `rawDeliveryEnvelopeFailures` (L1),
  `buildExportFixture` (L3), `readBounded`, `encryptedStore`, `appendAudit`.
- Produces (registre §4.5, à l'identique) :
  ```
  POST /api/v1/deliveries/uploads
    Content-Type: application/zip ; body = exact export ZIP bytes (bounded stream)
    Signalement-Delivery-Envelope: base64url(JCS of signalement-delivery-envelope-v1), ≤ 4096 bytes
  201 { data: { dossierId, revisionId, exportSha256, created: true },  meta: {} }
  200 { data: { dossierId, revisionId, exportSha256, created: false }, meta: {} }   // same export again
  ```
  ```ts
  export function receiveExport(deps: AppDeps, principal: Principal, envelope: DeliveryEnvelope, bytes: Uint8Array): Promise<Result<{ dossierId: string; revisionId: string; exportSha256: string; created: boolean }, { code: string }>>;
  ```

- [ ] **Fixture.** `test/export-fixture.ts` : export de `buildExportFixture()` (L3 :
  vrai contrat d'export, captures `kept-shot-a1` et `held-shot-b2`) et enveloppe par
  `buildDeliveryEnvelope(bytes, origin)` (L1).
- [ ] **Test qui échoue :**
  ```ts
  test("a valid export creates a Dossier bound to the submitting person", async () => {
    const res = await upload(exportBytes, await buildDeliveryEnvelope(exportBytes, "https://app.example.test"), reporterA);
    expect(res.status).toBe(201);
    expect((await res.json()).data).toMatchObject({ created: true, exportSha256: sha256hex(exportBytes) });
  });
  test("an upload larger than the bound is refused at the bound without buffering the rest", async () => {
    const { response, pulled } = await streamingUpload(269500416 + 1);   // no Content-Length; counts bytes pulled from the source
    expect(response.status).toBe(413); expect(pulled).toBeLessThanOrEqual(269500416 + 65536);
  });
  ```
  Plus : même export deux fois → `200`, `created: false`, même `revisionId`, une seule
  révision ; même identifiant de Dossier producteur remis par une autre personne →
  autre `dossierId` ; une table de refus :

  | Cas | Statut | Code |
  | --- | --- | --- |
  | digest de l'enveloppe ≠ SHA-256 du corps | 422 | `upload.digest_mismatch` |
  | longueur ≠ | 422 | `upload.length_mismatch` |
  | un octet inversé (enveloppe recalculée) | 422 | `upload.export_invalid` |
  | enveloppe hors contrat, origine avec chemin, origine `ftp:` | 422 | `upload.envelope_invalid` |
  | en-tête d'enveloppe > 4096 octets | 422 | `upload.envelope_invalid` |
  | type de contenu autre que `application/zip` | 415 | `upload.content_type` |
  | principal sans rôle `reporter` | 403 | `auth.forbidden` |

  Un refus n'écrit ni ligne ni artefact ; un troisième traitement simultané → `503
  upload.busy` avec `Retry-After`.
- [ ] **Exécution rouge.**
- [ ] **Implémentation.** Ordre fixe : rôle → type → décodage et validation de
  l'enveloppe (`rawDeliveryEnvelopeFailures`, puis `new URL(o).origin === o`, schéma
  `https:`/`http:`, si non `null`) → lecture bornée à `269500416` (borne de
  `tools/contracts/verify-export.ts:31`) → longueur et SHA-256 → `verifyExport(bytes)`
  (défaillance → `upload.export_invalid` ; le nombre de défaillances va à l'audit
  `upload.refused`, la liste n'est pas renvoyée) → `readZip` → transaction
  `withOrganization` : Dossier par (`producer_dossier_id`, `issuer`, `subject`),
  révision unique par `export_sha256`, artefacts scellés (`purpose: "artifact"`, `rowId`
  = id d'artefact) pour chaque entrée, y compris `manifest.json` (rôle `manifest`), audit
  `dossier.revision.received`. Objets écrits avant le commit, supprimés si la
  transaction échoue. Sémaphore de 2.
- [ ] **Exécution verte.**
- [ ] **Neutralisation :** `verifyExport(bytes)` → `[]` → le cas « un octet inversé » rougit.
- [ ] **Commit :** `git add apps/control-plane/src/domain/dossiers.ts apps/control-plane/src/routes/uploads.ts apps/control-plane/src/routes/uploads.test.ts apps/control-plane/test/export-fixture.ts`
  puis `git commit -s -m "feat(control-plane): receive and re-verify exports into person-bound Dossiers"`.

### Task 15: `GET /api/v1/dossiers/{id}` et liste des Dossiers

**Files:**
- Create: `apps/control-plane/src/routes/dossiers.ts`, `apps/control-plane/src/routes/dossiers.test.ts`,
  `apps/control-plane/src/domain/labels.ts`
- Test: `apps/control-plane/src/routes/dossiers.test.ts`

**Interfaces:**
- Consumes: `ProjectionState` (L3), `WithholdReason` (L2).
- Produces:
  ```ts
  export const PROJECTION_STATE_LABELS: Record<ProjectionState, string> = {
    pending: "en attente", dispatching: "en attente", created: "créé", updated: "mis à jour", "to-resolve": "à résoudre", failed: "échec",
  };
  export const WITHHOLD_REASON_LABELS: Record<WithholdReason, string> = {
    "public-destination": "dépôt public", residency: "résidence hors UE", "attachment-unsupported": "pièce jointe non prise en charge",
    "default-withhold": "aucune règle de transmission", "visibility-unknown": "visibilité inconnue", "user-withheld": "retenu par vous",
  };
  ```
  `GET /api/v1/dossiers/{id}` → `{ data: { id, producerDossierId, createdAt, revisions:
  [{ id, producerRevision, exportSha256, observedOrigin, receivedAt }], projections: [{
  projectionId, destinationId, state, label, remoteUrl, receiptId, lastFailureCode,
  updatedAt, remote: { status, closed, observedAt } | null }] }, meta: {} }`.
  `GET /api/v1/dossiers?cursor=` (interne) : Dossiers de la personne, 50 par page,
  curseur opaque base64url de `(created_at, id)`.

- [ ] **Test qui échoue :**
  ```ts
  test("the submitter reads N independent projection states, never an aggregate", async () => {
    const { data } = await (await get(`/api/v1/dossiers/${id}`, reporterA)).json();   // seeded: created, failed, to-resolve
    expect(data.projections.map((p: any) => [p.state, p.label])).toEqual([["created", "créé"], ["failed", "échec"], ["to-resolve", "à résoudre"]]);
    expect(data).not.toHaveProperty("state");
  });
  ```
  Plus : un autre `reporter` → `404` (pas `403`) ; un auditeur lit tout Dossier de
  l'organisation ; 120 Dossiers → 3 pages, un curseur forgé de B ne rend que ceux de A ;
  `every ProjectionState and WithholdReason has a label` :
  `Object.keys(PROJECTION_STATE_LABELS).sort()` =
  `["created","dispatching","failed","pending","to-resolve","updated"]` et
  `Object.keys(WITHHOLD_REASON_LABELS)` de longueur 6.
- [ ] **Exécution rouge.** **Implémentation.** **Exécution verte.**
- [ ] **Neutralisation :** retirer le filtre `submitter_ref = principal.principalRef` pour
  `reporter` → le test `404` rougit.
- [ ] **Commit :** `git add apps/control-plane/src/routes/dossiers.ts apps/control-plane/src/routes/dossiers.test.ts apps/control-plane/src/domain/labels.ts`
  puis `git commit -s -m "feat(control-plane): Dossier read API with independent per-destination states"`.

### Task 16: `GET /api/v1/dossiers/{id}/plan` — verdict et plan par destination

**Files:**
- Create: `apps/control-plane/src/domain/plans.ts`, `apps/control-plane/src/routes/plan.ts`,
  `apps/control-plane/src/domain/plans.test.ts`
- Test: `apps/control-plane/src/domain/plans.test.ts`

**Interfaces:**
- Consumes: `evaluate`, `EvaluationInput`, `PolicyVerdict`, `DiscoveredAttributes`
  (§4.2) ; `buildDeliveryPlan(verdict, selection, profileFor)`, `UserSelection`,
  `DeliveryPlan` (§4.4) ; `qualifiedProfileFor` (Task 11) ;
  `attachmentModeOf` (§4.3) ; `activePolicy` (Task 13) ; `connectorContextFor` (Task 12).
- Produces:
  ```ts
  export interface PlanComputation { revisionId: string; policyVersionId: string; verdict: PolicyVerdict; verdictDigest: string; plan: DeliveryPlan; discovery: Record<string, "ok" | "failed">; plannedAttributes: Record<string, RemoteAttributes>; }
  export function computePlan(deps: AppDeps, principal: Principal, dossierId: string, selection: UserSelection | null): Promise<Result<PlanComputation, { code: string }>>;
  ```
  `GET /api/v1/dossiers/{id}/plan` → `{ data: { revisionId, verdict, verdictDigest, plan,
  destinations: [{ destinationId, profileId, routing, discovery }] }, meta: {} }` ;
  `plan = buildDeliveryPlan(verdict, sélection par défaut, qualifiedProfileFor(…))`
  (Task 11 ; même `profileFor` à l'approbation, Task 17) (imposées, aucune
  optionnelle, aucun ajout, aucune retenue supplémentaire). Les destinations
  `selectable` sont dans `verdict.destinations` avec leurs fichiers (registre §4.2),
  présentes seulement si `override = "allowed"`.

- [ ] **Test qui échoue :**
  ```ts
  test("the response never names a denied destination", async () => {
    // policy: rule on the origin, imposed ["dest-ok"], denied ["internal-secops"]
    const text = await (await get(`/api/v1/dossiers/${id}/plan`, reporterA)).text();
    expect(text).not.toContain("internal-secops");
    expect(JSON.parse(text).data.verdict.deniedCount).toBe(1);
  });
  test("a failed visibility discovery withholds every file for that destination", async () => {
    fake.inject({ kind: "visibility-read-failure" });
    const { data } = await (await get(`/api/v1/dossiers/${id}/plan`, reporterA)).json();
    const d = data.verdict.destinations.find((x: any) => x.destinationId === "dest-ok");
    expect(d.files.every((f: any) => f.decision === "withhold" && f.reason === "visibility-unknown")).toBe(true);
    expect(data.destinations.find((x: any) => x.destinationId === "dest-ok").discovery).toBe("failed");
  });
  ```
  Plus : mêmes politique, export, origine et attributs → même `verdictDigest` ; aucune
  politique approuvée → `409 policy.none_approved` ; origine retirée →
  `EvaluationInput.observedOrigin === null` (espion sur `evaluate`) ; seul l'auteur du
  Dossier calcule le plan (`reporter` B → `404`, auditeur → `403`) ; chaque évaluation
  journalisée en `plan.evaluated` (version, digest, règles, `verdictDigest`) ; avec
  `override = "allowed"`, une destination `selectable` apparaît avec ses fichiers.
- [ ] **Exécution rouge.**
- [ ] **Implémentation.** `files` = artefacts `document|screenshot|video` (`path`, `role`,
  `sha256`) ; `discovered` : `connector.discover` par destination de la politique active
  (15 s, en parallèle) ; succès → `{ visibility: discovery.attributes.visibility ??
  visibilité déclarée de la destination, attachmentUpload: attachmentModeOf(profil) ===
  "upload" }` ; échec → `{ visibility: "unknown", attachmentUpload: false }` (échec fermé,
  design §5.5). `verdictDigest` = SHA-256 de `canonicalize(verdict)`.
- [ ] **Exécution verte.**
- [ ] **Neutralisation :** rendre la politique entière au lieu du verdict → le premier test
  rougit.
- [ ] **Commit :** `git add apps/control-plane/src/domain/plans.ts apps/control-plane/src/routes/plan.ts apps/control-plane/src/domain/plans.test.ts`
  puis `git commit -s -m "feat(control-plane): per-destination plan from the active policy with fail-closed discovery"`.
