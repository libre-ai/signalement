# Signalement v1.0 L1 — partie 1 : autorité, tâches 1 à 5

Index, Global Constraints (dont la PAC), décisions DL1-DL12 et Review Focus :
`2026-10-24-v1-L1-contracts.md`. Dépôt `libre-ai/schemas-and-contracts`, branche
`work/signalement-v1-contracts`, dans l'espace de travail décrit à l'index.

## Phase A — autorité (1/2)

### Task 1: ADR, dossier de revue et inventaire des fixtures

**Files:**
- Create: `docs/adr/<date -u +%F>-signalement-v1-contracts.md`, `docs/reviews/signalement-v1-contracts-review.md`
- Create: `tools/quality/signalement-v1-fixture-inventory.ts`, `tools/quality/signalement-v1-fixture-inventory.test.ts`
- Modify: `tools/quality/check-contracts.ts` (après le bloc P02, `check-contracts.ts:638-641`), `package.json` (`check:signalement-v1-inventory` dans `check:contracts`)

**Interfaces:**
- Consumes: forme `P02FixtureCase` de `tools/quality/p02-v1-fixture-inventory.ts`
- Produces:
  ```ts
  export const SIGNALEMENT_V1_FIXTURE_DIRECTORIES: readonly string[];
  export interface SignalementFixtureInventory { cases: P02FixtureCase[]; failures: string[] }
  export async function loadSignalementV1FixtureCases(
    root?: string,                      // default "contracts/fixtures"
    directories?: readonly string[],    // default SIGNALEMENT_V1_FIXTURE_DIRECTORIES
  ): Promise<SignalementFixtureInventory>;
  ```

- [ ] **Q2 au propriétaire, bloquante pour la PAC 7** : chaque `entry` du registre
  post-verrou porte `ownerArbitration` (date). Le précédent P02 y inscrit la date des
  décisions de design ; la date candidate ici est l'approbation du design (2026-10-23,
  en-tête du design). L'agent ne l'inscrit que sur instruction explicite ; sans réponse,
  les tâches 2 à 8 s'arrêtent avant la PAC 7.
- [ ] Espace de travail (index) ; `bun run check` vert ; noter la ligne `Contracts verified` de base.
- [ ] Test rouge :
  ```ts
  test("a directory without a well-formed single-case fixture document is a named failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "signalement-inventory-"));
    // "ok": one case ; "two": two cases ; "garbage": not JSON ; "absent": no file
    const result = await loadSignalementV1FixtureCases(root, ["ok", "two", "garbage", "absent"]);
    expect(result.cases).toHaveLength(1);
    expect(result.failures).toEqual([
      "two: invalid separate schema fixture inventory",
      "garbage: invalid separate schema fixture inventory",
      "absent: invalid separate schema fixture inventory",
    ]);
  });
  test("the production list equals the admitted contracts", () =>
    expect(SIGNALEMENT_V1_FIXTURE_DIRECTORIES).toEqual([]));   // grows with each PAC 6
  ```
- [ ] `bun test tools/quality/signalement-v1-fixture-inventory.test.ts` → FAIL (module absent).
- [ ] Implémenter sur le modèle de `p02-v1-fixture-inventory.ts`, à une différence près :
  un fichier absent ou illisible est une failure nommée, jamais une exception. Brancher
  dans `check-contracts.ts` comme le bloc P02.
- [ ] Même commande → PASS. Neutralisation : remplacer le `failures.push` du cas absent
  par `continue` → le premier test rougit. Rétablir.
- [ ] ADR : `Decision identifier: urn:libre-ai:decision:<date>-signalement-v1-contracts`,
  `Status: proposed`, « Arbitration reference » (design de `libre-ai/signalement`, D3,
  D6, D7, D8, D10, D12, D13) ; alternatives DL4, DL5, DL7, DL9 ; décision = tableau DL12 ;
  conséquences : « admits catalog entries, grants no runtime admission; entries stay
  candidate until each required role passes; merge waits for the owner ».
- [ ] Dossier de revue sur le modèle de `docs/reviews/p02-v1-contracts-review.md` : rôles
  par contrat (DL12), mention `AGENT-REVIEW-PROTOCOL.md`, points de revue DL4-DL8, corpus
  adverse, fixture GitLab (tâche 3).
