# L4 control plane — partie 3 : phase B (2/2), approbation et dispatcher

Index, Global Constraints et Review Focus : `2026-10-24-v1-L4-control-plane.md`.
Début de la phase B : partie 2.

### Task 17: `POST /api/v1/dossiers/{id}/approvals` — approbation liée au plan exact, outbox

**Files:**
- Create: `apps/control-plane/src/domain/approvals.ts`, `apps/control-plane/src/routes/approvals.ts`,
  `apps/control-plane/src/domain/approvals.test.ts`
- Test: `apps/control-plane/src/domain/approvals.test.ts`

**Interfaces:**
- Consumes: `computePlan` (Task 16), `projectionId`, `idempotencyKey`,
  `buildDeliveryPlan` (§4.4), `RENDERER_VERSIONS` (plan L3), `appendAudit`.
- Produces :
  ```
  POST /api/v1/dossiers/{id}/approvals
  body: { revisionId: string; verdictDigest: string; selection: UserSelection;
          approvals: { destinationId: string; transmitted: string[] /* sha256 */; withheld: string[] /* paths */ }[] }
  201 { data: { approvalId, deliveries: [{ deliveryId, projectionId, destinationId, state: "pending" }] }, meta: { created: <n> } }
  200 same shape, meta.created = 0        // same export already approved for these projections
  409 plan.stale | plan.mismatch ; 422 selection.escalation | approval.empty | approval.renderer_missing
  ```
  ```ts
  export interface ApprovalBody { revisionId: string; verdictDigest: string; selection: UserSelection; approvals: { destinationId: string; transmitted: string[]; withheld: string[] }[] }
  export interface ApprovedDelivery { deliveryId: string; projectionId: string; destinationId: string; state: "pending" }
  export function approve(deps: AppDeps, principal: Principal, dossierId: string, body: ApprovalBody): Promise<Result<{ approvalId: string; deliveries: ApprovedDelivery[]; created: number }, { code: string }>>;
  ```

Règles :
- la personne qui approuve est celle qui a remis le Dossier ;
- le serveur recalcule verdict (découverte fraîche) et plan avec `selection`.
  `verdictDigest` différent → `plan.stale` ;
- pour chaque destination approuvée, `transmitted` égale exactement les SHA-256 des
  fichiers `transmit` du plan recalculé, et `withheld` exactement ses chemins
  `withhold`. Sinon → `plan.mismatch` ;
- même code `selection.escalation`, et même message, pour : une destination hors du plan,
  une sélection refusée par `buildDeliveryPlan`, un identifiant inconnu, refusé ou hors
  `selectable` ;
- une seule transaction contient :
  - la ligne `approvals` ;
  - par destination, une projection (`projectionId(organization, dossierId,
    destinationId)`), créée en `pending` si elle manque ;
  - une livraison insérée par `on conflict (organization, idempotency_key) do nothing`,
    avec : `idempotencyKey(projectionId, exportSha256, mappingVersion)`,
    `mappingVersion = RENDERER_VERSIONS[profileId]` (absent → `approval.renderer_missing`,
    jamais de défaut), `kind = "comment"` si la projection a un `remote_id`, sinon
    `"create"`, `planned_attributes` = attributs lus au recalcul ;
  - sa ligne `outbox` (`pending`, `available_at = now()`) ;
  - l'audit `delivery.approved`.
- une livraison en `to-resolve` sous la même clé est **réarmée** : nouveau plan, nouvelle
  approbation, `pending`, nouvelle ligne d'outbox, `ambiguous` et `sent_body_digests`
  conservés. C'est la « nouvelle approbation » du design §5.5.

