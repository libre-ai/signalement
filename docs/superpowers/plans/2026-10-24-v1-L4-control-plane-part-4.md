# L4 control plane — partie 4 : phase C, identité et banc de test

Index, Global Constraints et Review Focus : `2026-10-24-v1-L4-control-plane.md`.

Sortie de phase : l'`Authenticator` de test est remplacé en production par la session
OIDC (cookie `__Host-`) et le jeton Biscuit ; la matrice d'autorisation couvre chaque
route × rôle × mode ; le banc `startTestControlPlane` du registre §4.5 est publié pour L6
et L7.

### Task 21: Sessions et OIDC (code + PKCE, `state`, `nonce`, émetteur, audience)

**Files:**
- Create (sous `apps/control-plane/src/`) : `auth/oidc.ts`, `auth/sessions.ts`,
  `auth/role-mapping.ts`, `routes/auth.ts`, `admin/bootstrap.ts`, `auth/oidc.test.ts` ;
  et `apps/control-plane/test/fake-oidc.ts`
- Modify: `package.json:19-26` (dépendance `oauth4webapi`), `bun.lock`
- Test: `apps/control-plane/src/auth/oidc.test.ts`

**Dépendance nouvelle, à vérifier à l'exécution.** `oauth4webapi`, MIT, sans dépendance
transitive. Relevé le 2026-10-24 par `npm view oauth4webapi version license
dependencies` : 3.8.8, MIT, aucune. Avant d'épingler :
- refaire la mesure ;
- épingler la version exacte publiée depuis plus de 3 jours (`minimumReleaseAge =
  259200`) ;
- relever la licence dans la PR.

Pourquoi pas le natif : `fetch` et WebCrypto fournissent SHA-256 et la vérification de
signature, mais pas la validation OIDC (égalité stricte de l'émetteur à la découverte,
réponse d'autorisation avec `iss`, revendications de l'ID token, PKCE) ; la réécrire est
une surface de sécurité que la bibliothèque couvre, certifiée OpenID (à confirmer sur la
page du projet). À vérifier aussi : que la version retenue valide la signature de l'ID
token contre `jwks_uri`. Sinon, l'ajouter par WebCrypto avant de fusionner (test `an id
token with a bad signature is refused`, ligne « signature par une clé étrangère »
ci-dessous).

**Interfaces:**
- Consumes: `AppConfig.oidc`, `seal`/`open` (`purpose: "oidc-login"`), `appendAudit`.
- Produces:
  ```ts
  export const SESSION_COOKIE = "__Host-signalement-session";
  export const LOGIN_COOKIE = "__Host-signalement-login";
  export function startLogin(deps: AppDeps, returnTo: string | null): Promise<{ redirect: string; loginCookie: string }>;
  export function completeLogin(deps: AppDeps, callbackUrl: URL, loginCookie: string | null): Promise<Result<{ sessionCookie: string; returnTo: string }, { code: string }>>;
  export function sessionAuthenticator(deps: AppDeps): Authenticator;
  export function rolesFromClaims(claims: Record<string, unknown>, mappings: readonly { claim: string; value: string; role: Role }[]): Role[];
  // routes: GET /auth/login?returnTo=/path, GET /auth/callback, POST /auth/logout
  // CLI: bun apps/control-plane/src/admin/bootstrap.ts <bootstrap.json>  → organization, role mappings, first receipt and biscuit-root keys
  export interface FakeOidc { issuer: string; autoConsent(claims: Record<string, unknown>): void; stop(): Promise<void>; }   // test/fake-oidc.ts
  export function startFakeOidc(): Promise<FakeOidc>;
  ```

Valeurs fixées :

- **Session.** Valeur = 32 octets aléatoires en base64url, stockée hachée (SHA-256) dans
  `sessions`. Attributs `Path=/; Secure; HttpOnly; SameSite=Lax` : `Lax` parce que le
  retour de l'émetteur est une navigation intersites (la Task 10 garde les méthodes non
  sûres). Durée absolue 12 h, inactivité 30 min.
- **Cookie de connexion.** JSON `{ state, nonce, codeVerifier, returnTo, exp }` scellé
  (`table: "cookie"`, `rowId: "login"`), mêmes attributs, `Max-Age=600`.
- **`returnTo`.** Accepté seulement s'il commence par `/`, et ni par `//` ni par `/\` ;
  sinon `/`.
- **Rôles.** Aucun rôle obtenu → pas de session, page « accès refusé », pas d'audit
  `session.started`.