- [ ] `bun run check` vert, ligne `Contracts verified` inchangée.
- [ ] Commit : `git add` des 4 fichiers créés, `tools/quality/check-contracts.ts`,
  `package.json` ; `git commit -s -m "docs(contracts): propose signalement v1 contracts and add their fixture inventory"`.

### Task 2: `signalement-delivery-envelope-v1`

**Files:**
- Create: `contracts/schemas/signalement-delivery-envelope.v1.schema.json`, `contracts/signalement-delivery-envelope-v1/SEMANTICS.md`
- Create: `contracts/fixtures/signalement-delivery-envelope-v1/{schema-fixtures,vectors}.json`
- Create: `tools/quality/signalement-delivery-envelope-v1.{ts,test.ts,bunfig.toml}`
- Modify: PAC 5 à 11

**Interfaces:**
- Consumes: `parseStrictJson` (`tools/quality/policy-core-raw-inputs.ts:233`)
- Produces:
  ```ts
  export function rawDeliveryEnvelopeFailures(bytes: Uint8Array): string[];
  export const DELIVERY_ENVELOPE_MAX_BYTES = 4096;
  export const EXPORT_MAX_BYTES = 269500416;
  ```

Document (registre §4.1 et §4.6) :

```json
{
  "schemaVersion": "libre-ai.signalement-delivery-envelope.v1",
  "deliveryId": "<UUID v4 minuscule: ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$>",
  "exportSha256": "<^[a-f0-9]{64}$>",
  "exportByteLength": "<integer 1..269500416>",
  "observedOrigin": "<origin> | null"
}
```

- `deliveryId` en UUID v4 : forme déjà retenue par L6 et L7 (`crypto.randomUUID()`).
- `observedOrigin` : motif
  `^https?://(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(?::[1-9][0-9]{0,4})?$`,
  `maxLength` 262, ou `null` ; le vérificateur exige en plus `new URL(v).origin === v`.