- [ ] **Test qui échoue :**
  ```ts
  test("a denied destination id in a selection is indistinguishable from an unknown id", async () => {
    const denied = await approveRaw({ ...body, selection: withAddition("internal-secops") });
    const unknown = await approveRaw({ ...body, selection: withAddition("no-such-destination") });
    expect([denied.status, await denied.text()]).toEqual([unknown.status, await unknown.text()]);
    expect(denied.status).toBe(422);
  });
  test("a transmitted set larger than the plan is refused", async () => {
    const r = await approveRaw(withTransmitted(body, "dest-ok", [...planned, heldSha]));
    expect(r.status).toBe(409); expect((await r.json()).error.code).toBe("plan.mismatch");
  });
  ```
  Plus : une approbation crée N livraisons et N lignes d'outbox ; une panne après la
  première insertion (`appendAudit` qui lève) ne laisse ni livraison ni outbox ; même
  export approuvé deux fois → `created: 0`, comptes inchangés ; visibilité basculée entre
  `GET …/plan` et `POST` → `409 plan.stale` ; seul l'auteur du Dossier approuve (autre
  `reporter` et `policy-admin` non auteur → `404`) ; `re-approving a to-resolve delivery
  re-arms it under the same idempotency key` (état `pending`, `attempts` et `ambiguous`
  inchangés) ; le plan est recalculé avec le même `profileFor` que la Task 16 ; une destination ajoutée par override (`selectable`) produit sa
  livraison avec son propre plan ; une projection déjà `created` n'empêche pas une autre.
- [ ] **Exécution rouge.** **Implémentation.** **Exécution verte.**
- [ ] **Neutralisation :** égalité d'ensembles `transmitted` remplacée par une inclusion →
  le second test rougit.
- [ ] **Commit :** `git add apps/control-plane/src/domain/approvals.ts apps/control-plane/src/routes/approvals.ts apps/control-plane/src/domain/approvals.test.ts`
  puis `git commit -s -m "feat(control-plane): plan-bound per-destination approval with transactional outbox"`.

### Task 18: Dispatcher en processus, reçus signés, `stale-plan-refused`

**Files:**
- Create: `apps/control-plane/src/dispatcher/dispatcher.ts`, `apps/control-plane/src/dispatcher/backoff.ts`,
  `apps/control-plane/src/dispatcher/recording-port.ts`, `apps/control-plane/src/domain/receipts.ts`,
  `apps/control-plane/src/dispatcher/dispatcher.test.ts`, `apps/control-plane/test/dispatch-fixture.ts`,
  `apps/control-plane/test/stale-plan-refused.test.ts`
- Test: `apps/control-plane/src/dispatcher/dispatcher.test.ts`, `apps/control-plane/test/stale-plan-refused.test.ts`

**Interfaces:**
- Consumes: `executeDelivery`, `DeliveryJob`, `DeliveryDeps`, `DeliveryOutcome`,
  `DeliverySuccess`, `transition`, `buildUnsignedReceipt` (§4.4) ;
  `signReceipt(unsigned, secretKey)` (§4.2) ; `instrumentHttpPort` (§4.3) ;
  `loadActiveSecret`, `exportPublicKeys` (Task 7) ; `connectorContextFor` (Task 12) ;
  faux fournisseur et connecteur de référence (L3).
- Produces:
  ```ts
  export interface DispatcherOptions { organization: string; batchSize: number; leaseMs: number; maxAttempts: number; pollMs: number; }
  export const DISPATCHER_DEFAULTS: Omit<DispatcherOptions, "organization">;   // batchSize 10, leaseMs 120000, maxAttempts 8, pollMs 2000
  export function dispatchOnce(deps: AppDeps, options: DispatcherOptions): Promise<{ claimed: number; succeeded: number; toResolve: number; retried: number; failed: number }>;
  export function startDispatcher(deps: AppDeps, options: DispatcherOptions): { stop(): Promise<void> };
  export function backoffMs(attempt: number, retryAfterMs: number | null): number;   // max(retryAfterMs ?? 0, min(5000 * 2 ** (attempt - 1), 3600000))
  export function recordingHttpPort(inner: HttpPort, record: (sha256: string) => Promise<void>): HttpPort;   // persists each body digest before the inner send
  ```

