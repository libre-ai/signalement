# Signalement v1.0 — L5, partie 1 : socle, suite, GitHub (Tasks 1-5)

Index, Goal, Global Constraints et Review Focus : `docs/superpowers/plans/2026-10-24-v1-L5-connectors.md`.

### Task 1: Socle `connectors/` et classification des échecs HTTP

**Files:**
- Create: `connectors/shared/failures.ts`, `tools/ci/connectors-coverage.toml`
- Modify:
  - `tsconfig.json:18` : ajouter `"connectors/**/*.ts"` à `include` ;
  - `package.json:43` : dans `check:tree`, appeler `bun run check:connectors` après `bun run check:core` ;
  - `package.json:48` : ajouter le script `check:connectors` après `check:core`.
- Test: `connectors/shared/failures.test.ts`

**Interfaces:**
- Consumes: `ConnectorFailure`, `connectorFailure`, `parseRetryAfter` (SDK).
- Produces:

```ts
export type ConnectorFamily = "github" | "gitlab" | "jira" | "plane";
export type HttpOperation = "read" | "write"; // write = request that may change remote state
export function retryAfterMs(headers: Readonly<Record<string, string>>, now: string): number | null;
export function failureFromStatus(family: ConnectorFamily, operation: HttpOperation,
  response: { readonly status: number; readonly headers: Readonly<Record<string, string>> }, now: string): ConnectorFailure;
export function failureFromTransport(family: ConnectorFamily, operation: HttpOperation): ConnectorFailure;
```

La table prolonge la correspondance du plan L3, Task 6 (`<f>` = famille).

| Observation | `read` | `write` |
| --- | --- | --- |
| rejet de `http.send` | `transport`, `<f>.transport` | `ambiguous`, `<f>.write-unconfirmed` |
| 500, 502, 503, 504 | `provider-error` réessayable, `<f>.http-5xx` | `ambiguous`, `<f>.http-5xx-write` |
| 429 ; 403 avec `retry-after` ou `x-ratelimit-remaining: 0` | `rate-limited`, `<f>.rate-limited` | idem |
| 401 / 403 sinon | `auth`, `<f>.unauthorized` / `<f>.forbidden` | idem |
| 404 / 410 | `not-found`, `<f>.not-found` / `<f>.gone` | idem |
| 409 | `conflict`, `<f>.conflict` | idem |
| 400, 422 | `invalid-mapping`, `<f>.rejected` | idem |
| 413 | `unsupported`, `<f>.payload-too-large` | idem |
| 301, 302, 303, 307, 308 | `provider-error`, `<f>.redirect-refused` | idem |
| autre | `provider-error`, `<f>.unexpected-status` | idem |

Calcul de `retryAfterMs`, dans l'ordre :
1. `parseRetryAfter(headers["retry-after"], now)` ;
2. à défaut, `x-ratelimit-reset` (limite primaire de GitHub, secondes epoch, motif `^\d{1,12}$`), converti en délai et borné à `[0, 86_400_000]` ;
3. à défaut, `null`.

Un `rate-limited` sans indication prend `60_000`. Hors `rate-limited` et 5xx, `retryAfterMs` vaut `null`.

- [ ] **Step 1: Écrire le test qui échoue**

```ts
import { describe, expect, test } from "bun:test";
import { failureFromStatus, failureFromTransport, retryAfterMs } from "./failures.ts";

const NOW = "2026-10-24T12:00:00.000Z";
const r = (status: number, headers: Record<string, string> = {}) => ({ status, headers });

describe("failureFromStatus", () => {
  test("5xx on a write is ambiguous, never a plain retry", () => {
    expect(failureFromStatus("github", "write", r(502), NOW)).toEqual({
      kind: "ambiguous", retryable: true, retryAfterMs: null, code: "github.http-5xx-write" });
  });
  test("5xx on a read is a retryable provider error", () => {
    expect(failureFromStatus("gitlab", "read", r(503), NOW)).toEqual({
      kind: "provider-error", retryable: true, retryAfterMs: null, code: "gitlab.http-5xx" });
  });
  test("a 403 with retry-after is a secondary rate limit", () => {
    expect(failureFromStatus("github", "write", r(403, { "retry-after": "30" }), NOW)).toEqual({
      kind: "rate-limited", retryable: true, retryAfterMs: 30_000, code: "github.rate-limited" });
  });
  test("a 403 without rate-limit headers is an auth failure; a 429 without hint waits 60 s", () => {
    expect(failureFromStatus("jira", "read", r(403), NOW).code).toBe("jira.forbidden");
    expect(failureFromStatus("plane", "read", r(429), NOW).retryAfterMs).toBe(60_000);
  });
  test.each([
    [301, "provider-error", "github.redirect-refused"], [400, "invalid-mapping", "github.rejected"],
    [401, "auth", "github.unauthorized"], [404, "not-found", "github.not-found"],
    [409, "conflict", "github.conflict"], [410, "not-found", "github.gone"],
    [413, "unsupported", "github.payload-too-large"], [418, "provider-error", "github.unexpected-status"],
  ] as const)("status %d maps to %s", (status, kind, code) => {
    expect(failureFromStatus("github", "write", r(status), NOW)).toMatchObject({ kind, code, retryable: false });
  });
});
test("a lost write is ambiguous, a lost read is transport", () => {
  expect(failureFromTransport("gitlab", "write")).toMatchObject({ kind: "ambiguous", code: "gitlab.write-unconfirmed" });
  expect(failureFromTransport("jira", "read")).toMatchObject({ kind: "transport", code: "jira.transport" });
});
test("x-ratelimit-reset is honoured and bounded", () => {
  expect(retryAfterMs({ "x-ratelimit-reset": String(Date.parse(NOW) / 1000 + 90) }, NOW)).toBe(90_000);
  expect(retryAfterMs({ "x-ratelimit-reset": "99999999999" }, NOW)).toBe(86_400_000);
  expect(retryAfterMs({ "retry-after": "soon" }, NOW)).toBeNull();
});
```