- `EXPORT_MAX_BYTES` = 268435456 (contenu, SEMANTICS de l'export) + 1048576 (manifeste) +
  16384 (marge de conteneur), même valeur que `tools/contracts/verify-export.ts:30` de
  `signalement`. 4096 octets = plafond de l'en-tête `Signalement-Delivery-Envelope`
  (registre §4.5).
- Codes, dans l'ordre : `envelope.size_limit`, `envelope.raw_json`, `envelope.schema`,
  `envelope.origin_non_canonical`.

- [ ] Schéma, fixtures, `vectors.json`. Valides : origine `https` sans port,
  `http://localhost:8080`, `null`. Invalides (`failures` exacts) : origine avec chemin
  (`envelope.schema`), `https://app.example.com:443` (`envelope.origin_non_canonical`),
  hôte en majuscules, `"null"`, `file://`, `deliveryId` non UUID v4, `exportByteLength` 0
  et 269500417, champ inconnu (tous `envelope.schema`), membre dupliqué en `raw`
  (`envelope.raw_json`), 4097 octets (`envelope.size_limit`).
- [ ] Test rouge :
  ```ts
  for (const v of vectors.valid) test(`accepts ${v.name}`, () => expect(rawDeliveryEnvelopeFailures(bytesOf(v))).toEqual([]));
  for (const v of vectors.invalid) test(`refuses ${v.name}`, () => expect(rawDeliveryEnvelopeFailures(bytesOf(v))).toEqual(v.failures));
  test("schema fixture: valid passes, every mutation fails", () => { /* mutate() of p02-v1-contracts.test.ts */ });
  ```
- [ ] `bun run check:signalement-delivery-envelope-v1` → FAIL. Implémenter (taille avant
  analyse, `parseStrictJson(bytes, 8)`, Ajv strict, origine canonique) et `SEMANTICS.md`
  (DL6). → PASS, couverture ≥ 0.9.
- [ ] Neutralisation : contrôle `new URL(v).origin === v` remplacé par `true` → le vecteur
  `:443` rougit. Rétablir.
- [ ] PAC 6 à 11 ; message `feat(contracts): add signalement-delivery-envelope-v1 candidate`.

### Task 3: `signalement-connector-profile-v1`

**Files:**
- Create: `contracts/schemas/signalement-connector-profile.v1.schema.json`, `contracts/signalement-connector-profile-v1/SEMANTICS.md`
- Create: `contracts/fixtures/signalement-connector-profile-v1/{schema-fixtures,vectors,profiles.v1}.json`
- Create: `tools/quality/signalement-connector-profile-v1.{ts,test.ts,bunfig.toml}`
- Modify: PAC 5 à 11

**Interfaces:**
- Produces: `export function rawConnectorProfileFailures(bytes: Uint8Array): string[];` ;
  `profiles.v1.json` (4 profils, consommé par L3 et L5 ; L5 lit les noms de champs
  ci-dessous tels quels, accesseurs `profileIdOf`, `attachmentModeOf`, `lookupOf` du L3)

Document (design §5.6, `docs/contracts/connector-boundary.md` de `signalement`) :

```json
{
  "schemaVersion": "libre-ai.signalement-connector-profile.v1",
  "profileId": "<motif du registre>", "family": "<^[a-z0-9-]{1,32}$>", "edition": "<^[a-z0-9.-]{1,32}$>",
  "api": { "style": "rest | graphql", "version": "<^[a-z0-9.-]{1,32}$>" },
  "providerVersion": "<string ≤ 64> | null",
  "auth": { "mode": "fine-grained-token | project-access-token | personal-access-token | api-token | api-key", "scopes": ["<≤ 64>", "…≤ 32"] },
  "bodyFormat": "markdown-gfm | markdown-glfm | adf | html",
  "capabilities": {
    "discovery": "<cap>", "mappingValidation": "<cap>", "idempotentCreate": "<cap>", "attachExisting": "<cap>",
    "attachmentUpload": "<cap>", "comment": "<cap>", "cursorRead": "<cap>",
    "visibility": "discovered | declared",
    "consistentLookup": { "method": "issue-list | filtered-list | jql | entity-property | external-id | none", "status": "<cap>" }
  },
  "limits": { "maxBodyBytes": "<int ≥ 1> | null", "maxAttachmentBytes": "<int ≥ 1> | null", "maxAttachmentsPerItem": "<int ≥ 0> | null" },
  "conflictPolicy": { "title": "<pol>", "body": "<pol>", "attachments": "<pol>", "comments": "<pol>", "status": "<pol>", "closure": "<pol>" }
}
```

- `<cap>` = `supported | unsupported | unproven` (cellule « à prouver » = `unproven`) ;
  `<pol>` = `dossier-owned | provider-owned | merge-set | human-resolution` ; `null` dans
  `limits` = inconnu, fixé en qualification. `family` est un motif (un Bridge v1.1 ajoute
  une famille sans majeure).
- Le statut de qualification n'est **pas** dans le profil : seule autorité,
  `qualification/provider-matrix.yaml` (design B3, §7). Un profil `self-hosted` à
  `providerVersion: null` ne peut jamais être `qualified`.
- Codes : `profile.size_limit` (65536), `profile.raw_json`, `profile.schema`,
  `profile.id_mismatch` (`profileId` ≠ `` `${family}/${edition}/${api.style}-${api.version}` ``),
  `profile.lookup_inconsistent` (`method: "none"` avec `status` ≠ `unsupported`).
- `profiles.v1.json` = `{ schemaVersion: "libre-ai.signalement-connector-profiles.v1",
  profiles: [4] }`, ids du registre dans cet ordre. `conflictPolicy` identique :
  `title`/`body`/`attachments`/`comments` → `dossier-owned`, `status`/`closure` →
  `provider-owned`. `limits` à `null`.

| Profil | `auth` | `attachmentUpload` | `visibility` | `consistentLookup` | `bodyFormat` |
| --- | --- | --- | --- | --- | --- |
| `github-issues/github.com/rest-2022-11-28` | `fine-grained-token`, `["issues:write", "metadata:read"]` | `unsupported` | `discovered` | `issue-list`, `unproven` | `markdown-gfm` |
| `gitlab-issues/gitlab.com/rest-v4` | **choix propriétaire Q5**, défaut `personal-access-token`, `["api"]` | `supported` | `discovered` | `filtered-list`, `unproven` | `markdown-glfm` |
| `jira-cloud/cloud/rest-v3` | `api-token` | `supported` | `declared` | `jql`, **`unsupported`** | `adf` |
| `plane/self-hosted/rest-v1` | `api-key` | `unproven` | `declared` | `external-id`, `unproven` | `html` |

- GitLab : la documentation GitLab relue le 2026-10-24 réserve les jetons d'accès de
  projet de gitlab.com à Premium/Ultimate (feuille de route §6). `auth` n'est pas une
  cellule `unproven` : la valeur doit être tranchée (Q5) **avant le verrou** (tâche 13).
  Défaut proposé : jeton personnel d'un compte dédié, portée `api` ; la portée s'étend à
  toutes les appartenances du compte, ce que `SEMANTICS.md` dit.
- Jira : la documentation Atlassian exclut la lecture cohérente après écriture
  (feuille de route §6, infirmée) : `status: "unsupported"` directement, toute création
  ambiguë finit en `to-resolve`.
- Plane : `providerVersion: null` jusqu'à la qualification (L5 fige la version).

- [ ] Schéma, fixtures, `vectors.json` (valides : les 4 profils ; invalides : `profileId`
  incohérent → `["profile.id_mismatch"]`, `{none, supported}` →
  `["profile.lookup_inconsistent"]`, capacité `"partial"` et champ `qualification` →
  `["profile.schema"]`, membre dupliqué → `["profile.raw_json"]`), `profiles.v1.json`.
- [ ] Test rouge (boucles comme tâche 2) et :
  ```ts
  test("profiles.v1.json carries exactly the four v1.0 profile ids, each valid", () => {
    expect(profiles.profiles.map((p) => p.profileId)).toEqual([
      "github-issues/github.com/rest-2022-11-28", "gitlab-issues/gitlab.com/rest-v4",
      "jira-cloud/cloud/rest-v3", "plane/self-hosted/rest-v1",
    ]);
    for (const p of profiles.profiles) expect(rawConnectorProfileFailures(encode(p))).toEqual([]);
  });
  test("no published profile claims a GitLab project access token or a Jira consistent lookup", () => {
    const byId = Object.fromEntries(profiles.profiles.map((p) => [p.profileId, p]));
    expect(byId["gitlab-issues/gitlab.com/rest-v4"].auth.mode).not.toBe("project-access-token");
    expect(byId["jira-cloud/cloud/rest-v3"].capabilities.consistentLookup.status).toBe("unsupported");
  });
  ```
- [ ] `bun run check:signalement-connector-profile-v1` → FAIL ; implémenter vérificateur et
  `SEMANTICS.md` → PASS.
- [ ] Neutralisation : comparaison de `profile.id_mismatch` remplacée par `false` → son
  vecteur rougit. Rétablir.
- [ ] PAC 6 à 11 ; message `feat(contracts): add signalement-connector-profile-v1 candidate and the four v1.0 profiles`.

### Task 4: `signalement-routing-policy-v1`

**Files:**
- Create: `contracts/schemas/signalement-routing-policy.v1.schema.json`, `contracts/signalement-routing-policy-v1/SEMANTICS.md`
- Create: `contracts/fixtures/signalement-routing-policy-v1/{schema-fixtures,vectors}.json`
- Create: `tools/quality/signalement-routing-policy-v1.{ts,test.ts,bunfig.toml}`
- Modify: PAC 5 à 11

**Interfaces:**
- Consumes: `parseStrictJson`, `canonicalJson`
- Produces:
  ```ts
  export function rawRoutingPolicyFailures(bytes: Uint8Array): string[];
  export function routingPolicyDigest(document: unknown): string; // SHA-256 hex of canonicalJson(document)
  ```

Document (design §5.3, registre §4.1) :

```json
{
  "schemaVersion": "libre-ai.signalement-routing-policy.v1",
  "organization": "<^[a-z][a-z0-9-]{0,63}$>", "policyId": "<id>", "version": "<^[1-9][0-9]{0,9}$>",
  "destinations": [{
    "id": "<id>", "profileId": "<motif du registre>", "target": "<kind ci-dessous>",
    "residency": "eu | non-eu", "visibilitySource": "discovered | declared",
    "declaredVisibility": "public | private (requis si declared, interdit si discovered)",
    "mediaFallback": "link | withhold (absent = withhold)"
  }],
  "routingRules": [{
    "id": "<id>",
    "match": "{origin} | {scheme, hostPattern, port | null} | {absent: true}",
    "imposed": [], "optional": [], "selectable": [], "denied": [],
    "override": "allowed | denied (absent = denied)"
  }],
  "disclosureRules": [{
    "id": "<id>", "roles": ["document | screenshot | video"],
    "when": "{always: true} | {visibility: public|private} | {residency: eu|non-eu}",
    "decision": "transmit | withhold"
  }]
}
```

- Bornes : `destinations` 1..64, `routingRules` et `disclosureRules` 0..256, listes de
  règle 0..64 (`uniqueItems`), `roles` 1..3, document ≤ 1 MiB.
- `target` (`oneOf` par `kind`) : `github-repository {owner, repository}`,
  `gitlab-project {projectPath}`, `jira-project {siteUrl ^https://[a-z0-9-]+\.atlassian\.net$, projectKey ^[A-Z][A-Z0-9_]{1,9}$}`,
  `plane-project {baseUrl <origin https>, workspaceSlug, projectId <uuid>}`.
- `hostPattern` : `^\*\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$` ; tout
  sous-domaine, jamais l'apex ; `port: null` = origine sans port explicite.
- Codes : `policy.size_limit`, `policy.raw_json`, `policy.schema`,
  `policy.duplicate_id:<id>` (un seul espace pour destinations et règles),
  `policy.unknown_destination:<ruleId>`, `policy.routing_overlap:<ruleId>` (une
  destination dans deux listes d'une règle), `policy.target_profile_mismatch:<destId>`
  (`github-issues`→`github-repository`, `gitlab-issues`→`gitlab-project`,
  `jira-cloud`→`jira-project`, `plane`→`plane-project`).

**Sémantique d'évaluation (DL8), normative dans `SEMANTICS.md`, reprise par le monde WIT,
implémentée par L2.** `SEMANTICS.md` porte en tête cette ligne : « Precedence among
matched rules is the union below (DL8), decided by the owner on 2026-10-24. »
Entrée `EvaluationInput`, sortie `PolicyVerdict` du registre §4.2.
`DiscoveredAttributes` = `{ visibility: "public" | "internal" | "private" | "unknown";
attachmentUpload: boolean }` ; une entrée absente vaut `{ visibility: "unknown",
attachmentUpload: false }`. `evaluate` ne lit pas `attachmentUpload` : L3 l'applique dans
`buildDeliveryPlan` (motif `attachment-unsupported`).

1. **Appariement.** `origin` égal octet pour octet à `observedOrigin` ; ou `scheme`,
   `hostPattern`, `port` égaux à ses composantes ; ou `absent` et `observedOrigin ===
   null`. `matchedRuleIds` = ids appariés, ordre du document.
2. **Union.** `denied` = union des `denied` appariés ; `imposed` = union − `denied` ;
   `optional` = union − `imposed` − `denied` ; `selectable` = union − `imposed` −
   `optional` − `denied`. `deniedCount` = |`denied`|. `override` = `allowed` seulement si
   au moins une règle apparie et **toutes** déclarent `allowed`. Aucune règle appariée :
   `destinations: []`, `deniedCount: 0`, `override: "denied"`.
3. **Destinations du verdict** : `imposed` (`routing: "imposed"`), `optional`
   (`"optional"`) et, seulement si `override = "allowed"`, `selectable`
   (`"selectable"`) ; triées par `destinationId` (unités de code). Chacune porte ses
   `files` et `media` (= `mediaFallback`, défaut `withhold`).
4. **Visibilité effective** : `declaredVisibility` si `visibilitySource: declared`, sinon
   `discovered[id].visibility` ; `internal` vaut `public`.
5. **Décision par fichier** (triés par `path`) : (a) visibilité effective `unknown` →
   `withhold`, `visibility-unknown` (échec fermé, design §5.5, §7) ; (b) une règle
   `withhold` apparie → `withhold`, motif de la première dans l'ordre du document :
   `visibility` → `public-destination`, `residency` → `residency`, `always` →
   `default-withhold` ; (c) aucune règle `transmit` → `withhold`, `default-withhold` ;
   (d) sinon `transmit`, `reason: null`.
6. `policyVersion` = `version` ; `policyDigest` = `routingPolicyDigest(document)` ; sortie
   JCS ; l'ordre des `files` en entrée ne change pas la sortie.

- [ ] Schéma, fixtures, `vectors.json`. Invalides : destination inconnue
  (`["policy.unknown_destination:r-unknown"]`), même destination `imposed` et `denied`
  (`["policy.routing_overlap:r-overlap"]`), `jira-project` sur `github-issues`
  (`["policy.target_profile_mismatch:d-gh"]`), id dupliqué
  (`["policy.duplicate_id:d-gh"]`), `declaredVisibility` absent sur `declared`, `*.com`,
  `override: "maybe"` (`["policy.schema"]`), membre dupliqué (`["policy.raw_json"]`).
- [ ] Test rouge (boucles, fixture de schéma) et :
  ```ts
  test("the digest is SHA-256 of the JCS form and ignores member order", () => {
    const a = vectors.valid[0].document;
    const b = Object.fromEntries(Object.entries(a).reverse());
    expect(routingPolicyDigest(b)).toBe(routingPolicyDigest(a));
    expect(routingPolicyDigest(a)).toBe(createHash("sha256").update(canonicalJson(a)).digest("hex"));
  });
  ```
- [ ] `bun run check:signalement-routing-policy-v1` → FAIL ; implémenter vérificateur et
  `SEMANTICS.md` (sémantique ci-dessus ; DL4 : états, transitions `draft→approved`,
  `approved→retired`, séparation auteur/approbateur par défaut assouplissable par une
  modification elle-même approuvée et journalisée, design §5.3) → PASS.
- [ ] Neutralisation : contrôle `policy.unknown_destination` renvoyant `[]` → son vecteur
  rougit. Rétablir.
- [ ] PAC 6 à 11 ; message `feat(contracts): add signalement-routing-policy-v1 candidate`.

### Task 5: `signalement-projection-receipt-v1` — structure et jeu de clés

**Files:**
- Create: `contracts/schemas/signalement-projection-receipt.v1.schema.json`, `contracts/signalement-projection-receipt-v1/SEMANTICS.md`
- Create: `contracts/fixtures/signalement-projection-receipt-v1/{schema-fixtures,vectors}.json`
- Create: `tools/quality/signalement-projection-receipt-v1.{ts,test.ts,bunfig.toml}`
- Modify: PAC 5 à 11

**Interfaces:**
- Consumes: `parseStrictJson`, `canonicalJson`
- Produces:
  ```ts
  export function rawProjectionReceiptFailures(bytes: Uint8Array): string[];   // signed receipt document
  export function rawSigningKeySetFailures(bytes: Uint8Array): string[];       // PublicKeySet
  export const RECEIPT_SIGNATURE_DOMAIN = "libre-ai.signalement-projection-receipt.v1";
  export function receiptSigningMessage(unsigned: unknown): Uint8Array;        // domain ‖ 0x00 ‖ sha256(canonicalJson(unsigned))
  ```

Reçu signé (design §5.5, registre §4.2, DL5, DL6), **ASCII seul ; un seul nombre JSON,
l'entier `revision`** :

```json
{
  "schemaVersion": "libre-ai.signalement-projection-receipt.v1",
  "organization": "<organization>", "keyId": "<^[a-z0-9][a-z0-9-]{0,63}$>",
  "issuedAt": "<timestamp>", "deliveredAt": "<timestamp>",
  "exportDigest": "<sha256>", "projectionId": "<sha256>", "mappingVersion": "<^[0-9]+\\.[0-9]+\\.[0-9]+$>",
  "operation": "create | comment", "revision": "<integer 1..2147483647>",
  "destinationId": "<id>", "profileId": "<motif du registre>",
  "remote": { "id": "<^[\\x21-\\x7e]{1,256}$>", "url": "<^https://[\\x21-\\x7e]{1,2040}$>" },
  "transmitted": [{ "path": "<path export v1>", "sha256": "<sha256>", "via": "body | attachment | link" }],
  "withheld": [{ "path": "<path export v1>", "reason": "<WithholdReason>" }],
  "rendered": { "rendererVersion": "<semver>", "bodyDigest": "<sha256>", "mediaLinks": [{ "path": "<path>", "url": "<https>" }] },
  "requestBodyDigests": ["<sha256>", "…1..64"],
  "policy": { "version": "<version>", "digest": "<sha256>" },
  "approval": { "reference": "<id>" },
  "signature": { "algorithm": "ed25519", "value": "<^[A-Za-z0-9_-]{86}$>" }
}
```

- `UnsignedReceipt` = ce document sans `signature` (registre §4.2) ; `transmitted`,
  `withheld`, `mediaLinks` 0..33 ; `WithholdReason` = les six valeurs du registre ;
  `timestamp`, `path`, `id`, `digest` repris de l'export v1 (DL3). Noms `transmitted`,
  `withheld`, `via` repris de `buildUnsignedReceipt` (plan L3).
- `revision` = révision du Dossier livrée, mêmes bornes que `dossierRevision` de l'export
  v1 ; sans elle, un reçu `operation: "comment"` ne se recalcule pas hors ligne.
- `rendered.bodyDigest` = SHA-256 hexadécimal du **JCS** de `RenderedBody.body` (écrit
  tel quel dans `SEMANTICS.md`) ; `rendered.rendererVersion` en semver (forme de
  `RENDERER_VERSIONS`, L3) ; `requestBodyDigests` = corps HTTP réellement envoyés, dans
  l'ordre. Avec le document de l'export, `projectionId`, `revision` et `mediaLinks`,
  `rendered` suffit à recalculer le rendu hors ligne (registre §4.2).
- Identifiant du reçu pour l'API : hors contrat (L4).
- `$defs/signingKeySet` = `PublicKeySet` (DL7) : `{ organization, keys: [1..1024] {
  keyId, algorithm: "ed25519", publicKey ^[A-Za-z0-9_-]{43}$ (32 octets), status:
  "active" | "retired", notBefore: timestamp, notAfter: timestamp | null } }`.
- `rawProjectionReceiptFailures`, codes : `receipt.size_limit` (65536), `receipt.raw_json`,
  `receipt.non_canonical` (octets ≠ `canonicalJson` de l'analyse), `receipt.schema`,
  `receipt.duplicate_path`, `receipt.file_overlap` (chemin transmis et retenu),
  `receipt.media_link_untransmitted` (`mediaLinks.path` absent de `transmitted` en
  `via: "link"`), `receipt.timestamp_order` (`deliveredAt ≤ issuedAt`).
- `rawSigningKeySetFailures`, codes : `keys.size_limit` (262144), `keys.raw_json`,
  `keys.schema`, `keys.duplicate_key_id`, `keys.retired_without_end` (`retired` avec
  `notAfter: null`), `keys.window_order` (`notAfter ≤ notBefore`), `keys.encoding`
  (base64url non canonique). L'admissibilité des points n'est pas contrôlée ici (verdict
  `invalid` en tâche 6).
- `SEMANTICS.md` : ce qu'un reçu prouve et ne prouve pas (design §5.5) ; vérification hors
  ligne contre l'export (SHA-256 du ZIP = `exportDigest` ; chaque `transmitted.sha256` =
  digest du fichier dans le manifeste) ; recalcul du rendu seulement à
  `rendererVersion` identique, sinon le dire.

- [ ] Schéma, fixtures, `vectors.json`. Invalides : espace en trop et clés non triées →
  `["receipt.non_canonical"]` ; nombre dans `remote.id`, `revision` 0, `revision` 1.5,
  `revision` absente → `["receipt.schema"]` ; chemin transmis et
  retenu → `["receipt.file_overlap"]` ; `mediaLinks` vers un fichier `via: "body"` →
  `["receipt.media_link_untransmitted"]` ; `deliveredAt` après `issuedAt` →
  `["receipt.timestamp_order"]` ; URL `http://`, raison `"user-choice"`, timestamp à
  fraction → `["receipt.schema"]`. Section `keySetVectors` : id dupliqué, `retired` sans
  `notAfter`, fenêtre inversée, clé non canonique, 1025 clés.
- [ ] Test rouge (boucles sur les deux familles, fixture de schéma) et :
  ```ts
  test("the signing message is the domain, a zero byte and the raw SHA-256 of the JCS unsigned receipt", () => {
    const { signature: _, ...unsigned } = vectors.valid[0].document;
    const message = receiptSigningMessage(unsigned);
    const domain = new TextEncoder().encode("libre-ai.signalement-projection-receipt.v1");
    expect(message.length).toBe(domain.length + 33);
    expect(message.subarray(0, domain.length)).toEqual(domain);
    expect(message[domain.length]).toBe(0);
    expect(Buffer.from(message.subarray(domain.length + 1)).toString("hex"))
      .toBe(createHash("sha256").update(canonicalJson(unsigned)).digest("hex"));
  });
  test("a key set of 1024 keys passes and 1025 is a schema failure", () => { /* generated sets */ });
  ```
- [ ] `bun run check:signalement-projection-receipt-v1` → FAIL ; implémenter → PASS.
- [ ] Neutralisation : sortie anticipée avant la comparaison `receipt.non_canonical` → les
  deux vecteurs non canoniques rougissent. Rétablir.
- [ ] PAC 6 à 11 ; message `feat(contracts): add signalement-projection-receipt-v1 candidate structure and signing key set`.
