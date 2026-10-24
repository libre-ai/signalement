# L3, partie 2 — projection-core et prédicats (tâches 8 à 16)

Index, contraintes globales et Review Focus : `2026-10-24-v1-L3-sdk-projection-core.md`. Interfaces SDK et faux fournisseur : partie 1, tâches 2 à 7.

Types L2 consommés (`import type` depuis `packages/policy-receipt-wasm/index.ts`) :
- `PolicyVerdict`, `VerdictDestination` (dont `routing: "imposed" | "optional" | "selectable"`), `WithholdReason` ;
- `DiscoveredAttributes`, `UnsignedReceipt`.

En valeur, et seulement à la tâche 16 : `loadPolicyReceipt`, `PolicyReceiptApi`, `PublicKeySet`, `ReceiptVerification`.

### Task 8: Identité, clé d'idempotence, gates zéro I/O, fixtures

**Files:**
- Create: `packages/projection-core/{identity,index,fixtures}.ts`, `packages/projection-core/README.md`
- Modify: `tools/ci/package-boundary.ts` (politiques `packages/projection-core` et `packages/fake-provider`)
- Test: `packages/projection-core/identity.test.ts`, `packages/projection-core/types.test.ts`, `tools/ci/package-boundary.test.ts` (cas ajoutés)

**Interfaces:**
- Consumes : `canonicalJson` ; `Bun.CryptoHasher`.
- Produces, mot pour mot depuis le registre §4.4, `projectionId` et `idempotencyKey`, plus :

```ts
// fixtures.ts (test support, imported only by tests)
export const PROFILE_IDS: readonly ["github-issues/github.com/rest-2022-11-28", "gitlab-issues/gitlab.com/rest-v4", "jira-cloud/cloud/rest-v3", "plane/self-hosted/rest-v1"];
export function verdictFixture(overrides?: Partial<PolicyVerdict>): PolicyVerdict;   // typed literal, `satisfies PolicyVerdict`
```

**Règles de l'identité.**
- `projectionId` = SHA-256 hexadécimal du JCS de `[organization, dossierId, destinationId]`.
- `idempotencyKey` = SHA-256 hexadécimal du JCS de `[projectionId, exportDigest, mappingVersion]`.
- Erreurs :
  - chaîne vide → `identity.empty` ;
  - surrogate isolé → `identity.unicode`, parce que JCS exige de l'I-JSON ;
  - `projectionId` ou `exportDigest` hors de `^[0-9a-f]{64}$` → `identity.digest`.

**Contenu de `verdictFixture`.**
- `policyVersion` `"policy-7"`, `policyDigest` `"b".repeat(64)`, `matchedRuleIds` `["rule-origin-app"]`, `override` `"denied"`, `deniedCount` `2`.
- `dest-imposed` : GitLab, `imposed`. `README.md` et `media/kept-shot-a1.png` en `transmit` ; `media/held-shot-b2.png` en `withhold`, motif `public-destination` ; `media` `withhold`.
- `dest-optional` : Jira, `optional`. Tout en `transmit`, sauf `held-shot-b2` en `withhold`, motif `residency`.
- `dest-unknown-visibility` : GitHub, `imposed`. Tout en `withhold`, motif `visibility-unknown` ; `media` `link`.
- Avec `override: "allowed"`, s'y ajoute `dest-selectable` : Plane, `selectable`, `README.md` en `transmit`, médias en `transmit`, `media` `withhold`.

**Politiques ajoutées.**
- `packages/projection-core` :
  - en source : relatifs sous `projection-core/` et `connector-sdk/` ; `vendor/contracts/tools/quality/authorized-execution.ts` ; `packages/policy-receipt-wasm/` en `typeOnly`. Aucune fixture vendorisée en source : les profils arrivent par `profileFor` (tâche 9) ;
  - en test, en plus : `bun:test`, `packages/fake-provider/`, `packages/domain/`, `vendor/contracts/tools/quality/` (vérificateur de reçu, tâches 14 et 16), et `packages/policy-receipt-wasm/` en valeur (tâche 16) ;
  - `forbiddenTokens` : `fetch(`, `Bun.file`, `Bun.write`, `Bun.spawn`, `Bun.dns`, `node:`, `process.`, `require(`, `import(`, `Date.now`, `new Date(`, `Math.random`, `getRandomValues`, `setTimeout`, `setInterval`, `WebSocket`, `XMLHttpRequest`, `revealSecret(`, `console.`.
- `packages/fake-provider` :
  - imports permis : relatifs internes, `connector-sdk/`, `packages/domain/`, la fixture de profils L1, `bun:test` ;
  - `forbiddenTokens` : `fetch(`, `revealSecret(`, `console.`.

- [ ] **Tests rouges.** Vecteurs mesurés par un instrument indépendant : `printf '%s' '<JCS>' | shasum -a 256`.

```ts
const P = "77a226d2a0a75717e7f248af6e52722b7a4fb86e7eb5501a1b29793af16d67f2";  // ["org-1","dossier-1","dest-github"]
const E = "a".repeat(64);
test("projectionId is SHA-256 of the JCS triple", () => { expect(projectionId("org-1", "dossier-1", "dest-github")).toBe(P); });
test("JCS string escaping is RFC 8785", () => {
  expect(projectionId("organisation-é", 'dossier-"q"', "dest-\u0001")).toBe("f8a05dcc8cf163ed78fbdaf9be158be997badd5e8de79cccb61d82dd16a64e8a");
});
test("idempotencyKey binds projection, export digest and mapping version", () => {
  expect(idempotencyKey(P, E, "1.0.0")).toBe("cd1fb0492fb8c0a641712df04e891799a9f58e8eddc74c8a9da86920a51bff4a");
  expect(idempotencyKey(P, E, "1.1.0")).toBe("1a2045f17cba7d91541a7e62da80ad6248a8e4d773ca1eae974afd5c8c8ba84f");
});
test("invalid identity inputs are refused", () => {
  expect(() => projectionId("", "d", "x")).toThrow("identity.empty");
  expect(() => projectionId("org", "d\uD800", "x")).toThrow("identity.unicode");
  expect(() => idempotencyKey("nothex", E, "1.0.0")).toThrow("identity.digest");
  expect(() => idempotencyKey(P, E.toUpperCase(), "1.0.0")).toThrow("identity.digest");
});
// types.test.ts — the Apache SDK cannot import L2, so projection-core proves the two shapes equal
test("RemoteAttributes (SDK) equals DiscoveredAttributes (L2)", () => { expectTypeOf<RemoteAttributes>().toEqualTypeOf<DiscoveredAttributes>(); });
```