- [ ] **Step 2: Rouge** — `bun test connectors/shared/failures.test.ts` ; attendu : module `./failures.ts` introuvable.
- [ ] **Step 3: Implémenter** `connectors/shared/failures.ts` selon la table, sans jamais lire le corps de réponse.
- [ ] **Step 4: Câbler**
  - `tsconfig.json` : l'ajout à `include` ;
  - `tools/ci/connectors-coverage.toml` : copie de `tools/ci/core-coverage.toml` avec `coverageDir = "./coverage/connectors"` et un seuil de `0.9` ;
  - `package.json` : le script `"check:connectors": "bun run check:bun:runtime && bun test --config=tools/ci/connectors-coverage.toml connectors"`, et son appel dans `check:tree`.
- [ ] **Step 5: Vert** — `git add` des fichiers, puis `bun run typecheck && bun run check:connectors` ; attendu : `0 fail`, couverture ≥ 0.9.
- [ ] **Step 6: Neutraliser** — dans la ligne 5xx, remplacer le choix `write ? ambiguous : provider-error` par `provider-error`. Attendu : « 5xx on a write is ambiguous » rouge. Restaurer.
- [ ] **Step 7: Commit**

```bash
git add connectors/shared/failures.ts connectors/shared/failures.test.ts tools/ci/connectors-coverage.toml tsconfig.json package.json
bun run check
git commit -s -m "feat(connectors): classify provider HTTP failures with ambiguous writes" -m "Neutralization: mapping a 5xx write to provider-error turns the ambiguous-write test red."
```

### Task 2: Primitives partagées

**Files:**
- Create: `connectors/shared/{json,urls,cursor,multipart,upload-name}.ts`
- Test: un `*.test.ts` par fichier

**Interfaces:**
- Consumes: `Result`, `ok`, `err`, `ConnectorFailure`, `connectorFailure` (SDK) ; `ConnectorFamily` (Task 1).
- Produces:

```ts
// json.ts
export const MAX_JSON_BYTES = 8_388_608; // = maxResponseBytes given to createFetchHttpPort
export function readJson(family: ConnectorFamily, body: Uint8Array): Result<unknown, ConnectorFailure>; // "<f>.malformed-response"
export function stringField(value: unknown, key: string, pattern?: RegExp): string | null;
export function integerField(value: unknown, key: string): number | null;
// urls.ts
export function checkedRemoteUrl(family: ConnectorFamily, candidate: unknown, expectedPrefix: string): Result<string, ConnectorFailure>; // "<f>.untrusted-remote-url"
export function isLoopbackHttp(url: URL): boolean; // http: on localhost, 127.0.0.1 or [::1]
export function joinPath(base: string, segments: readonly string[], query?: Readonly<Record<string, string>>): string;
// cursor.ts
export function encodeCursor(value: Readonly<Record<string, string | number>>): string; // "v1." + base64url(JSON, sorted keys)
export function decodeCursor(family: ConnectorFamily, cursor: string | null): Result<Record<string, string | number> | null, ConnectorFailure>; // "<f>.invalid-cursor"
// multipart.ts
export interface MultipartPart { readonly name: string; readonly filename: string | null; readonly contentType: string | null; readonly bytes: Uint8Array; }
export function buildMultipart(parts: readonly MultipartPart[]): Promise<Result<{ contentType: string; body: Uint8Array<ArrayBuffer> }, "invalid-part-header">>;
// upload-name.ts
export function uploadFilename(bytes: Uint8Array, mimeType: string): Promise<string | null>; // "attachment-<sha256[0..12]>.<ext>"
```

Valeurs fixées :
- **`checkedRemoteUrl`.** Il accepte une chaîne de moins de 2048 caractères, analysable par `new URL`, en `https:` ou en `http:` de bouclage, sans `username` ni `password`, avec `url.href.startsWith(expectedPrefix)`. Tout le reste donne `provider-error`, non réessayable.
- **`joinPath`.** Il encode chaque segment par `encodeURIComponent`, par défense en profondeur : les segments sont déjà validés par `parse<Famille>Target`.
- **Curseur.** 2048 caractères au plus, préfixe `v1.` exigé.
- **Frontière multipart.** Elle vaut `"signalement-"` suivi des 32 premiers caractères hexadécimaux du SHA-256 de la concaténation des parties. Elle est vérifiée absente de chaque partie ; sinon, on ajoute un suffixe `-1`, `-2`, etc. Motifs exigés :
  - `name` et `filename` : `^[A-Za-z0-9._-]{1,128}$` ;
  - `contentType` : `^[a-z]+/[a-z0-9.+-]+$`.