Algorithme d'une passe :

1. **Réclamation**, dans une transaction `withOrganization` :
   - lire `position` dans `outbox_cursors` (consommateur `dispatcher`, 0 par défaut) ;
   - sélectionner `seq > position and ((state = 'pending' and available_at <= now()) or
     (state = 'leased' and lease_until < now())) order by seq limit batchSize for update
     skip locked` ;
   - par ligne, verrouiller la version de politique en `for share` et lire son état
     (`currentPolicy`). Si elle n'est pas `approved` : livraison `to-resolve` (code
     `policy.retired`), outbox `done`, audit, sans appeler `executeDelivery`. C'est une
     défense en profondeur : `revalidatePlan` le refuserait aussi ;
   - sinon : outbox `leased`, `lease_until = now() + leaseMs`, `attempts + 1`, livraison
     `dispatching`, `first_attempt_at` posé s'il est nul ;
   - **`ambiguous = true` si la ligne était `leased` avec un bail expiré**.
   - Commit.
2. **Exécution**, hors transaction :
   - port de la tentative : `instrumentHttpPort(recordingHttpPort(ctx.http, record))`.
     `record` ajoute le digest à `deliveries.sent_body_digests` dans une transaction
     courte, avant l'envoi réseau ;
   - `DeliveryJob` : champs pris dans la livraison (`idempotencyKey`, `mappingVersion`,
     `kind`, `plan` figé, `plannedAttributes`), la révision (`exportDigest` =
     `export_sha256`, `revision` = `producer_revision`), la projection (`remote` =
     `remote_id`/`remote_url` quand `kind = "comment"`, sinon `null`) et la destination
     (`target`). Valeurs particulières :
     - `previousAttemptAmbiguous` = `ambiguous` ;
     - `priorSentBodyDigests` = `sent_body_digests` lus à la réclamation ;
     - `currentPolicy` = valeur lue à l'étape 1 ;
     - `mediaLinks` : pour chaque fichier livré en `link`, chemin →
       `<publicOrigin>/artifacts/<artifactId>` (Task 19) ;
     - `approvalRef` = identifiant de l'approbation ;
     - `firstAttemptAt` = `first_attempt_at` (ISO 8601), d'où L3 tire le `notBefore` du
       `ProjectionMarker` (§4.3) ;
   - `deps = { connector, ctx: { ...ctx, http: portDeLaTentative }, readFile, rediscover }`.
     `readFile` lit l'artefact déchiffré, `manifest.json` compris ;
   - une exception (hors contrat L3) devient `{ kind: "retry", failure: { kind:
     "transport", retryable: true, retryAfterMs: null, code: "dispatch.internal" } }`.
3. **Enregistrement**, dans une transaction :
   - `success` :
     - état par `transition` (`created` ou `updated`), `remote_id`/`remote_url`,
       livraison terminale ;
     - reçu : `unsigned = buildUnsignedReceipt(job, outcome.value, { keyId, issuedAt })`,
       `signed = api.signReceipt(unsigned, secretSeed)`, `canonicalize(signed)` stocké
       dans `receipts` ;
     - si la signature échoue : `receipt_pending = true`, outbox `pending` repoussée.
       L'identifiant distant est déjà écrit ; une passe suivante signe sans rappeler le
       connecteur ;
   - `to-resolve` → `to-resolve`, outbox `done` ;
   - `retry` → si `attempts < maxAttempts`, outbox `pending` à `now() +
     backoffMs(attempts, failure.retryAfterMs)` ; sinon `failed`, code
     `dispatch.attempts_exhausted` ;
   - `failed` → `failed` ;
   - toute issue autre que `success` : `ambiguous = ambiguous OR (digests envoyés
     pendant la tentative ≠ ∅)`. C'est la définition L3 de `previousAttemptAmbiguous` ;
   - chaque issue est journalisée.