Dans `package-boundary.test.ts` : `Date.now()` dans `projection-core/x.ts` → `token` ; une valeur importée de `../policy-receipt-wasm/index.ts` → `type-only` ; `revealSecret(` dans `fake-provider/x.ts` → `token` ; les vrais arbres → `findings` vide, `files > 0`.

- [ ] **Rouge attendu**, puis **implémenter**, puis **vert** : `bun test packages/projection-core tools/ci/package-boundary.test.ts`. `bun run check:package-boundaries` imprime trois lignes `findings=0`. README : rôle du paquet, absence d'I/O (prouvée par le gate), exports.
- [ ] **Neutralisation.** `mappingVersion` remplacé par `""` dans le triplet haché : les deux vecteurs rougissent. Restaurer.
- [ ] **Commit.**
  - `git add packages/projection-core/identity.ts packages/projection-core/index.ts packages/projection-core/fixtures.ts packages/projection-core/README.md packages/projection-core/identity.test.ts packages/projection-core/types.test.ts tools/ci/package-boundary.ts tools/ci/package-boundary.test.ts`
  - `bun run check`
  - `git commit -s -m "feat(projection-core): derive projection id and idempotency key from JCS" -m "Neutralization: hashing an empty mapping version turns both key vectors red."`

### Task 9: `buildDeliveryPlan` — la sélection ne peut que retirer

**Files:** Create `packages/projection-core/plan.ts` ; Modify `index.ts` ; Test `packages/projection-core/plan.test.ts`

**Interfaces:**
- Consumes : `PolicyVerdict`, `WithholdReason` ; `ConnectorProfile`, `attachmentModeOf`, `profileIdOf` (tâche 2) ; `canonicalJson`. Les tests fournissent `profileFor` à partir de `referenceProfile` (tâche 7), qui lit la fixture L1 côté `fake-provider`.
- Produces :

```ts
export interface UserSelection {
  optional: readonly string[];                                   // optional destinationIds the person checked
  added: readonly string[];                                      // selectable destinationIds the person added (override)
  withheld: readonly { destinationId: string; path: string }[];  // extra withholds
}
export interface PlannedFile { path: string; decision: "transmit" | "withhold"; reason: WithholdReason | null; via: "body" | "attachment" | "link" | null } // via null iff withhold; same word as the L1 receipt
export interface PlannedDestination { destinationId: string; profileId: string; routing: "imposed" | "optional" | "selectable"; files: readonly PlannedFile[]; media: "link" | "withhold" }
export interface UnavailableDestination { destinationId: string; code: "plan.profile-unavailable" }
export interface DeliveryPlan { policyVersion: string; policyDigest: string; matchedRuleIds: readonly string[]; destinations: readonly PlannedDestination[]; unavailable: readonly UnavailableDestination[]; deniedCount: number }
export function buildDeliveryPlan(verdict: PolicyVerdict, selection: UserSelection, profileFor: (profileId: string) => ConnectorProfile | null): DeliveryPlan; // registry §4.4
export function planDigest(plan: DeliveryPlan, exportDigest: string): string;   // SHA-256 hex of JCS({ exportDigest, plan }); binds an approval (design §5.4)
```

**Règles.**
1. Destinations retenues :
   - `imposed` : toujours ;
   - `optional` : si son identifiant est dans `selection.optional` ;
   - `selectable` : si son identifiant est dans `selection.added`. Le verdict n'en porte que si `override = "allowed"` (registre §4.2), et sa divulgation est celle du verdict.
2. Motifs posés par L3, que l'évaluation L2 ne produit jamais (registre §4.2) :
   - `user-withheld` : un fichier `transmit` désigné par `withheld` ;
   - `attachment-unsupported` : un média `transmit` vers un profil dont `attachmentModeOf` vaut `"none"`, quand la destination a `media: "withhold"`.
3. `via` d'un fichier `transmit` :
   - `README.md` (`role: document`) → `"body"` ;
   - média vers un profil `"upload"` → `"attachment"` ;
   - média vers un profil `"none"` avec `media: "link"` → `"link"`.
   La capacité se lit par `attachmentModeOf(profileFor(profileId))`. Quand `profileFor` rend `null`, la destination retenue est **refusée** : elle sort de `destinations`, elle entre dans `unavailable` avec le code `plan.profile-unavailable`, et aucun de ses fichiers n'est planifié. Une destination refusée n'est jamais une escalade. `profileFor` est appelé une fois par destination retenue, et jamais pour une destination non retenue.
4. Ordre stable : destinations triées par `destinationId`, fichiers par `path` (unités de code).
5. Rejets :
   - `selection.escalation` : tout ajout hors verdict, c'est-à-dire un `optional` qui n'est pas une destination `optional` du verdict, ou un `added` qui n'est pas une destination `selectable` du verdict (y compris quand `override = "denied"`) ;
   - `selection.invalid` : un doublon, ou un `withheld` qui vise une destination ou un fichier absents du plan ;
   - `verdict.invalid` : un `destinationId` en double, un `transmit` avec motif non nul, une destination `selectable` alors que `override = "denied"`.

- [ ] **Tests rouges** (valeurs exactes) :
  - `imposed always, optional only when checked, denied count carried` : sans sélection, `["dest-imposed", "dest-unknown-visibility"]` et `deniedCount 2` ; avec `optional: ["dest-optional"]`, 3 destinations.
  - `override addition takes the verdict disclosure` : `verdictFixture({ override: "allowed", destinations: [...base, selectable] })` avec `added: ["dest-selectable"]` donne une destination `routing: "selectable"`. Ses médias passent en `withhold` `attachment-unsupported` : Plane a `attachmentUpload: "unproven"`, donc `none`, et `media: "withhold"`.
  - `additions outside the verdict escalate` : `added: ["dest-x"]`, puis `added: ["dest-imposed"]`, puis `optional: ["dest-imposed"]` → `selection.escalation`.
  - `a selectable destination under override denied is an invalid verdict` → `verdict.invalid`.
  - `extra withhold sets user-withheld and via null` sur `kept-shot-a1` de `dest-imposed` → `{ decision: "withhold", reason: "user-withheld", via: null }`.
  - `via per profile` : GitLab, média `attachment` ; GitHub avec `media: "link"`, média `link` ; `README.md` `body`.
  - `a destination whose profile is unavailable is refused with a typed code` : `profileFor` qui rend `null` pour Jira, avec `optional: ["dest-optional"]`. Attendu : `dest-optional` absente de `destinations`, `unavailable` = `[{ destinationId: "dest-optional", code: "plan.profile-unavailable" }]`, aucune exception.
  - `profileFor is consulted only for retained destinations` : un espion compte les appels ; sans sélection, seuls `dest-imposed` et `dest-unknown-visibility` sont demandés.
  - Tous les appels de test passent `profileFor = (id) => referenceProfile(id)`. Le test de propriété fait aussi rendre `null` à `profileFor` pour un profil tiré au sort : aucun `transmit` n'apparaît pour une destination indisponible.
  - `property: over 2000 seeded selections no planned transmit is absent from the verdict`. Générateur `mulberry32(20261024)`, 6 lignes dans le test. Il tire des sous-ensembles d'identifiants `optional`, `selectable`, inconnus et de paires `withheld`. Pour chaque plan construit : chaque `transmit` existe en `transmit` dans le verdict, et les destinations du plan sont incluses dans celles du verdict. Assertions : plans construits > 0 et sélections rejetées > 0.
  - `planDigest changes when one decision or the export digest changes` : trois digests distincts.