- **`uploadFilename`.** Correspondance `text/markdown → md`, `image/png → png`, `video/webm → webm`, `video/mp4 → mp4` ; tout autre type rend `null`. Le nom de fichier de l'export n'est jamais transmis à un fournisseur.

- [ ] **Step 1: Écrire les tests qui échouent** (extraits porteurs, plus un cas nominal par fonction)

```ts
test("checkedRemoteUrl rejects another origin, javascript:, userinfo and look-alike prefixes", () => {
  // userinfo URL assembled at runtime: the boundary gate scans tracked test files
  const userinfo = ["https://", "u", ":", "p", "@", "github.com/libre-ai/x/issues/1"].join("");
  for (const candidate of ["https://evil.example/libre-ai/x/issues/1", "javascript:alert(1)", userinfo,
    "https://github.com/libre-ai/x/issues-evil/1", 42, null]) {
    expect(checkedRemoteUrl("github", candidate, "https://github.com/libre-ai/x/issues/")).toEqual({ ok: false,
      error: { kind: "provider-error", retryable: false, retryAfterMs: null, code: "github.untrusted-remote-url" } });
  }
});
test("joinPath encodes traversal segments", () => {
  expect(joinPath("https://api.github.com", ["repos", "../x", "y"])).toBe("https://api.github.com/repos/..%2Fx/y");
});
test("cursor round-trips and rejects tampering", () => {
  const cursor = encodeCursor({ since: "2026-10-24T00:00:00Z", page: 2 });
  expect(decodeCursor("gitlab", cursor)).toEqual({ ok: true, value: { page: 2, since: "2026-10-24T00:00:00Z" } });
  expect(decodeCursor("gitlab", "v2.e30").ok).toBe(false);
  expect(decodeCursor("gitlab", `v1.${"A".repeat(2048)}`).ok).toBe(false);
});
test("multipart is deterministic and refuses a header-injecting filename", async () => {
  const part = { name: "file", filename: "attachment-0123456789ab.png", contentType: "image/png", bytes: new TextEncoder().encode("synthetic") };
  expect(await buildMultipart([part])).toEqual(await buildMultipart([part]));
  expect(await buildMultipart([{ ...part, filename: "a\r\nx-evil: 1" }])).toEqual({ ok: false, error: "invalid-part-header" });
});
test("readJson refuses oversized and non-UTF-8 bodies", () => {
  expect(readJson("jira", new Uint8Array(MAX_JSON_BYTES + 1)).ok).toBe(false);
  expect(readJson("jira", new Uint8Array([0xff, 0xfe]))).toMatchObject({ ok: false, error: { code: "jira.malformed-response" } });
});
test("upload filename is derived from content, never from the export path", async () => {
  expect(await uploadFilename(new TextEncoder().encode("{}"), "image/png")).toBe("attachment-44136fa355b3.png");
  expect(await uploadFilename(new Uint8Array(1), "application/x-sh")).toBeNull();
});
```

- [ ] **Step 2: Rouge** — `bun test connectors/shared` ; attendu : modules introuvables.
- [ ] **Step 3: Implémenter** les cinq fichiers.
- [ ] **Step 4: Vert** — `bun test connectors/shared` ; attendu : `0 fail`.
- [ ] **Step 5: Neutraliser** — deux substitutions, une à la fois, puis restaurer :
  - remplacer `url.href.startsWith(expectedPrefix)` par `true` : le test d'origine rougit ;
  - remplacer la validation de `filename` par `true` : le test multipart rougit.
- [ ] **Step 6: Commit** — `git add connectors/shared`, puis `bun run check`, puis :

```bash
git commit -s -m "feat(connectors): add bounded JSON, untrusted URL, cursor and multipart primitives" -m "Neutralization: accepting any prefix in checkedRemoteUrl turns the origin test red."
```

### Task 3: Noyau de la suite de conformité

**Files:**
- Create: `connectors/conformance/{cases,hypothesis,job,recording-http,harness}.ts`
- Test: `connectors/conformance/{cases,hypothesis,job,recording-http}.test.ts`

**Interfaces:**
- Consumes:
  - SDK : `Connector`, `ConnectorProfile`, `HttpPort`, `OutboundRequest`, `SecretHandle`, `DestinationTarget`, `RemoteItemRef`, `lookupOf` ;
  - projection-core (plan L3, Tasks 7-12) : `executeDelivery`, `DeliveryJob`, `buildDeliveryPlan`, `projectionId`, `idempotencyKey`, `verdictFixture` ;
  - fake-provider (plan L3, Task 5) : `createFakeProvider`, `FakeDialect`, `FakeFault`, `CapturedRequest`, `serverError`, `rateLimited`, `findLeaks`, `fileNeedles`, `buildExportFixture`.
- Produces:

```ts
// cases.ts
export const CONFORMANCE_SUITE_VERSION = "1"; // bumped by any change to CONFORMANCE_CASES
export type ConformanceMode = "fake" | "live";
export type CaseResult = "pass" | "fail" | "unavailable" | "blocked";
export interface ConformanceCase { readonly id: string; readonly modes: readonly ConformanceMode[]; readonly statement: string; }
export const CONFORMANCE_CASES: readonly ConformanceCase[]; // literal `as const satisfies readonly ConformanceCase[]`
export type ConformanceCaseId = (typeof CONFORMANCE_CASES)[number]["id"];
export function requiredCaseIds(mode: ConformanceMode): readonly ConformanceCaseId[];
// hypothesis.ts
export function asHypothesis(profile: ConnectorProfile): ConnectorProfile; // every "unproven" capability → "supported"; tests and qualification only
export function resolvesOnlyUnproven(baseline: ConnectorProfile, published: ConnectorProfile): readonly string[]; // offending JSON paths
// job.ts
export interface ConformanceJobInput { readonly target: DestinationTarget; readonly kind: "create" | "comment"; readonly remote: RemoteItemRef | null;
  readonly previousAttemptAmbiguous: boolean; readonly notBefore: string; readonly documentDecision: "transmit" | "withhold";
  readonly media: "link" | "withhold"; readonly revision: number; }
export function buildConformanceJob(input: ConformanceJobInput): Promise<DeliveryJob>; // only file that knows the DeliveryJob shape
// recording-http.ts
export class InjectedCut extends Error {}
export interface CutRule { readonly match: (request: OutboundRequest, seq: number) => boolean; readonly when: "before-send" | "after-send"; }
export function recordingHttpPort(inner: HttpPort): { readonly http: HttpPort; captured(): readonly CapturedRequest[]; cut(rule: CutRule | null): void; clear(): void };
// harness.ts
export interface RemoteObserver { itemsWithMarker(markerText: string): Promise<number | null>; commentsWithMarker(item: RemoteItemRef, markerText: string): Promise<number | null>; }
export interface FaultControl { inject(fault: FakeFault): void; tamperRemoteUrl(): void; } // fake mode only
export interface ConformanceSubject { readonly connector: Connector; readonly target: DestinationTarget; readonly invalidTarget: DestinationTarget; readonly nonconformantTarget: DestinationTarget; }
export interface ConformanceEnvironment { readonly mode: ConformanceMode; readonly http: HttpPort; readonly credential: SecretHandle; readonly secretValues: readonly string[];
  readonly clock: () => string; readonly observer: RemoteObserver; readonly faults: FaultControl | null; readonly providerCapture: (() => readonly CapturedRequest[]) | null; }
export interface CaseReport { readonly id: ConformanceCaseId; readonly result: CaseResult; readonly requests: number; readonly durationMs: number; readonly failureCode: string | null; }
export function runConformance(subject: ConformanceSubject, env: ConformanceEnvironment, caseIds: readonly ConformanceCaseId[]): Promise<readonly CaseReport[]>;
```

Le catalogue compte 26 identifiants (la ligne `mapping-valid` / `mapping-invalid` en porte deux). Une écriture désigne une requête `POST`, `PUT` ou `PATCH`. La colonne de droite est l'assertion codée par `harness.ts`.