4. **Curseur** : avancer `position` jusqu'au plus grand `seq` en dessous duquel toutes les
   lignes sont `done` ou `dead`.

- [ ] **Test qui échoue** (`test/stale-plan-refused.test.ts`, critère du design §7) :
  ```ts
  // dispatch-fixture.ts: fake = createFakeProvider({ dialect: referenceDialect, search: "strong", baseUrl: FAKE_BASE_URL });
  //   connector = createReferenceConnector({ profile: referenceProfile(TEST_PROFILE, { attachments: "upload", lookup: "strong" }) });
  //   fake.store.visibility.set(DEST_KEY, "private"); approvedDelivery() runs Tasks 14, 16, 17 end to end.
  const writes = (f: FakeProvider) => f.requests.filter((q) => q.method !== "GET");
  test("stale-plan-refused: a discovered attribute changed after approval yields to-resolve and no send", async () => {
    const { deliveryId } = await approvedDelivery(fake, connector);
    fake.store.visibility.set(DEST_KEY, "public");
    expect(await dispatchOnce(depsWith(fake, connector), opts)).toMatchObject({ toResolve: 1, succeeded: 0 });
    expect(await deliveryState(deliveryId)).toBe("to-resolve");
    expect(writes(fake)).toEqual([]);
  });
  ```
  Même forme pour : `a policy retired after approval yields to-resolve and no send`
  (`retirePolicy` avant la passe) ; `a failed rediscovery counts as public and yields
  to-resolve` (`fake.inject({ kind: "visibility-read-failure" })`).
- [ ] **Test qui échoue** (`dispatcher.test.ts`) :
  ```ts
  test("a cut after send and before response creates exactly one remote item", async () => {
    fake.inject({ kind: "drop-after-send", match: { method: "POST", path: /\/items$/, occurrence: 1 } });
    await dispatchOnce(depsWith(fake, connector), opts); await advanceClock(backoffMs(1, null));
    await dispatchOnce(depsWith(fake, connector), opts);
    expect(fake.store.items.length).toBe(1);
    expect(await deliveryState(deliveryId)).toBe("created");
  });
  test("a crash after send loses no sent body digest", async () => {
    await crashAfterSend(depsWith(fake, connector)); await advanceClock(DISPATCHER_DEFAULTS.leaseMs + 1);
    const [row] = await db.owner`select ambiguous, cardinality(sent_body_digests)::int as n from signalement.deliveries`;
    expect(row).toEqual({ ambiguous: true, n: 1 });
    await dispatchOnce(depsWith(fake, connector), opts);
    expect(fake.store.items.length).toBe(1);
    expect(receiptOf(deliveryId).requestBodyDigests).toContain(sha256hex(fake.requests[0]!.body));
  });
  test("a signing failure keeps the remote id and retries signing without a second create", async () => {
    await dispatchOnce(depsWith(fake, connector, { ...api, signReceipt: () => { throw new Error("hsm down"); } }), opts);
    expect(await remoteIdOf(deliveryId)).not.toBeNull();
    await advanceClock(backoffMs(1, null)); await dispatchOnce(depsWith(fake, connector, api), opts);
    expect(fake.store.items.length).toBe(1); expect(await count("receipts")).toBe(1);
  });
  test("a withheld file never appears in any outbound request", async () => {
    const fixture = await buildExportFixture();
    const held = [...fixture.files.keys()].find((p) => p.includes("held-shot-b2"))!;
    await dispatchOnce(depsWith(fake, connector), opts);
    expect(findLeaks(fake.requests, fileNeedles(held, fixture.files.get(held)!, sha256hex(fixture.files.get(held)!)))).toEqual([]);
  });
  ```
  Plus :
  - un reçu stocké se vérifie (`signature: "valid"`) avec `exportPublicKeys` ;
  - lecture non cohérente (`search: "unavailable"`, `lookup: "unavailable"`) après une
    tentative ambiguë → `to-resolve` et un seul `POST …/items` ;
  - deux dispatchers en parallèle sur 20 livraisons → 20 items distincts ;
  - huit échecs de transport → `failed` et sept audits `delivery.retry_scheduled` ;
  - `backoffMs(1, null) = 5000`, `backoffMs(3, null) = 20000`, `backoffMs(20, null) =
    3600000`, `backoffMs(1, 90000) = 90000` ;
  - `retirement during an in-flight delivery never sends a later claim` : deux
    livraisons sous v1, la première retardée par le faux, retrait de v1 pendant le vol.
    La première réussit avec un reçu qui nomme v1 ; la seconde est `to-resolve` et
    n'est jamais envoyée ;
  - une révision d'une projection déjà créée produit un commentaire, pas un item ;
  - l'échec définitif d'une destination ne change pas l'état d'une autre ;
  - le curseur reprend après redémarrage, et une seconde passe réclame 0 ligne ;
  - le dispatcher ne démarre pas quand les effets externes sont désactivés.

  `crashAfterSend` simule la mort du processus entre l'envoi interne et la transaction
  d'enregistrement (exception levée après `fetch`). `advanceClock` pilote `deps.now` et
  l'horloge SQL de test : soit `now()` remplacé par une fonction `signalement.clock()` en
  test seulement, soit un décalage explicite de `available_at`/`lease_until`.
  L'exécutant choisit et documente son choix dans `test/dispatch-fixture.ts`. Les appels
  au faux (`createFakeProvider(options)`) suivent l'API L3 fusionnée.