- **Revendications lues.** `iss`, `sub`, `aud`, `nonce`, `exp`, `iat`, et celles que
  désigne `role_mappings.claim` (chaîne ou tableau de chaînes). Aucune adresse
  électronique n'est lue ni stockée.

- [ ] **Test qui échoue** (`fake-oidc.ts` : émetteur local, clés Ed25519 ou RS256
  générées par WebCrypto, découverte et `jwks_uri`, mode `autoConsent` réutilisé par le
  banc de la Task 24) :
  ```ts
  test("the session cookie is __Host-, Secure, HttpOnly, SameSite=Lax, Path=/ and has no Domain", async () => {
    const header = (await completeFlow()).headers.get("set-cookie")!;
    expect(header).toMatch(/^__Host-signalement-session=[A-Za-z0-9_-]{43}; /);
    for (const attr of ["Path=/", "Secure", "HttpOnly", "SameSite=Lax"]) expect(header).toContain(attr);
    expect(header).not.toMatch(/Domain=/i);
  });
  test("rolesFromClaims reads string and array claims and ignores unknown values", () => {
    const m = [{ claim: "groups", value: "secops", role: "policy-admin" as const }, { claim: "dept", value: "qa", role: "reporter" as const }];
    expect(rolesFromClaims({ groups: ["secops", "x"], dept: "qa" }, m).sort()).toEqual(["policy-admin", "reporter"]);
    expect(rolesFromClaims({ groups: "secops,other" }, m)).toEqual([]);
  });
  ```
  Connexion refusée, sans ligne de session, pour chaque altération :

  | Altération | Code |
  | --- | --- |
  | `state` différent | `oidc.state_mismatch` |
  | `nonce` différent | `oidc.id_token_invalid` |
  | émetteur de découverte différent | `oidc.discovery_invalid` |
  | audience différente | `oidc.id_token_invalid` |
  | ID token expiré | `oidc.id_token_invalid` |
  | signature par une clé étrangère | `oidc.id_token_invalid` |
  | cookie de connexion absent | `oidc.login_missing` |
  | vérificateur PKCE non envoyé | `oidc.token_exchange_failed` |

  Plus :
  - un parcours complet crée une session avec les rôles mappés ;
  - `returnTo` vaut `/` pour `//evil.example.test`, `https://evil.example.test` et
    `/\evil.example.test` ;
  - une personne sans rôle n'obtient pas de session ;
  - l'inactivité (+31 min) et la durée absolue (+12 h) terminent la session ;
  - la déconnexion révoque la session côté serveur.
- [ ] **Exécution rouge.**
- [ ] **Implémentation.** `oauth4webapi` : découverte avec émetteur strict,
  `calculatePKCECodeChallenge`, `validateAuthResponse`, échange de code, validation de
  l'ID token avec `expectedNonce`. Confirmer les noms de fonction contre la version épinglée (context7 ou
  source).
- [ ] **Exécution verte.**
- [ ] **Neutralisation :** ne pas comparer `state` → `state` rougit ; ne pas passer
  `expectedNonce` → `nonce` rougit.
- [ ] **Commit :** `git add apps/control-plane/src/auth/oidc.ts apps/control-plane/src/auth/sessions.ts apps/control-plane/src/auth/role-mapping.ts apps/control-plane/src/routes/auth.ts apps/control-plane/src/admin/bootstrap.ts apps/control-plane/src/auth/oidc.test.ts apps/control-plane/test/fake-oidc.ts package.json bun.lock`
  puis `git commit -s -m "feat(control-plane): OIDC code+PKCE login with __Host- server-side sessions"`.

### Task 22: Jetons Biscuit Ed25519 atténuables pour la CLI

**Files:**
- Create: `apps/control-plane/src/auth/biscuit.ts`, `apps/control-plane/src/routes/tokens.ts`,
  `apps/control-plane/src/auth/biscuit.test.ts`
- Modify: `package.json:19-26` (dépendance `@biscuit-auth/biscuit-wasm`), `bun.lock`
- Test: `apps/control-plane/src/auth/biscuit.test.ts`

**Dépendance nouvelle, à vérifier à l'exécution.** `@biscuit-auth/biscuit-wasm` (dépôt
`eclipse-biscuit/biscuit-wasm`), Apache-2.0, sans dépendance transitive. Relevé le
2026-10-24 par `npm view @biscuit-auth/biscuit-wasm version license dependencies` :
0.6.0, Apache-2.0, aucune.
- Refaire la mesure.
- Première étape : vérifier que le paquet se charge sous le Bun épinglé (sortie
  `wasm-bindgen` : cible web ou node). S'il ne se
  charge pas, **arrêter la tâche** et remonter la question au propriétaire (alternative :
  Biscuit dans la crate L2, changement de registre).