| id | modes | assertion codée par `harness.ts` |
| --- | --- | --- |
| `discovery` | fake, live | réussit ; `attributes.visibility` découverte (GitHub, GitLab) ou `null` (Jira, Plane) |
| `discovery-nonconformant-instance` | fake, live | `discover(nonconformantTarget)` → `unsupported`, `<f>.instance-nonconformant`, aucune écriture |
| `discovery-visibility-read-failure` | fake, live | coupure `before-send` sur la lecture de visibilité pendant `rediscover` → `to-resolve`, aucune écriture |
| `mapping-valid` / `mapping-invalid` | fake, live | `ok({ valid: true, issues: [] })` / `valid: false` ou `not-found` sur `invalidTarget` |
| `create-first-delivery` | fake, live | `success`, `result: "created"`, `itemsWithMarker === 1` |
| `recover-adopts-existing-item` | fake, live | après un succès, même job ambigu → aucune création, `foundExisting: true`, même `remoteId` ; `to-resolve` si `lookupOf(profile) === "unavailable"` |
| `recover-ignores-foreign-marker` | fake | un item d'un autre auteur porte le marqueur → non adopté |
| `recover-respects-not-before` | fake | un item à marqueur, créé avant `notBefore` moins la tolérance, n'est ni lu au-delà de la borne ni adopté ; la liste s'arrête à la borne |
| `attach-existing-item` | fake, live | livraison `comment` sur un `remote` connu → aucune création, un commentaire |
| `attachment-or-declared-fallback` | fake, live | profil en `upload` : une pièce jointe par média transmis ; sinon aucune requête de téléversement, repli `link` dans le corps |
| `comment-revision` | fake, live | `commentsWithMarker === 1`, `result: "updated"` |
| `read-changes-cursor` | fake, live | pages suivies jusqu'à `nextCursor === null` ; chaque item créé apparaît ; reprise sans perte depuis un curseur intermédiaire |
| `resume-after-cut-discovery` | fake, live | coupure `after-send` sur la première lecture → `retry`, puis `success`, un item |
| `resume-after-cut-create` | fake, live | coupure `after-send` sur la création, reprise ambiguë → un item exactement ; ou `to-resolve` sans nouvelle création si `lookup` vaut `unavailable` |
| `resume-after-cut-create-5xx` | fake | `serverError(match, 502, true)` sur la création → même assertion |
| `resume-after-cut-attach` | fake, live | au plus une pièce jointe par média et par item |
| `resume-after-cut-comment` | fake, live | au plus un commentaire portant le marqueur, ou `to-resolve` |
| `declared-conflict` | fake, live | révision sur un item disparu → `to-resolve` ou `failed`, **aucune création** |
| `rate-limit-typed` | fake | `rateLimited(match, 30)` → `retry`, `rate-limited`, `retryAfterMs === 30_000` |
| `remote-url-untrusted-refused` | fake | URL altérée par le dialecte → `failed`, `<f>.untrusted-remote-url` |
| `predicate-duplicate-external-item` | fake, live | coupure `after-send` sur chaque écriture tour à tour, puis reprise → `itemsWithMarker ≤ 1` à chaque tour |
| `predicate-destination-disclosure-leak` | fake, live | média `held-shot-b2` retenu → `findLeaks(captured, fileNeedles(...))` vide ; en mode faux, aussi sur `providerCapture()` (second point de capture) |
| `secret-never-emitted` | fake, live | aucune valeur de `secretValues` dans un `failureCode`, un `DeliveryOutcome` sérialisé, un `CaseReport` ou la sortie console capturée |
| `live-recovery-read-consistency` | live | `LIVE_RECOVERY_SAMPLES = 20` créations, chacune suivie d'un `findByMarker` immédiat : 20/20 trouvés au premier appel si `lookup` vaut `strong` ; sinon 20/20 `unavailable`, sans requête |
| `live-cleanup` | live | items créés = supprimés + fermés-conservés ; `failed === 0` |

Algorithmes que les signatures ne déterminent pas :

- **`recordingHttpPort`.**
  - Il construit pour chaque requête un `CapturedRequest` en mémoire, consommable par `findLeaks` : copie du corps, et `authHeader` réduit au nom de l'en-tête, jamais sa valeur. Rien n'est écrit sur disque.
  - Une coupure `before-send` rejette par `InjectedCut` sans appeler `inner`.
  - Une coupure `after-send` attend `inner.send`, puis rejette par `InjectedCut`.
  - Le même enveloppement sert les deux modes.
- **`buildConformanceJob`.**
  - Il part de `buildExportFixture()` : le média `kept-shot-a1` est transmis, `held-shot-b2` est retenu.
  - Le verdict vient de `verdictFixture`, restreint à une destination imposée portant `target.destinationId` et `target.profileId`. Le plan vient de `buildDeliveryPlan`.
  - Identifiants : `projectionId("org-conformance", "dossier-fixture", destinationId)`, puis `idempotencyKey(…, exportDigest, "1")`.
  - Le marqueur porte `notBefore = input.notBefore`.
  - `currentPolicy` vaut `approved` ; `mediaLinks` porte une URL `https://control-plane.invalid/artifacts/<path>` par média.
- **`runConformance`.**
  - Il appelle `executeDelivery(job, deps)` avec :
    - `deps.ctx = { http: env.http, credential: env.credential, clock: env.clock }` ;
    - `deps.readFile`, qui sert les octets de la fixture ;
    - `deps.rediscover = () => subject.connector.discover(subject.target, deps.ctx)`.
  - Un prérequis manquant rend `blocked`. Une `FaultControl` absente en mode réel rend `unavailable`. Un cas ne rend jamais `pass` par défaut.
- **`asHypothesis`.** Il remplace chaque `"unproven"` de `capabilities` par `"supported"`, `consistentLookup.status` compris.
- **`resolvesOnlyUnproven`.** Il n'admet une différence avec la référence que dans deux cas :
  - la référence vaut `unproven` et la valeur publiée est `supported` ou `unsupported` ;
  - la référence vaut `null` dans `providerVersion` ou dans `limits.*`, et la valeur publiée est renseignée.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