- [ ] **Exécution rouge.** **Implémentation.** **Exécution verte.**
- [ ] **Neutralisation (quatre, consignées dans le commit) :**
  1. retirer le contrôle `approved` à la réclamation et forcer `currentPolicy.state =
     "approved"` dans le job → le test de retrait rougit ;
  2. ne jamais mettre à jour `ambiguous` → le test de coupure rougit (deux items) ;
  3. `record` no-op → `a crash after send loses no sent body digest` rougit ;
  4. retirer `skip locked` → le test à deux dispatchers rougit, ou dépasse son échéance.
- [ ] **Commit :** `git add apps/control-plane/src/dispatcher apps/control-plane/src/domain/receipts.ts apps/control-plane/test/dispatch-fixture.ts apps/control-plane/test/stale-plan-refused.test.ts`
  puis `git commit -s -m "feat(control-plane): idempotent outbox dispatcher with signed receipts and stale-plan refusal"`.

### Task 19: reçus, clés publiques, rotation, `GET /artifacts/{artifactId}`

**Files:**
- Create: `apps/control-plane/src/routes/receipts.ts`, `apps/control-plane/src/routes/signing-keys.ts`,
  `apps/control-plane/src/routes/artifacts.ts`, `apps/control-plane/src/routes/receipts.test.ts`
- Test: `apps/control-plane/src/routes/receipts.test.ts`

**Interfaces:**
- Consumes: `exportPublicKeys`, `rotateSigningKey` (Task 7).
- Produces (registre §4.5) :
  - `GET /api/v1/receipts/{id}` → `200`, `Content-Type: application/json`, corps = octets
    JCS stockés, sans enveloppe ; lecture par l'auteur du Dossier ou un auditeur ;
  - `GET /api/v1/signing-keys` → `{ data: PublicKeySet, meta: { activeKeyId } }`, usage
    `receipt` seulement (jamais la clé racine Biscuit) ;
  - `GET /artifacts/{artifactId}` → artefact déchiffré, session web d'un membre de
    l'organisation, `Content-Disposition: attachment`, `Content-Type` du manifeste,
    `Cache-Control: no-store` ; cible des `mediaLinks` (remise `link`, design §5.3), URL
    transmise à `renderBody` par `RenderInput` (L3) ;
  - interne : `POST /api/v1/admin/signing-keys/rotate` (`policy-admin`) → `{ data: {
    activeKeyId, retiredKeyId } }`.