- [ ] **Rouge attendu**, puis **implémenter**, puis **vert** : `bun test packages/projection-core/plan.test.ts`.
- [ ] **Neutralisation.**
  - Le contrôle « `added` ∈ destinations `selectable` » remplacé par `true` : le cas `added: ["dest-imposed"]` rougit.
  - Le test `profileFor(id) === null` remplacé par `false` : le cas de profil indisponible rougit.
  - La pose d'`attachment-unsupported` remplacée par l'identité : le test d'override rougit.
  - Restaurer chaque fois.
- [ ] **Commit.**
  - `git add packages/projection-core/plan.ts packages/projection-core/plan.test.ts packages/projection-core/index.ts`
  - `bun run check`
  - `git commit -s -m "feat(projection-core): build delivery plans that selections can only narrow" -m "Neutralization: accepting any addition, or skipping attachment-unsupported, turns its test red."`

### Task 10: `revalidatePlan` — plan figé, attributs relus

**Files:** Create `packages/projection-core/revalidate.ts` ; Modify `index.ts` ; Test `revalidate.test.ts`

**Interfaces:**
- Produces :

```ts
export interface RevalidationInput {
  destinationId: string;
  policy: { version: string; digest: string; state: "approved" | "retired" };
  plannedAttributes: RemoteAttributes;                 // read when the plan was computed
  discovery: Result<Discovery, ConnectorFailure>;      // read again just before sending
}
export function revalidatePlan(plan: DeliveryPlan, current: RevalidationInput): "send" | "to-resolve";
export function revalidationReason(plan: DeliveryPlan, current: RevalidationInput):
  null | "plan.destination-missing" | "plan.policy-retired" | "plan.policy-changed" | "plan.discovery-failed" | "plan.profile-changed" | "plan.attribute-changed";
```

`revalidatePlan` rend `"to-resolve"` si et seulement si `revalidationReason` n'est pas nul. Les raisons sont évaluées dans l'ordre de l'union. Les attributs sont comparés par `canonicalJson`. Une lecture en échec donne `to-resolve` : c'est l'échec fermé du design §5.5.

- [ ] **Test rouge.**
  - Base : `dest-imposed`, `policy-7`/`"b".repeat(64)`/`approved`, attributs prévus `{ visibility: "private", attachmentUpload: true }`, découverte identique → `"send"`.
  - Puis un `test.each` sur six mutations, une par raison : destination inconnue ; politique `retired` ; version `policy-8` ; découverte en échec (`transport`) ; `profileId` Jira ; visibilité `public`. Chacune donne sa raison et `"to-resolve"`.
- [ ] **Rouge attendu**, puis **implémenter**, puis **vert**.
- [ ] **Neutralisation.** `if (!current.discovery.ok) return "plan.discovery-failed"` remplacé par un no-op (avec accès gardé pour compiler) : le cas `plan.discovery-failed` rougit. Restaurer.
- [ ] **Commit.**
  - `git add packages/projection-core/revalidate.ts packages/projection-core/revalidate.test.ts packages/projection-core/index.ts`
  - `bun run check`
  - `git commit -s -m "feat(projection-core): refuse stale plans before sending" -m "Neutralization: ignoring a failed rediscovery turns the discovery-failed case red."`

### Task 11: `transition` — machine d'état

**Files:** Create `packages/projection-core/state.ts`, `packages/projection-core/delivery-types.ts` (`DeliveryOutcome`, `DeliverySuccess`, recopiés ici depuis la tâche 13) ; Modify `index.ts` ; Test `state.test.ts`

**Interfaces:**
- Produces : `ProjectionState`, `transition`, plus :

```ts
export type ProjectionEvent =
  | { type: "dispatch" } | { type: "succeeded"; result: "created" | "updated" } | { type: "retry" }
  | { type: "to-resolve" } | { type: "fail" } | { type: "revise" } | { type: "reapprove" };
export function outcomeEvent(outcome: DeliveryOutcome): ProjectionEvent;
export const PROJECTION_STATE_LABELS: Readonly<Record<ProjectionState, string>>;
```

**Transitions permises.** 10 paires (état, événement) sur 48 ; les 38 autres lèvent `Error("projection.transition")`.

| De | Événement | Vers |
| --- | --- | --- |
| `pending` | `dispatch` | `dispatching` |
| `dispatching` | `succeeded/created` | `created` |
| `dispatching` | `succeeded/updated` | `updated` |
| `dispatching` | `retry` | `pending` |
| `dispatching` | `to-resolve` | `to-resolve` |
| `dispatching` | `fail` | `failed` |
| `created` | `revise` | `pending` |
| `updated` | `revise` | `pending` |
| `to-resolve` | `reapprove` | `pending` |
| `failed` | `reapprove` | `pending` |

**Libellés** (registre §4.4) : `pending` et `dispatching` → « en attente », `created` → « créé », `updated` → « mis à jour », `to-resolve` → « à résoudre », `failed` → « échec ».

- [ ] **Test rouge.**

```ts
test("every one of the 48 (state, event) pairs is the allowed target or refused", () => {
  let refused = 0;
  for (const state of STATES) for (const event of EVENTS) {
    const target = ALLOWED[key(state, event)];
    if (target) expect(transition(state, event)).toBe(target);
    else { expect(() => transition(state, event)).toThrow("projection.transition"); refused += 1; }
  }
  expect(refused).toBe(38);
});
test("screen labels are the registry ones", () => {
  expect(PROJECTION_STATE_LABELS).toEqual({ pending: "en attente", dispatching: "en attente", created: "créé", updated: "mis à jour", "to-resolve": "à résoudre", failed: "échec" });
});
```