test("26 unique ids; live requires both predicates and cleanup; fake excludes live-only cases", () => {
  expect(new Set(CONFORMANCE_CASES.map((c) => c.id)).size).toBe(26);
  expect(requiredCaseIds("live")).toEqual(expect.arrayContaining(["predicate-duplicate-external-item",
    "predicate-destination-disclosure-leak", "live-recovery-read-consistency", "live-cleanup"]));
  expect(requiredCaseIds("fake")).not.toContain("live-cleanup");
  expect(requiredCaseIds("live")).not.toContain("rate-limit-typed");
});
test("a published profile may only resolve unproven cells", () => {
  const baseline = profileFixture({ attachmentUpload: "unproven", providerVersion: null });
  expect(resolvesOnlyUnproven(baseline, { ...baseline, providerVersion: "v9" })).toEqual([]);
  expect(resolvesOnlyUnproven(profileFixture({ attachmentUpload: "unsupported" }), profileFixture({ attachmentUpload: "supported" })))
    .toEqual(["capabilities.attachmentUpload"]);
});
test("after-send cut reaches the inner port, then loses the response; capture keeps no secret", async () => {
  let delivered = 0;
  const recording = recordingHttpPort({ send: async () => { delivered += 1;
    return { status: 201, headers: {}, body: new Uint8Array(), requestBodyDigest: null }; } });
  recording.cut({ match: () => true, when: "after-send" });
  await expect(recording.http.send({ method: "POST", url: "https://api.github.com/repos/o/r/issues", headers: {},
    body: new TextEncoder().encode("{}"), auth: { header: "authorization", prefix: "Bearer ",
      secret: SecretHandle.fromString("test-token-not-a-secret") } })).rejects.toBeInstanceOf(InjectedCut);
  expect(delivered).toBe(1);
  expect(recording.captured()[0]?.authHeader).toBe("authorization");
  expect(JSON.stringify(recording.captured())).not.toContain("test-token-not-a-secret");
});
test("the conformance job withholds held-shot-b2, transmits kept-shot-a1 and carries notBefore", async () => { /* plan decisions, marker.notBefore */ });
```

- [ ] **Step 2: Rouge** — `bun test connectors/conformance` ; attendu : modules introuvables.
- [ ] **Step 3: Implémenter** les cinq fichiers. `harness.ts` code chaque ligne du catalogue.
- [ ] **Step 4: Vert** — attendu : `0 fail`.
- [ ] **Step 5: Neutraliser** — deux substitutions, une à la fois, puis restaurer :
  - dans la branche `after-send`, remplacer l'appel à `inner.send` par un rejet immédiat : le test de coupure rougit ;
  - faire admettre toute différence à `resolvesOnlyUnproven` : le second test rougit.
- [ ] **Step 6: Commit** — `git add connectors/conformance`, puis `bun run check`, puis :

```bash
git commit -s -m "feat(conformance): add case catalog, cut injection and hypothesis profiles" -m "Neutralization: rejecting before the inner send turns the after-send cut test red."
```

### Task 4: Connecteur GitHub Issues

**Files:**
- Create: `connectors/github-issues/{profile,target,requests,connector,hypotheses,index}.ts`
- Test: `connectors/github-issues/{profile,target,requests,connector}.test.ts`

**Interfaces:**
- Consumes :
  - Tasks 1-3 et le SDK ;
  - L1 : `rawConnectorProfileFailures` (`vendor/contracts/tools/quality/signalement-connector-profile-v1.ts`) et la fixture `vendor/contracts/contracts/fixtures/signalement-connector-profile-v1/profiles.v1.json`.
- Produces :
  - `githubIssuesProfile`, `createGithubIssuesConnector(profile): Connector`, et `githubIssuesConnector`, lié au profil publié ;
  - `parseGithubTarget(target): Result<{ owner: string; repo: string }, ConnectorFailure>` ;
  - `GITHUB_TARGET_COORDINATES: readonly ["owner", "repo"]` ;
  - `GITHUB_HYPOTHESES: readonly { id: string; statement: string; coveredBy: ConformanceCaseId }[]`.

**Profil.** C'est l'entrée GitHub de la fixture : `attachmentUpload: "unsupported"`, `visibility: "discovered"`, `consistentLookup { issue-list, unproven }`, `bodyFormat: "markdown-gfm"`, `auth.mode: "fine-grained-token"`. Jeton à grain fin limité au seul dépôt cible, avec `Metadata: read` et `Issues: read and write`.

Appels. La documentation a été lue le 2026-10-24, sauf mention « non relue ».

| Opération | Requête | Source |
| --- | --- | --- |
| commun | en-têtes `accept: application/vnd.github+json`, `x-github-api-version: 2022-11-28`, `user-agent: libre-ai-signalement` ; `auth: { header: "authorization", prefix: "Bearer ", secret: ctx.credential }` | https://docs.github.com/en/rest/about-the-rest-api/api-versions (« Requests without the `X-GitHub-Api-Version` header will default to use the `2022-11-28` version » ; « … you will receive a `410 Gone` response ») |
| découverte | `GET /repos/{owner}/{repo}` → `visibility`, `has_issues` | https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens |
| auteur | `GET /user` → `id`, `login` | https://docs.github.com/en/rest/users, section « Get the authenticated user » (non relue ; H-GH-4) |
| création | `POST /repos/{owner}/{repo}/issues` `{ title, body }` → 201, `number`, `html_url`, `user.id`, `created_at` | https://docs.github.com/en/rest/issues/issues |
| commentaire | `POST /repos/{owner}/{repo}/issues/{number}/comments` `{ body }` → 201 | https://docs.github.com/en/rest/issues/comments (non relue) |
| reprise d'item | `GET /repos/{owner}/{repo}/issues?state=all&creator=<login>&sort=created&direction=desc&per_page=100&page=N` ; entrées porteuses de `pull_request` ignorées ; jamais l'API de recherche | https://docs.github.com/en/rest/issues/issues (« may return both issues and pull requests ») |
| reprise de commentaire | `GET /repos/{owner}/{repo}/issues/{number}/comments?since=<floor>&per_page=100&page=N` | https://docs.github.com/en/rest/issues/comments (non relue) |
| changements | `GET /repos/{owner}/{repo}/issues?state=all&sort=updated&direction=asc&since=<ts>&per_page=100&page=N` ; page suivante tant que l'en-tête `link` contient `rel="next"` | https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api (non relue) |

Règles fixées :
- **`parseGithubTarget`.**
  - `baseUrl` doit valoir `https://api.github.com`, sinon `unsupported`/`github.instance-nonconformant`, sans requête.
  - `owner` doit apparier `^[A-Za-z0-9-]{1,39}$` et `repo` `^[A-Za-z0-9._-]{1,100}$`, sinon `invalid-mapping`/`github.invalid-target`.