- [ ] **Test qui échoue :**
  ```ts
  test("signing-keys exports active and retired receipt keys and never the biscuit root", async () => {
    await rotate("receipt"); await rotate("receipt"); await rotate("biscuit-root");
    const { data, meta } = await (await get("/api/v1/signing-keys", reporterA)).json();
    expect(data.keys).toHaveLength(2); expect(data.keys.map((k: any) => k.keyId)).toContain(meta.activeKeyId);
    expect(data.keys.map((k: any) => k.keyId)).not.toContain(biscuitRootKeyId);
    expect(rawSigningKeySetFailures(api.canonicalize(data))).toEqual([]);
  });
  ```
  Plus : le reçu servi égale octet pour octet les octets stockés ; reçu invisible pour un
  autre `reporter` (`404`) ; un reçu signé avant rotation vérifie encore avec le jeu
  exporté (`keyStatus: "retired"`) ; `/artifacts/{id}` sans session → `401`, avec jeton
  Biscuit → `401`, avec session → `200` et octets égaux.
- [ ] **Exécution rouge.** **Implémentation.** **Exécution verte.**
- [ ] **Neutralisation :** inclure `purpose = 'biscuit-root'` dans `exportPublicKeys` → le
  test rougit.
- [ ] **Commit :** `git add apps/control-plane/src/routes/receipts.ts apps/control-plane/src/routes/signing-keys.ts apps/control-plane/src/routes/artifacts.ts apps/control-plane/src/routes/receipts.test.ts`
  puis `git commit -s -m "feat(control-plane): receipt bytes, public signing keys, rotation and authenticated media links"`.

### Task 20: Lecture de l'état distant par curseur

**Files:**
- Create: `apps/control-plane/src/dispatcher/remote-state.ts`, `apps/control-plane/src/dispatcher/remote-state.test.ts`
- Test: `apps/control-plane/src/dispatcher/remote-state.test.ts`

**Interfaces:**
- Consumes: `Connector.readChanges`.
- Produces:
  ```ts
  export function pollRemoteStateOnce(deps: AppDeps, organization: string): Promise<{ inspected: number; updated: number; failed: number }>;
  export function startRemoteStatePoller(deps: AppDeps, organization: string, intervalMs: number): { stop(): Promise<void> };   // 60000
  ```

- [ ] **Test qui échoue :**
  ```ts
  test("reading remote state never writes a Dossier, revision or artifact row", async () => {
    const before = await snapshotTables(["dossiers", "dossier_revisions", "artifacts"]);
    await pollRemoteStateOnce(depsWith(fakeWithHostileTitle), ORG_A);
    expect(await snapshotTables(["dossiers", "dossier_revisions", "artifacts"])).toEqual(before);
  });
  ```
  Plus : statut, lien et fermeture stockés par projection avec le nouveau curseur ; une
  lecture en échec garde le curseur et l'état ; la passe imprime `remote_state.poll` avec
  `inspected`, `updated`, `failed`.
- [ ] **Exécution rouge.** **Implémentation** (projections `created`/`updated` seules ;
  stocké : statut normalisé, booléen de fermeture, URL `https:` validée). **Exécution verte.**
- [ ] **Neutralisation :** écrire le titre distant dans `dossiers.producer_dossier_id` → le
  test rougit.
- [ ] **Fin de phase B :** `bun run check` vert, puis
  `bun tools/ci/with-postgres.ts -- bun test apps/control-plane/test/cross-organization-disclosure.test.ts apps/control-plane/test/stale-plan-refused.test.ts`
  ; compteurs imprimés consignés dans le commit.
- [ ] **Commit :** `git add apps/control-plane/src/dispatcher/remote-state.ts apps/control-plane/src/dispatcher/remote-state.test.ts`
  puis `git commit -s -m "feat(control-plane): cursor-based remote state reading, display-only"`.