- Pourquoi pas le natif : Biscuit exige un moteur Datalog et des blocs signés ; ni Bun ni
  WebCrypto ne les fournissent. Le skill `biscuit-auth` de `project-governance` prescrit
  ce binding pour TypeScript.

**Interfaces:**
- Consumes: `loadActiveSecret(…, "biscuit-root", …)` (Task 7), `Principal`, `Role`.
- Produces:
  ```ts
  export const TOKEN_TTL_DEFAULT_SECONDS = 86400;
  export const TOKEN_TTL_MAX_SECONDS = 2592000;
  export type TokenOperation = "upload" | "read-dossier" | "read-receipt" | "read-keys" | "read-profiles";
  export function issueToken(deps: AppDeps, principal: Principal, request: { roles: Role[]; ttlSeconds: number }): Promise<Result<{ token: string; tokenId: string; expiresAt: string }, { code: string }>>;
  export function biscuitAuthenticator(deps: AppDeps, operationOf: (request: Request) => TokenOperation | null): Authenticator;
  export function revokeToken(deps: AppDeps, principal: Principal, tokenId: string): Promise<Result<void, { code: string }>>;
  // routes: POST /api/v1/tokens (registry §4.5, web session only), GET /api/v1/tokens, POST /api/v1/tokens/{id}/revoke (internal)
  ```

Modèle Datalog, en `snake_case`, sans donnée personnelle :