`STATES`, `EVENTS` et `ALLOWED` reprennent la table ci-dessus. Ajouter un cas `outcomeEvent` par branche de `DeliveryOutcome`.

- [ ] **Rouge attendu**, puis **implémenter** (table littérale), puis **vert**.
- [ ] **Neutralisation.** Entrée `"to-resolve|dispatch": "dispatching"` ajoutée à la table : `refused` vaut 37 et le test rougit. Retirer l'entrée.
- [ ] **Commit.**
  - `git add packages/projection-core/state.ts packages/projection-core/delivery-types.ts packages/projection-core/state.test.ts packages/projection-core/index.ts`
  - `bun run check`
  - `git commit -s -m "feat(projection-core): add projection state machine with screen labels" -m "Neutralization: allowing to-resolve to dispatch turns the exhaustive transition test red."`

### Task 12: `renderBody` — rendu pur, versionné, par profil

**Files:** Create `packages/projection-core/render.ts`, `packages/projection-core/render-golden.json` ; Modify `index.ts`, `fixtures.ts` (`renderFixture`) ; Test `render.test.ts`

**Interfaces:**
- Consumes : `RenderedContent`, `ProjectionMarker`, `AdfDocument` (tâche 2).
- Produces :

```ts
export interface RenderInput {
  kind: "create" | "comment";
  revision: number;
  content: { statements: { expected: string; observed: string }; context: { application: string; environment: string; steps: readonly string[] } } | null; // null: document withheld
  links: readonly { path: string; label: string; url: string }[];   // media delivered as links; label set by the core: "Screenshot 1", "Video 1"
  attachedCount: number;                                            // media delivered as provider attachments
  marker: ProjectionMarker;
}
export interface RenderedBody { rendererVersion: string; body: RenderedContent; marker: ProjectionMarker }
export const RENDERER_VERSIONS: Readonly<Record<string, string>>;
export function renderBody(profileId: string, input: RenderInput): RenderedBody;
export function renderedBodyDigest(body: RenderedContent): string;          // SHA-256 hex of the JCS of RenderedBody.body (UTF-8 canonicalJson); = receipt rendered.bodyDigest, reused by L7
export function markerText(projectionId: string, deliveryKey: string): string; // "signalement-projection:v1:<projectionId>:<deliveryKey>"
```

**Valeurs fixées.**
- `RENDERER_VERSIONS` : `"1.0.0"` pour chacun des 4 profils, la forme semver du registre et du reçu L1. Le profil figure dans le reçu, donc la paire (profil, version) est unique.
- Profil inconnu → `render.unknown-profile`.
- Titre neutre, identique pour les 4 profils : `Signalement report <12 premiers caractères de marker.projectionId>`. Aucun texte du Dossier n'y entre.
- `marker.notBefore` borne la recherche. Il n'entre pas dans le corps : le corps ne contient que `markerText`.

**Échappement.** Le texte du Dossier n'est jamais interprété comme balisage.
1. Préparation commune, avant tout format :
   - CRLF et CR deviennent LF ;
   - un caractère de contrôle C0 autre que LF et TAB devient U+FFFD ;
   - un surrogate isolé lève `render.unicode` ;
   - toute occurrence de `signalement-projection`, sans tenir compte de la casse, voit ses traits d'union remplacés par U+2011.
2. Markdown (GitHub, GitLab) :
   - chaque champ va dans un bloc clôturé par des tildes, de longueur `max(4, plus longue suite de tildes du champ + 1)` ;
   - chaque ligne de contenu est préfixée de deux espaces ;
   - les lignes hors bloc sont exclusivement celles du gabarit : les titres de l'export (`packages/domain/export.ts:86-99` : `## Expected — user statement`, `## Observed — user statement`, `## Context — user statement`, `## Steps — user statement`), puis `## Media`, `## Revision <n>`, `- [<label>](<url>)`, `Attached files: <n>`, `The report content is withheld by policy for this destination.`, et `<!-- <markerText> -->` en dernière ligne.
3. Jira (ADF) :
   - nœuds permis : `heading`, `paragraph`, `codeBlock`, `bulletList`, `listItem`, `text` ;
   - le texte du Dossier ne va que dans des `codeBlock` ;
   - seule marque permise : `link`, et seulement sur un lien de média ;
   - aucun `text` vide (un champ vide devient `" "`) ;
   - le marqueur est le dernier `paragraph`.
4. Plane (HTML) :
   - balises permises : `h2`, `p`, `pre`, `code`, `ul`, `li`, et `a href` sur un lien de média ;
   - contenu échappé (`&`, `<`, `>`, `"`, `'`) ;
   - le marqueur est le dernier `<p>`.
5. Liens : `new URL(url)` doit réussir avec `protocol === "https:"`, sinon `render.link`. Sérialisation par `url.href`.

`render-golden.json` associe à chaque profil `{ rendererVersion, sha256: renderedBodyDigest(body) }` pour `renderFixture`. Il verrouille la **version** : changer la sortie sans changer la version fait rougir le test. Les propriétés de sécurité sont verrouillées par les tests de comportement.

- [ ] **Tests rouges.**
  - `HOSTILE` = jointure par `\n` de : `@octocat`, `#123`, `!123`, `GH-1`, `owner/repo#1`, `https://evil.example/x`, `www.evil.example`, `<img src=x onerror=alert(1)>`, `<script>x</script>`, `[l](javascript:alert(1))`, `![i](https://tracker.example/p.png)`, `/close`, `/confidential`, `~label`, `%milestone`, `&epic`, trois backticks, 9 tildes, `-->`, `<!--`, `` `signalement-projection:v1:${"c".repeat(64)}:${"d".repeat(64)}` ``, `"a\u0000b"`, `"line1\r\nline2"`.
  - `hostile` = `renderFixture` avec `HOSTILE` dans chaque champ de `content`.