- **`discover`.**
  - Un 410 rend `github.instance-nonconformant`.
  - Si l'en-tête `x-github-api-version-selected` est présent et diffère de `2022-11-28`, même échec (H-GH-2).
  - `visibility` est rendue telle quelle (`private`, `internal` ou `public`) ; la politique traite `internal` comme public.
- **`validateMapping`.** `has_issues === false` rend `valid: false` avec `issues: [{ field: "has_issues", code: "github.issues-disabled" }]`.
- **`findByMarker`.** Algorithme :

```
si lookupOf(profile) === "unavailable" → ok({ consistency: "unavailable" }) sans requête
floor ← Date.parse(marker.notBefore) − 300_000
viewer ← GET /user                                          (échec → failureFromStatus read)
si marker.within ≠ null : balayer les commentaires de within.remoteId depuis floor, budget 10 pages
  commentaire de viewer contenant marker.text → strong, { kind: "comment", … }
sinon : balayer la liste creator=<login> par création décroissante, budget GITHUB_RECOVERY_MAX_PAGES = 10
  item avec created_at < floor → strong, null (borne atteinte)
  item sans pull_request, user.id = viewer.id, body ⊇ marker.text → strong, { kind: "item", … }
pas de rel="next" → strong, null ; budget épuisé → unavailable
```

- **`create` et `comment`.**
  - Le contenu doit être au format `markdown` ; tout autre format rend `invalid-mapping`/`github.content-format`, sans requête.
  - `html_url` est validée contre `https://github.com/{owner}/{repo}/issues/`.
  - `remoteId` vaut le numéro de l'issue, ou l'`id` du commentaire.
  - Un commentaire qui reçoit 404 ou 410 rend `conflict`/`github.remote-item-missing`.
- **`attach`.** Rend `unsupported`/`github.attachments-unsupported`, sans appeler `ctx.http`.
- **`readChanges`.** Le curseur vaut `encodeCursor({ since, page })`. Après la dernière page, `since` prend le plus grand `updated_at` vu, et `page` revient à 1. `RemoteChange` ne porte que `remote`, `status` et `updatedAt`.
- **Hypothèses.**
  - H-GH-1 : liste filtrée fortement cohérente, prouvée par `live-recovery-read-consistency` ;
  - H-GH-2 : en-tête `x-github-api-version-selected` renvoyé, par `discovery` ;
  - H-GH-3 : les deux permissions suffisent, par `create-first-delivery` ;
  - H-GH-4 : `GET /user` accessible au jeton à grain fin, par `recover-adopts-existing-item`.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