- **Bloc d'autorité.** `organization("<uuid>"); principal("<principal_ref>");
  role("<role>")…; check if time($t), $t < <expiresAt>;`.
- **Authorizer.** Faits `time(<now>)`, `expected_organization("<organizationId>")`,
  `operation("<op>")`. Politiques `allow if organization($o), expected_organization($o);
  deny if true;` (le `deny if true` final est obligatoire).
- **Atténuation.** Un bloc ajouté par la CLI ne peut que restreindre (`check if
  operation(...)`, `time` plus court).
- **Émission.** Rôles du jeton ⊆ rôles de la session émettrice ; émission par session web
  seulement.
- **Révocation.** Identifiants de révocation stockés à l'émission ; jeton refusé si l'un
  d'eux figure dans `revoked_tokens`, contrôle fait avant l'authorizer ; cache mémoire
  de 30 s.

- [ ] **Test qui échoue :**
  ```ts
  test("an attenuated token restricted to read-receipt cannot upload", async () => {
    const attenuated = attenuate(token, `check if operation("read-receipt");`);
    expect((await bearer("POST", "/api/v1/deliveries/uploads", attenuated)).status).toBe(401);
    expect((await bearer("GET", `/api/v1/receipts/${receiptId}`, attenuated)).status).toBe(200);
  });
  test("a token without an organization fact is refused", async () => {
    expect((await bearer("GET", "/api/v1/signing-keys", mintRaw(`principal("p"); role("reporter");`))).status).toBe(401);
  });
  ```
  Plus :
  - un jeton émis authentifie la CLI avec ses rôles ;
  - un rôle absent de la session → `token.role_escalation` ;
  - TTL > `2592000` → `token.ttl` ;
  - jeton expiré, jeton d'une autre organisation, jeton signé par une racine étrangère →
    `401 auth.token_invalid` ;
  - un jeton révoqué est refusé, au plus tard à l'expiration du cache ;
  - `POST /api/v1/tokens` avec un Bearer → `403 token.session_required` ;
  - le jeton n'apparaît ni en journal ni en audit.
- [ ] **Exécution rouge.** **Implémentation.** **Exécution verte.**
- [ ] **Neutralisation :** retirer `deny if true` → le test sans organisation rougit.
- [ ] **Commit :** `git add apps/control-plane/src/auth/biscuit.ts apps/control-plane/src/routes/tokens.ts apps/control-plane/src/auth/biscuit.test.ts package.json bun.lock`
  puis `git commit -s -m "feat(control-plane): attenuable Ed25519 Biscuit tokens for API clients"`.

### Task 23: Câblage de l'authentification et matrice d'autorisation exhaustive

**Files:**
- Create: `apps/control-plane/src/http/authz.ts`, `apps/control-plane/test/authz-matrix.test.ts`
- Modify: `apps/control-plane/src/main.ts`, `apps/control-plane/src/http/server.ts`
- Test: `apps/control-plane/test/authz-matrix.test.ts`

**Interfaces:**
- Consumes: `sessionAuthenticator`, `biscuitAuthenticator`.
- Produces:
  ```ts
  export interface RouteRule { method: string; path: string; roles: readonly Role[] | "any-member" | "public"; auth: readonly ("session" | "biscuit")[]; operation: TokenOperation | null; }
  export const ROUTE_RULES: readonly RouteRule[];
  export function composeAuthenticators(bearer: Authenticator, session: Authenticator): Authenticator;   // an Authorization header present → bearer only
  ```

Règles :

| Route | Rôles | Modes | Opération |
| --- | --- | --- | --- |
| `POST /api/v1/deliveries/uploads` | `reporter` | session, biscuit | `upload` |
| `GET /api/v1/dossiers/:id` | `reporter` (le sien), `auditor` | session, biscuit | `read-dossier` |
| `GET …/plan`, `POST …/approvals` | `reporter` (le sien) | session | — |
| `GET /api/v1/receipts/:id` | `reporter` (le sien), `auditor` | session, biscuit | `read-receipt` |
| `GET /api/v1/signing-keys` | tout membre | session, biscuit | `read-keys` |
| `GET /api/v1/profiles` | tout membre | session, biscuit | `read-profiles` |
| `POST /api/v1/tokens`, `GET /api/v1/tokens`, `POST /api/v1/tokens/:id/revoke` | tout membre | session | — |
| `GET /artifacts/:id` | tout membre | session | — |
| `/api/v1/admin/**` | `policy-admin` ; lecture de l'audit et des politiques aussi `auditor` | session | — |
| `/auth/**`, `/healthz` | public | — | — |

- [ ] **Test qui échoue :**
  ```ts
  test("every served route has exactly one rule", () => {
    const served = listServedRoutes(createServer(testDeps(), { port: 0, hostname: "127.0.0.1" }));
    expect(served.sort()).toEqual(ROUTE_RULES.map((r) => `${r.method} ${r.path}`).sort());
    console.log(`authz matrix: ${ROUTE_RULES.length} routes`);
  });
  test("every registry §4.5 route is present", () => {
    for (const r of ["POST /api/v1/deliveries/uploads", "GET /api/v1/dossiers/:id", "GET /api/v1/dossiers/:id/plan", "POST /api/v1/dossiers/:id/approvals",
                     "GET /api/v1/receipts/:id", "GET /api/v1/signing-keys", "GET /api/v1/profiles", "POST /api/v1/tokens", "GET /artifacts/:id"])
      expect(ROUTE_RULES.map((x) => `${x.method} ${x.path}`)).toContain(r);
  });
  ```
  Plus :
  - pour chaque règle × rôle × mode (`callAs(rule, role, auth)`) : refusé → statut dans
    `[401, 403]` ; autorisé → `status < 400` ou `404`, `409`, `422` (refus métier, pas
    d'autorisation) ;
  - Bearer invalide et cookie valide → `401` ;
  - `POST` intersites avec cookie valide → `403 csrf.refused`.
- [ ] **Exécution rouge.** **Implémentation.** **Exécution verte.**
- [ ] **Neutralisation :** ajouter `biscuit` aux modes de `POST …/approvals` → ses cas
  biscuit rougissent.
- [ ] **Commit :** `git add apps/control-plane/src/http/authz.ts apps/control-plane/test/authz-matrix.test.ts apps/control-plane/src/main.ts apps/control-plane/src/http/server.ts`
  puis `git commit -s -m "feat(control-plane): exhaustive route authorization matrix over session and Biscuit"`.

### Task 24: Banc de test `startTestControlPlane` (registre §4.5, consommé par L6 et L7)

**Files:**
- Create: `apps/control-plane/testing/harness.ts`, `apps/control-plane/testing/harness.test.ts`
- Test: `apps/control-plane/testing/harness.test.ts`

**Interfaces:**
- Consumes: `createTestDatabase` (Task 1), `migrate`/`applyGrants`, `createServer`,
  `issueToken` (Task 22), `computePlan`/`approve` (Tasks 16-17), `dispatchOnce` (Task 18),
  `startFakeOidc` (Task 21) ; `createFakeProvider({ dialect, search: "strong", baseUrl })`,
  `referenceDialect`, `FAKE_BASE_URL`, `createReferenceConnector`, `referenceProfile` (L3) ;
  `connectorFor`, `fakeDialectFor` (L5).
- Produces (registre §4.5, à l'identique) :
  ```ts
  export interface TestControlPlane {
    url: string;
    issueToken(role: "reporter" | "policy-admin" | "auditor"): Promise<string>;
    approveAll(dossierId: string): Promise<void>;
    drainOutbox(): Promise<void>;
    fakeProvider: FakeProvider;
    stop(): Promise<void>;
  }
  export function startTestControlPlane(options?: { profiles?: string[] }): Promise<TestControlPlane>;
  ```

Comportement :

- **Base et matrice.** Base de test neuve et migrée. Matrice de test qualifiant
  `options.profiles`, par défaut `[TEST_PROFILE]`.
- **Organisation.** Une organisation, des clés `receipt` et `biscuit-root`, et une
  politique approuvée. Cette politique impose une destination par profil, privée, toutes
  classes en `transmit`, médias en `link`.
- **Connecteurs.** `TEST_PROFILE` → connecteur de référence sur `referenceDialect`.
  Identifiant du registre → `connectorFor(id)` et `fakeDialectFor(id)`
  (`connectors/conformance/dialects/index.ts`, L5). Si l'un des deux rend `null`, ou si
  L5 est absent → `harness.profile_unavailable`. Profils de dialectes différents dans
  `profiles` → `harness.mixed_dialects` (un seul `FakeProvider` par banc).
- **Transport.** Un seul `FakeProvider` sert de `httpFor` à toutes les destinations.
- **Effets externes.** Désactivés : seul `drainOutbox` fait partir les livraisons.
- **Identité.** Émetteur `fake-oidc` en `autoConsent` pour le sujet `harness-reporter`,
  rôle `reporter`. Un navigateur qui ouvre `${url}/receive` est donc connecté sans saisie
  (usage L6). `issueToken(role)` émet un Biscuit pour le sujet `harness-<role>` ;
  `issueToken("reporter")` correspond au même sujet que la session web.
- **`approveAll(dossierId)`.** Calcule le plan en tant qu'auteur du Dossier, puis approuve
  toutes les destinations du plan, avec la sélection par défaut et les ensembles exacts.
- **`drainOutbox()`.** Enchaîne `dispatchOnce` en avançant l'horloge du banc jusqu'aux
  échéances de reprise, jusqu'à ce qu'aucune ligne ne soit `pending` ou `leased` ; borné
  à 100 passes, sinon `harness.drain_incomplete`.
- **`stop()`.** Arrête serveur, émetteur et base, dans un `finally`, y compris si un test
  échoue.

- [ ] **Test qui échoue :**
  ```ts
  test("an uploaded export is approved, drained and receipted end to end", async () => {
    const cp = await startTestControlPlane();
    try {
      const token = await cp.issueToken("reporter");
      const { bytes, envelope } = await exportFixtureWithEnvelope();
      const res = await fetch(`${cp.url}/api/v1/deliveries/uploads`, { method: "POST", body: bytes, headers: uploadHeaders(token, envelope) });
      const { data } = await res.json();
      await cp.approveAll(data.dossierId);
      await cp.drainOutbox();
      const dossier = await (await fetch(`${cp.url}/api/v1/dossiers/${data.dossierId}`, { headers: bearerHeaders(token) })).json();
      expect(dossier.data.projections.map((p: any) => p.state)).toEqual(["created"]);
      expect(dossier.data.projections[0].receiptId).toEqual(expect.any(String));
      expect(cp.fakeProvider.store.items.length).toBe(1);
    } finally { await cp.stop(); }
  });
  ```
  `uploadHeaders` et `bearerHeaders` construisent l'en-tête d'autorisation par
  concaténation (gate de frontière publique). Plus :
  - `stop()` libère la base (elle n'existe plus après) ;
  - deux bancs simultanés sont disjoints ;
  - un identifiant du registre pour lequel `fakeDialectFor` rend `null` (ou L5 absent) →
    `harness.profile_unavailable` ;
  - `GET ${url}/api/v1/profiles` liste exactement `options.profiles`.
- [ ] **Exécution rouge.** **Implémentation.** **Exécution verte.**
- [ ] **Neutralisation :** `drainOutbox` rendu sans appeler `dispatchOnce` → le premier test
  rougit (état `pending`).
- [ ] **Fin de phase C :** `bun run check` vert ; `authz matrix: <n> routes` consigné.
- [ ] **Commit :** `git add apps/control-plane/testing/harness.ts apps/control-plane/testing/harness.test.ts`
  puis `git commit -s -m "test(control-plane): publish startTestControlPlane harness for L6 and L7"`.