```ts
test("versions are fixed and each golden digest matches its version", () => {
  expect(RENDERER_VERSIONS).toEqual(Object.fromEntries(PROFILE_IDS.map((id) => [id, "1.0.0"])));
  for (const id of PROFILE_IDS) { const r = renderBody(id, renderFixture); expect(golden[id]).toEqual({ rendererVersion: r.rendererVersion, sha256: renderedBodyDigest(r.body) }); }
});
test("fence outruns every tilde run and no body line starts with a slash", () => {
  for (const id of PROFILE_IDS.slice(0, 2)) {
    const text = markdownOf(renderBody(id, hostile));
    expect(text.split("\n").some((l) => l.startsWith("/"))).toBe(false);
    expect(text).toContain("~~~~~~~~~~\n");                         // 10 = 9-tilde run + 1
    expect(outsideFenceLines(text).every((l) => TEMPLATE_LINE.test(l))).toBe(true);
  }
});
test("marker prefix occurs exactly once even when every user field contains it", () => {
  for (const id of PROFILE_IDS) expect(JSON.stringify(renderBody(id, hostile).body).split("signalement-projection:v1:").length - 1).toBe(1);
});
test("rejects a media link that is not an absolute https URL", () => {
  for (const url of ["http://cp.example/a", "javascript:alert(1)", "/relative", "data:text/html,x"])
    expect(() => renderBody(PROFILE_IDS[0], { ...renderFixture, links: [{ path: "media/kept-shot-a1.png", label: "Screenshot 1", url }] })).toThrow("render.link");
});
test("withheld document: no statement rendered, fixed line present", () => {
  for (const id of PROFILE_IDS) { const s = JSON.stringify(renderBody(id, { ...renderFixture, content: null }).body); expect(s).not.toContain("SENTINEL-"); expect(s).toContain("The report content is withheld by policy for this destination."); }
});
```

Tests à écrire en entier, en plus :
  - `same input renders byte-identical output` ;
  - `unknown profile is refused` ;
  - `jira: ADF node allowlist, user text only in codeBlock, no empty text, no mention or card` ;
  - `plane: no tag outside the allowlist after removing allowed tags` ;
  - `lone surrogate is refused` ;
  - `title is neutral` ;
  - `notBefore does not change the body`.

Fonctions d'aide, dans le fichier de test : `markdownOf`, `outsideFenceLines` (une clôture est une suite de tildes de longueur ≥ l'ouverture) et `TEMPLATE_LINE`. `renderFixture` : sentinelles de la tâche 6, `revision 1`, `kind "create"`, `links []`, `attachedCount 1`, marqueur `markerText("e".repeat(64), "f".repeat(64))`, `within: null`, `notBefore: "2026-10-24T10:00:00Z"`.