test("github profile equals the L1 baseline up to resolved unproven cells, and is schema-valid", async () => {
  const fixture = (await Bun.file("vendor/contracts/contracts/fixtures/signalement-connector-profile-v1/profiles.v1.json").json())
    .profiles.find((p: { profileId: string }) => p.profileId === "github-issues/github.com/rest-2022-11-28");
  expect(resolvesOnlyUnproven(fixture, githubIssuesProfile)).toEqual([]);
  expect(rawConnectorProfileFailures(new TextEncoder().encode(JSON.stringify(githubIssuesProfile)))).toEqual([]);
});
test("create request pins the API version, carries title and body, and auth as a handle", () => {
  const secret = SecretHandle.fromString("test-token-not-a-secret");
  const request = createIssueRequest({ owner: "libre-ai", repo: "qualif" }, { format: "markdown", title: "T", text: "B" }, secret);
  expect(request.url).toBe("https://api.github.com/repos/libre-ai/qualif/issues");
  expect(request.headers).toEqual({ accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28",
    "user-agent": "libre-ai-signalement", "content-type": "application/json" });
  expect(request.auth).toEqual({ header: "authorization", prefix: "Bearer ", secret });
});
test("recovery list filters by creator and never uses the search API", () => {
  expect(listIssuesRequest({ owner: "o", repo: "r" }, { creator: "bot", page: 1 }, secret()).url)
    .toBe("https://api.github.com/repos/o/r/issues?state=all&creator=bot&sort=created&direction=desc&per_page=100&page=1");
});
test("findByMarker ignores an item carrying the marker but authored by another account", async () => { /* viewer 1, issue user.id 2 → strong, null */ });
test("findByMarker stops at notBefore minus the tolerance", async () => { /* page 1 ends with an issue created before the floor → strong, null, page 2 never requested */ });
test("findByMarker skips pull requests and is unavailable once the page budget is exhausted", async () => { /* … */ });
test("findByMarker with within searches comments only", async () => { /* only /issues/7/comments requested; kind "comment" */ });
test("the published profile never looks up: unproven lookup is unavailable without request", async () => { /* githubIssuesConnector → zero calls */ });
test("attach sends nothing; a non-github base URL is refused before any request", async () => { /* … */ });
```

- [ ] **Step 2: Rouge** — `bun test connectors/github-issues` ; attendu : modules introuvables.
- [ ] **Step 3: Implémenter** le module.
- [ ] **Step 4: Vert** — attendu : `0 fail`.
- [ ] **Step 5: Neutraliser** — trois substitutions, une à la fois, puis restaurer :
  - remplacer `user.id === viewer.id` par `true` : le test d'auteur étranger rougit ;
  - remplacer la comparaison à `floor` par `false` : le test `notBefore` rougit ;
  - remplacer le test `pull_request` par `false` : le test des pull requests rougit.
- [ ] **Step 6: Commit** — `git add connectors/github-issues`, puis `bun run check`, puis :

```bash
git commit -s -m "feat(connectors): add GitHub Issues connector for the pinned REST profile" -m "Neutralization: dropping the author check turns the foreign-marker test red."
```

### Task 5: Dialecte GitHub, conformance sur le faux, preuves de discrimination de la suite

**Files:**
- Create: `connectors/conformance/dialects/github.ts`
- Test: `connectors/conformance/github.conformance.test.ts`, `connectors/conformance/negative.test.ts`

**Interfaces:**
- Consumes: Tasks 3-4 ; `FakeDialect`, `FakeStore`, `ParsedFakeRequest`, `FakeReply` (L3).
- Produces: `githubDialect(options: { visibility: "public" | "private" | "internal"; hasIssues: boolean; viewer: { id: number; login: string }; foreignMarker: string | null; staleMarkerBeforeFloor: boolean; tamperUrls: boolean }): FakeDialect & { observer(store: FakeStore): RemoteObserver }`.

Comportements scriptés sur le `FakeStore` de L3 (`destinationKey` = `owner/repo`, numéros d'issue tenus par le dialecte) :
- 201 à la création ;
- liste triée par création décroissante, avec une pull request intercalée et un `link` toutes les 100 entrées ;
- 410 si `x-github-api-version` diffère de `2022-11-28`, et `x-github-api-version-selected` renvoyé ;
- lecture immédiatement cohérente (H-GH-1), avec `search: "strong"` ;
- 404 sur le commentaire d'une issue absente ;
- URL altérée si `tamperUrls` ;
- avec `staleMarkerBeforeFloor`, une issue portant le marqueur, créée avant la borne.

Chaque comportement porte en commentaire son URL de documentation ou son identifiant d'hypothèse.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
for (const caseId of requiredCaseIds("fake")) {
  test(`github-issues passes ${caseId} on the fake provider`, async () => {
    expect(await runConformance(githubSubject(), githubFakeEnvironment(), [caseId]))
      .toEqual([expect.objectContaining({ id: caseId, result: "pass" })]);
  });
}
// negative.test.ts — the suite must fail faulty connectors
test("a connector whose findByMarker never finds fails the duplicate predicate", async () => {
  const mutant: Connector = { ...hypothesisGithub(), findByMarker: async () => ok({ consistency: "strong" as const, item: null }) };
  const [report] = await runConformance({ ...githubSubject(), connector: mutant }, githubFakeEnvironment(), ["predicate-duplicate-external-item"]);
  expect(report?.result).toBe("fail");
});
test("a connector that appends withheld bytes to the body fails the leak predicate", async () => { /* → "fail" */ });
test("a connector that echoes the secret in a failure code fails secret-never-emitted", async () => { /* → "fail" */ });
test("a connector that creates when the item vanished fails declared-conflict", async () => { /* → "fail" */ });
```

- [ ] **Step 2: Rouge** — `bun test connectors/conformance/github.conformance.test.ts connectors/conformance/negative.test.ts`.
- [ ] **Step 3: Implémenter**
  - `dialects/github.ts` ;
  - `githubSubject`, sujet de test lié au profil `asHypothesis(githubIssuesProfile)` ;
  - `githubFakeEnvironment`, qui enveloppe `createFakeProvider({ dialect, search: "strong", baseUrl: "https://api.github.com" })` par `recordingHttpPort`.
- [ ] **Step 4: Vert** — attendu : `0 fail`, un test par identifiant de `requiredCaseIds("fake")`.
- [ ] **Step 5: Neutraliser** — dans `harness.ts`, remplacer l'assertion `itemsWithMarker ≤ 1` par `true`. Attendu : le premier test de `negative.test.ts` rougit. C'est la preuve que la suite discrimine. Restaurer.
- [ ] **Step 6: Commit** — `git add` des trois fichiers, puis `bun run check`, puis :

```bash
git commit -s -m "test(conformance): run GitHub Issues through the suite and prove it rejects faulty connectors"
```