- [ ] **Rouge attendu**, puis **implémenter**. `render-golden.json` est rempli avec les digests mesurés (relevés dans le message d'échec du test) après relecture à l'œil des 4 rendus. Puis **vert**.
- [ ] **Neutralisation.**
  - La préparation du marqueur réduite à l'identité → le test du marqueur unique rougit.
  - Le préfixe de deux espaces réduit à `""` → le test des barres obliques rougit.
  - Le contrôle `https:` remplacé par `true` → le test des liens rougit.
  - Restaurer chaque fois.
- [ ] **Commit.**
  - `git add packages/projection-core/render.ts packages/projection-core/render-golden.json packages/projection-core/render.test.ts packages/projection-core/fixtures.ts packages/projection-core/index.ts`
  - `bun run check`
  - `git commit -s -m "feat(projection-core): render provider bodies with literal user text per profile" -m "Neutralization: identity marker preparation, empty line prefix and an always-true https check each turn their test red."`

### Task 13: `executeDelivery` — l'algorithme d'une livraison

**Files:** Create `packages/projection-core/delivery.ts`, `packages/projection-core/manifest-view.ts` ; Modify `delivery-types.ts`, `index.ts` ; Test `delivery.test.ts`, `manifest-view.test.ts`

**Interfaces:**
- Consumes : tâches 2 à 12 ; `instrumentHttpPort`.
- Produces. `DeliveryDeps` et `DeliveryOutcome` sont recopiés mot pour mot du registre §4.4. `readFile(path)` rend les octets de l'entrée d'export `path`, `manifest.json` compris.

```ts
export interface DeliveryJob {
  organization: string; dossierId: string; projectionId: string; idempotencyKey: string;
  exportDigest: string; mappingVersion: string;                    // semver (receipt L1)
  kind: "create" | "comment"; revision: number;
  remote: RemoteItemRef | null;                                    // required iff kind === "comment"
  firstAttemptAt: string;                                          // becomes marker.notBefore
  previousAttemptAmbiguous: boolean;                               // a previous attempt sent a body and did not succeed
  priorSentBodyDigests: readonly string[];                         // recorded by L4's outer instrumented port
  target: DestinationTarget; plan: DeliveryPlan; plannedAttributes: RemoteAttributes;
  currentPolicy: { version: string; digest: string; state: "approved" | "retired" };  // read by L4 just before the call
  mediaLinks: Readonly<Record<string, string>>;                    // export path → https URL (GET /artifacts/{artifactId})
  approvalRef: string;
}
export interface DeliverySuccess {
  result: "created" | "updated"; remote: RemoteItemRef; foundExisting: boolean;
  rendered: { rendererVersion: string; bodyDigest: string; mediaLinks: readonly { path: string; url: string }[] }; // registry §4.2
  requestBodyDigests: readonly string[];
  transmitted: readonly { path: string; sha256: string; via: "body" | "attachment" | "link" }[];
  withheld: readonly { path: string; reason: WithholdReason }[];
  attachments: readonly AttachmentReceipt[];
  completedAt: string;                                             // deps.ctx.clock()
}
export function executeDelivery(job: DeliveryJob, deps: DeliveryDeps): Promise<DeliveryOutcome>;
export interface ExportPayloadView { dossierId: string; dossierRevision: number; statements: { expected: string; observed: string }; context: { application: string; environment: string; steps: readonly string[] }; files: readonly { path: string; role: "document" | "screenshot" | "video"; mimeType: string; sha256: string }[] }
export function parseExportPayloadView(manifestBytes: Uint8Array): ExportPayloadView;   // Error("delivery.manifest")
export function buildRenderInput(payload: ExportPayloadView, destination: PlannedDestination,
  options: { kind: "create" | "comment"; revision: number; marker: ProjectionMarker; mediaLinks: Readonly<Record<string, string>> }): RenderInput;
```

`buildRenderInput` ne reçoit que des fichiers `transmit`. `links` et `attachedCount` découlent de `PlannedFile.via`.

**Algorithme.** Aucun envoi avant l'étape 5.

0. Contrôles d'entrée. Chaque refus rend `failed`, `retryable: false` :
   - identité qui ne se recalcule pas → `invalid-mapping`, `delivery.identity` ;
   - `comment` sans `remote` → `invalid-mapping`, `delivery.remote-missing` ;
   - destination absente du plan → `invalid-mapping`, `delivery.destination-missing` ;
   - profil non déclaré par `connector.profiles` (`profileIdOf`), ou différent de `target.profileId` → `unsupported`, `delivery.profile-mismatch`.
1. `rediscover()`, puis `revalidationReason` avec `currentPolicy` et `plannedAttributes`. Raison non nulle → `to-resolve` avec cette raison.
2. Manifeste par `readFile("manifest.json")`, puis `parseExportPayloadView`. Erreur → `to-resolve`, `export.manifest`.
3. Chaque fichier média `transmit` est lu, et son SHA-256 comparé au descripteur ; écart → `to-resolve`, `export.integrity`. Si `via` vaut `attachment` et que `attachmentModeOf(profil du connecteur)` n'est pas `upload`, ou si `via` vaut `link` sans URL `https` dans `mediaLinks` → `to-resolve`, `plan.attachment-inconsistent`. **Aucun fichier `withhold` n'est lu.**
4. Marqueur et rendu :
   - marqueur : `markerText(projectionId, idempotencyKey)`, `within` = `null` pour une création ou `job.remote` pour un commentaire, `notBefore` = `job.firstAttemptAt` ;
   - `buildRenderInput`, puis `renderBody`.
5. `const http = instrumentHttpPort(deps.ctx.http)`, créé **par appel** ; `ctx = { ...deps.ctx, http }`.
6. Si `previousAttemptAmbiguous` : `findByMarker`.
   - `unavailable` → `to-resolve`, `lookup.unavailable` ;
   - item trouvé → l'étape 7 est sautée et `foundExisting` vaut vrai.
7. `create` ou `comment`.
8. `attach`, pour chaque fichier `via: "attachment"`, dans l'ordre des `path`.
9. Échecs des étapes 6 à 8 :
   - `ambiguous`, ou `retryable` → `retry` ;
   - `conflict` → `to-resolve`, `provider.conflict` ;
   - tout autre cas → `failed`.
10. Chaque digest déclaré par le connecteur doit figurer dans `http.sentBodyDigests`. Sinon → `failed`, `provider-error`, `delivery.receipt-digest-mismatch`.
11. Succès :
   - `requestBodyDigests` = `priorSentBodyDigests` (si `foundExisting`), puis `http.sentBodyDigests` ;
   - `rendered` = `{ rendererVersion, bodyDigest: renderedBodyDigest(body), mediaLinks }`, avec les liens effectivement rendus, triés par `path`. Chaque lien vise un fichier `transmitted` en `via: "link"`, ce qu'exige le code L1 `receipt.media_link_untransmitted` ;
   - `transmitted` et `withheld` triés par `path`, `withheld` sans digest ;
   - `completedAt` = `ctx.clock()` ;
   - `result` = `created` pour une création, `updated` pour un commentaire.

- [ ] **Tests rouges.** Faux, connecteur de référence (`referenceProfile`), `buildExportFixture`, `verdictFixture`. Valeurs exactes :
  - `first delivery creates one item, attaches the transmitted screenshot only, digests in send order` : `created` ; `items 1` ; une pièce jointe `kept-shot-a1.png` ; `requestBodyDigests` = SHA-256 des corps POST capturés, dans l'ordre ; `rendered.bodyDigest === renderedBodyDigest(rendered body)`.
  - `revision posts one comment, never a new item` : `updated`, items `1`, commentaires `1`.
  - `stale plan` (visibilité découverte `public`) → `plan.attribute-changed`, zéro `POST`.
  - `visibility read failure` → `plan.discovery-failed`, zéro `POST`.
  - `unavailable lookup after an ambiguous attempt` → `lookup.unavailable`, zéro `POST`.
  - `profile mismatch and missing remote fail before any request` : `requests.length === 0`.
  - `fails when the connector reports a body digest that the instrumented port never sent` : un talon qui renvoie `["0".repeat(64)]` → `delivery.receipt-digest-mismatch`.
  - `integrity mismatch` → `export.integrity`.
  - `link delivery without https link fails closed` → `plan.attachment-inconsistent`, zéro `POST`.
  - `link delivery records the link in rendered.mediaLinks` (GitHub, `media: "link"`).
  - `failure mapping` : `429` → `retry` avec `retryAfterMs 120000` ; `401` → `failed` ; `409` → `to-resolve` `provider.conflict` ; coupure sur `create` → `retry` `ambiguous`.
  - `manifest-view.test.ts` : le manifeste de la fixture est lu ; un manifeste tronqué, un `files` absent ou un `role` inconnu lèvent `delivery.manifest`.
- [ ] **Rouge attendu**, puis **implémenter**, puis **vert** : `bun test packages/projection-core/delivery.test.ts packages/projection-core/manifest-view.test.ts`. `bun run check:package-boundaries` : `findings=0`.
- [ ] **Neutralisation.**
  - `if (reason !== null) return toResolve(reason)` remplacé par un no-op : les tests « stale plan » et « visibility read failure » rougissent.
  - Le contrôle de l'étape 10 remplacé par `true` : le test du connecteur menteur rougit.
  - Restaurer chaque fois.
- [ ] **Commit.**
  - `git add packages/projection-core/delivery.ts packages/projection-core/manifest-view.ts packages/projection-core/delivery-types.ts packages/projection-core/delivery.test.ts packages/projection-core/manifest-view.test.ts packages/projection-core/index.ts`
  - `bun run check`
  - `git commit -s -m "feat(projection-core): execute one delivery with revalidation, marker lookup and digest checks" -m "Neutralization: ignoring the revalidation reason, or accepting connector digests, turns its tests red."`

### Task 14: `buildUnsignedReceipt`

**Files:** Create `packages/projection-core/receipt.ts` ; Modify `index.ts` ; Test `receipt.test.ts`

**Interfaces:**
- Consumes : `UnsignedReceipt` (L2, miroir du schéma L1 sans signature, `keyId` compris).
- Produces : `buildUnsignedReceipt`, à la signature du registre §4.4.

**Contenu.** Reçu plat du schéma L1 (plan L1, partie 1), sans `signature`, avec `keyId` présent une seule fois. Le compilateur impose l'alignement sur `UnsignedReceipt`.

| Propriété | Source |
| --- | --- |
| `schemaVersion` | `"libre-ai.signalement-projection-receipt.v1"` |
| `organization`, `keyId` | `job.organization`, `signing.keyId` |
| `issuedAt`, `deliveredAt` | `signing.issuedAt`, `outcome.completedAt` |
| `exportDigest`, `projectionId`, `mappingVersion` | `job.exportDigest`, `job.projectionId`, `job.mappingVersion` |
| `operation`, `revision` | `job.kind`, `job.revision` (révision du Dossier livrée, registre §4.4) |
| `destinationId`, `profileId` | `job.target.destinationId`, `job.target.profileId` |
| `remote` | `{ id: outcome.remote.remoteId, url: outcome.remote.remoteUrl }` |
| `transmitted`, `withheld` | `outcome.transmitted` (`path`, `sha256`, `via`), `outcome.withheld` (`path`, `reason`) |
| `rendered` | `outcome.rendered` (`rendererVersion`, `bodyDigest`, `mediaLinks`) |
| `requestBodyDigests` | `outcome.requestBodyDigests` |
| `policy` | `{ version: job.plan.policyVersion, digest: job.plan.policyDigest }` |
| `approval` | `{ reference: job.approvalRef }` |

L'identifiant du reçu est hors contrat : c'est L4 qui le gère.

Erreurs, alignées sur les codes du vérificateur L1 pour que rien ne parte vers la signature qu'il refuserait :
- horodatage hors du format `timestamp`, fractions de seconde comprises → `receipt.timestamp` ;
- `deliveredAt` > `issuedAt` → `receipt.timestamp-order` ;
- `keyId` hors de `^[a-z0-9][a-z0-9-]{0,63}$` → `receipt.key-id` ;
- `requestBodyDigests` vide → `receipt.no-body-digest` (le schéma exige 1 à 64 entrées) ;
- un `mediaLinks.path` absent de `transmitted` en `via: "link"` → `receipt.media-link-untransmitted`.

- [ ] **Tests rouges.**
  - `receipt carries the exact delivery facts` : chaque information du tableau, à partir d'un `DeliverySuccess` obtenu par `executeDelivery` sur le faux.
  - `receipt is deterministic` : JCS de deux appels, octets égaux.
  - `withheld entries carry no digest and do not overlap transmitted ones` : aucun SHA-256 de `held-shot-b2` dans `canonicalJson(receipt)`.
  - `rendered lets L7 recompute the body` : `renderedBodyDigest(renderBody(profileId, input reconstruit à partir du reçu et de l'export).body) === receipt.rendered.bodyDigest`. L'entrée reconstruite prend :
    - `kind` de `operation`, `revision` de `revision` (égale à celle du manifeste, assertion incluse) ;
    - `content` nul si `README.md` est retenu ;
    - `links` de `rendered.mediaLinks`, `attachedCount` = nombre de `via: "attachment"` ;
    - le marqueur de `projectionId` et de la clé d'idempotence, que L7 recalcule par `idempotencyKey(projectionId, exportDigest, mappingVersion)`, puisque le reçu ne porte pas la clé.
  - `the unsigned receipt passes the L1 verifier once a signature member is appended` : `rawProjectionReceiptFailures` sur le JCS du reçu complété par une signature factice de forme valide (`value` = 86 caractères base64url) ne rend aucun code autre que de signature. *À vérifier à l'exécution* : si le vérificateur L1 contrôle la signature elle-même, ce cas passe à la tâche 16, avec une vraie signature.
  - `refusals` : `issuedAt` `"2026-10-24T10:00:00.5Z"` → `receipt.timestamp` ; `deliveredAt` postérieur à `issuedAt` → `receipt.timestamp-order` ; `keyId` `""` et `"Key_1"` → `receipt.key-id` ; `requestBodyDigests` vide → `receipt.no-body-digest` ; un `mediaLinks` sur un fichier transmis en `attachment` → `receipt.media-link-untransmitted`.
- [ ] **Rouge attendu**, puis **implémenter**, puis **vert**.
- [ ] **Neutralisation.** `sha256` ajouté aux entrées `withheld` : le troisième test rougit. Restaurer.
- [ ] **Commit.**
  - `git add packages/projection-core/receipt.ts packages/projection-core/receipt.test.ts packages/projection-core/index.ts`
  - `bun run check`
  - `git commit -s -m "feat(projection-core): build unsigned projection receipts with rendered digest" -m "Neutralization: adding withheld digests turns the no-digest test red."`

### Task 15: Prédicats sur le faux — fuite, doublon, indépendance

**Files:** Create `packages/projection-core/predicates/harness.ts` ; Test `packages/projection-core/predicates/{destination-disclosure-leak,duplicate-external-item,fanout-independent-state}.test.ts`

**Interfaces:**
- Produces : `deliveryScenario(options: { profileId: string; documentDecision: "transmit" | "withhold"; media: "link" | "withhold"; search: "strong" | "unavailable"; extraTransmittedMedia?: boolean }): Promise<Scenario>`. `Scenario` = `{ fake, connector, job, deps, fixture }`.

- [ ] **`destination-disclosure-leak`, test rouge.**
  - Matrice : 4 profils × document {`transmit`, `withhold`} × `media` {`link`, `withhold`} = 16 cas, plus `dest-unknown-visibility`, soit 17.
  - Le mode de remise découle du profil : pièce jointe pour GitLab et Jira, lien ou retenue pour GitHub et Plane.
  - Pour chaque cas :
    - `findLeaks(fake.requests, retenues)` vaut `[]`. Les retenues : `fileNeedles` de `held-shot-b2` ; plus, si le document est retenu, chaque sentinelle et `fileNeedles` de `README.md` ;
    - **contrôle positif**, qui prouve que l'instrument lit : au moins une trouvaille sur une aiguille transmise (sentinelle `SENTINEL-OBSERVED-2a9e`, octets de `kept-shot-a1` en pièce jointe, ou URL du lien) ;
    - `expect(ran).toBe(17)`.
  - Visibilité en échec à la relecture → `to-resolve` et zéro requête avec corps.
- [ ] **`duplicate-external-item`, test rouge.**
  - `extraTransmittedMedia` sur GitLab : écritures `create`, `attach#1`, `attach#2`. Pour `k` ∈ {1, 2, 3} :
    1. faux neuf, `drop-after-send` sur la `k`-ième écriture ;
    2. tentative 1 avec `const outer = instrumentHttpPort(fake.http)`, pour imiter L4 → `retry` `ambiguous` ;
    3. tentative 2 avec `previousAttemptAmbiguous: true` et `priorSentBodyDigests: outer.sentBodyDigests` → `success` ;
    4. `items.length === 1`.
  - `serverError(…, 502, true)` sur `create` → un item.
  - `search: "unavailable"` + coupure sur `create` → tentative 2 en `to-resolve` `lookup.unavailable`, items `1`.
  - Révision avec coupure sur le commentaire, puis reprise → items `1`, commentaires `1`.
  - Rejeu d'une livraison réussie → `foundExisting`, items `1`.
  - Le reçu d'une reprise `foundExisting` contient le digest du corps de création de la tentative 1.
- [ ] **`fanout-independent-state`, test rouge.**
  - `dest-a` (GitLab), `dest-b`, `dest-c` (Plane) : un faux chacun, le même connecteur. `dest-b` reçoit `respond 401` sur `create`.
  - Exécution séquentielle, en ordre inverse, puis par `Promise.all`.
  - Assertions :
    - `dest-a` et `dest-c` réussissent avec les mêmes `requestBodyDigests` dans les trois ordres ;
    - `dest-b` rend `failed` `auth` ;
    - les digests de chaque succès sont inclus dans les corps capturés par **son** faux et disjoints de ceux des autres ;
    - depuis `dispatching`, `transition(…, outcomeEvent(o))` rend `created`, `failed`, `created`.
- [ ] **Exécuter.** `bun test packages/projection-core/predicates` : rouge tant que `harness.ts` manque, vert ensuite. Ces tests vérifient un comportement déjà acquis : leur preuve est la neutralisation.
- [ ] **Neutralisations**, sortie rouge relevée dans le commit.
  - Fuite : le filtre `decision === "transmit"` de `buildRenderInput` et de l'étape 3 remplacé par `() => true` → trouvailles `raw`, `stem` et sentinelles.
  - Doublon : `if (job.previousAttemptAmbiguous)` → `if (false)` → 2 items. La branche `unavailable` traitée comme `item: null` → le cas `unavailable` rougit.
  - Indépendance : le port instrumenté créé par appel remplacé par une instance de module unique → le test de disjonction rougit.
  - Restaurer chaque fois.
- [ ] **Commit.**
  - `git add packages/projection-core/predicates/harness.ts packages/projection-core/predicates/destination-disclosure-leak.test.ts packages/projection-core/predicates/duplicate-external-item.test.ts packages/projection-core/predicates/fanout-independent-state.test.ts`
  - `bun run check`
  - `git commit -s -m "test(projection-core): exercise disclosure-leak, duplicate-item and fan-out predicates on the fake provider" -m "Neutralization: a pass-through file filter, a disabled ambiguity lookup and a shared instrumented port each turn their predicate red."`

### Task 16: Intégration L1/L2, couverture et critère de sortie du lot

**Files:** Test `packages/projection-core/l2-integration.test.ts` ; Modify `package.json:48` (`check:core` : ajout de `packages/connector-sdk packages/projection-core packages/fake-provider`)

**Interfaces:**
- Consumes : `loadPolicyReceipt`, `PolicyReceiptApi`, `PublicKeySet`, `ReceiptVerification` (registre §4.2) ; vecteurs L1 vendorisés ; `rawProjectionReceiptFailures`, dont le chemin est résolu par `jq -r '.files | keys[]' vendor/contracts/pin.json | grep projection-receipt`.

**Précondition.** L2 fusionné, et artefact construit par `bun run build:policy-receipt` (plan L2). Sans artefact, ce test **échoue** (`loadPolicyReceipt` rejette) ; il ne se saute jamais.

- [ ] **Test rouge.**
  - `JCS of projection-core equals the WASM canonicalize` : pour les deux triplets de la tâche 8, `api.canonicalize(t)` égale octet pour octet `new TextEncoder().encode(canonicalJson(t))`.
  - `real evaluate with an absent discovery withholds, then nothing leaks`. Une politique des vecteurs L1 transmet vers une destination privée découverte. `api.evaluate(policy, { observedOrigin, files, discovered: {} })` rend `withhold` `visibility-unknown` pour chaque fichier. Puis `buildDeliveryPlan`, `executeDelivery` sur le faux, et `findLeaks` sur toutes les aiguilles → `[]`.
  - `signed receipt validates against L1 and verifies` :
    - `api.signReceipt(buildUnsignedReceipt(…, { keyId: "key-test-1", issuedAt }), seed)`, avec `seed = Uint8Array.from({ length: 32 }, (_, i) => i)` ;
    - `rawProjectionReceiptFailures(bytes)` vaut `[]` ;
    - `api.verifyReceipt(bytes, keys)` vaut `{ signature: "valid", keyId: "key-test-1", keyStatus: "active", receipt: non nul }`, où `keys` est un `PublicKeySet` de forme registre §4.2 (`organization`, une clé `ed25519` `active`, `publicKey` en base64url dérivée de `seed`, `notBefore`, `notAfter: null`) ;
    - un octet modifié donne `signature: "invalid"` et `receipt: null`.
- [ ] **Rouge attendu.** Il échoue sans artefact (constat à relever), puis sur toute divergence.
- [ ] **Corriger** ce que l'intégration révèle dans la tâche propriétaire, avec un test ajouté là. Ne jamais assouplir une assertion d'intégration.
- [ ] **Couverture.** Les trois répertoires ajoutés à `check:core`. `bun run check:core` : le seuil de 0,9 (`tools/ci/core-coverage.toml`) tient. Le relevé par fichier est copié tel quel dans la PR.
- [ ] **Neutralisation.** Dans `identity.ts`, `canonicalJson(t)` → `JSON.stringify(t, null, 1)` : la conformité JCS et les vecteurs de la tâche 8 rougissent. Restaurer.
- [ ] **Critère de sortie du lot** (feuille de route §2, ligne L3). Toutes les commandes tournent sur le même arbre indexé, et chacune est rapportée `pass`, `fail`, `unavailable` ou `blocked` :
  - `bun run check` ;
  - `bun run check:package-boundaries` : trois lignes `findings=0`, avec `files` et `specifiers` non nuls ;
  - `bun test packages/connector-sdk packages/projection-core packages/fake-provider tools/ci/package-boundary.test.ts tools/contracts/connector-profile-conformance.test.ts` : nombre de `pass`, `0 fail` ;
  - `bun test packages/projection-core/predicates` : 3 prédicats verts, `ran = 17` ;
  - `uvx reuse lint`, relevé tel quel. Ce n'est pas un gate du dépôt : un défaut hors du SDK et de `LICENSES/Apache-2.0.txt` est consigné dans la PR.
- [ ] **Commit.**
  - `git add packages/projection-core/l2-integration.test.ts package.json`
  - `bun run check`
  - `git commit -s -m "test(projection-core): prove JCS, evaluation and receipt conformance against the L2 component" -m "Neutralization: non-canonical JSON in projectionId turns the WASM conformance test red."`
