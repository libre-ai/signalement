# Signalement v1.0 — L5, partie 3 : qualification (Tasks 13-18)

Index, Goal, Global Constraints et Review Focus : `docs/superpowers/plans/2026-10-24-v1-L5-connectors.md`.

### Task 13: Format de l'évidence de qualification

**Files:**
- Create: `tools/ci/provider-evidence.ts`
- Test: `tools/ci/provider-evidence.test.ts`

**Interfaces:**
- Consumes:
  - `CONFORMANCE_SUITE_VERSION` et `requiredCaseIds` (Task 3) ;
  - `CONNECTOR_PROFILE_IDS` et `MATRIX_ENTRY_FOR_PROFILE` (Task 12) ;
  - `containsCredentialMarker` (`node_modules/@libre-ai/governance/tools/quality/public-source-scanner.ts`).
- Produces:

```ts
export const PROVIDER_EVIDENCE_SCHEMA = "libre-ai.signalement.provider-evidence.v1";
export type ProviderEvidenceFailure = "evidence-not-json" | "evidence-shape" | "evidence-schema" | "evidence-unknown-profile"
  | "evidence-entry-mismatch" | "evidence-path" | "evidence-not-live" | "evidence-suite-version" | "evidence-cases-incomplete"
  | "evidence-case-not-passed" | "evidence-cleanup" | "evidence-leak-scan" | "evidence-secret-scan" | "evidence-sensitive-content"
  | "evidence-provider-version";
export function evidencePath(entryId: string, date: string): string; // "qualification/evidence/<entryId>/<date>.json"
export function validateProviderEvidence(path: string, bytes: Uint8Array): readonly ProviderEvidenceFailure[];
```

**Emplacement.** Chaque évidence va dans `qualification/evidence/<entry-id>/<YYYY-MM-DD>.json`.
- Le format est JSON, pas YAML : `tools/ci/check-qualification.ts:8-10` traite tout fichier `qualification/**/*.yaml` comme un document de qualification.
- Le chemin est gardé : chaque évidence arrive par PR, avec un artefact de revue.

**Document fermé.** Toute clé inattendue donne `evidence-shape`. Aucune chaîne n'est libre : chacune est une énumération ou apparie un motif.

```json
{
  "schema_version": "libre-ai.signalement.provider-evidence.v1",
  "entry_id": "plane", "profile_id": "plane/self-hosted/rest-v1", "date": "2026-11-02", "mode": "live", "suite_version": "1",
  "code_commit": "<40 hex: git rev-parse HEAD at launch, clean tree>",
  "instance": { "edition": "self-hosted", "api_version": "v1", "provider_version": "<^[0-9A-Za-z.+-]{1,32}$ | null>" },
  "cases": [{ "id": "<ConformanceCaseId>", "result": "pass", "requests": 3, "duration_ms": 512, "failure_code": null }],
  "measurements": { "recovery_samples": 20, "recovery_first_read_hits": 20 },
  "cleanup": { "created": 31, "deleted": 31, "closed_retained": 0, "uploads_retained": 0, "failed": 0 },
  "leak_scan": { "requests_inspected": 214, "withheld_files": 1, "findings": 0 },
  "secret_scan": { "values_checked": 1, "findings": 0 }
}
```

**Règles de validation.**
- `entry_id === MATRIX_ENTRY_FOR_PROFILE.get(profile_id)`.
- `path === evidencePath(entry_id, date)`.
- `mode === "live"`, et `suite_version === CONFORMANCE_SUITE_VERSION`.
- L'ensemble des `cases[].id` est égal à `requiredCaseIds("live")`. Chaque cas a `result: "pass"`, et `failure_code` vaut `null` ou apparie `^[a-z]+\.[a-z0-9-]{1,56}$`.
- `cleanup.created === deleted + closed_retained`, et `failed === 0`.
- `leak_scan.findings === 0`, avec `requests_inspected > 0` et `withheld_files > 0`.
- `secret_scan.findings === 0`, avec `values_checked > 0`.
- `instance.provider_version` est non nul pour le profil Plane.
- `containsCredentialMarker` est faux sur le texte entier.
- Aucun champ ne peut porter une URL, un nom d'hôte, un identifiant distant ou un nom de compte.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
const PATH = "qualification/evidence/plane/2026-11-02.json";
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
test("accepts a complete live evidence", () => expect(validateProviderEvidence(PATH, bytes(validEvidence()))).toEqual([]));
test("refuses fake-mode evidence", () => expect(validateProviderEvidence(PATH, bytes({ ...validEvidence(), mode: "fake" }))).toContain("evidence-not-live"));
test("refuses a missing or non-passed case", () => {
  const e = validEvidence();
  expect(validateProviderEvidence(PATH, bytes({ ...e, cases: e.cases.slice(1) }))).toContain("evidence-cases-incomplete");
  expect(validateProviderEvidence(PATH, bytes({ ...e, cases: e.cases.map((c, i) => (i === 0 ? { ...c, result: "unavailable" } : c)) })))
    .toContain("evidence-case-not-passed");
});
test("refuses any extra field, such as a raw provider body or a host", () => {
  expect(validateProviderEvidence(PATH, bytes({ ...validEvidence(), response: '{"message":"x"}' }))).toContain("evidence-shape");
  expect(validateProviderEvidence(PATH, bytes({ ...validEvidence(), instance: { ...validEvidence().instance, host: "acme.atlassian.net" } })))
    .toContain("evidence-shape");
});
test("refuses a credential-shaped value anywhere in the file", () => {
  const shaped = ["github", "_pat_", "A".repeat(30)].join(""); // assembled: this test file must pass check:secret-scan
  expect(validateProviderEvidence(PATH, new TextEncoder().encode(JSON.stringify(validEvidence()).replace('"v1.4.2"', `"${shaped}"`))))
    .toContain("evidence-sensitive-content");
});
test("refuses unbalanced cleanup counters and a path that does not match the content", () => {
  expect(validateProviderEvidence(PATH, bytes({ ...validEvidence(), cleanup: { created: 2, deleted: 1, closed_retained: 0, uploads_retained: 0, failed: 0 } })))
    .toContain("evidence-cleanup");
  expect(validateProviderEvidence("qualification/evidence/plane/2026-11-03.json", bytes(validEvidence()))).toContain("evidence-path");
});
```

- [ ] **Step 2: Rouge** — `bun test tools/ci/provider-evidence.test.ts` ; attendu : module introuvable.
- [ ] **Step 3: Implémenter** un validateur écrit à la main, dans le style de `tools/ci/qualification.ts`, sans `ajv`.
- [ ] **Step 4: Vert** — attendu : `0 fail`.
- [ ] **Step 5: Neutraliser** — deux substitutions, une à la fois :
  - remplacer le contrôle des clés inattendues par `true` : le test des champs en trop rougit ;
  - remplacer `mode === "live"` par `true` : le test du mode faux rougit.

  Restaurer après chacune.
- [ ] **Step 6: Commit** — `git add tools/ci/provider-evidence.ts tools/ci/provider-evidence.test.ts`, puis `bun run check`, puis `git commit -s -m "feat(qualification): define closed, dated provider qualification evidence"`.

### Task 14: Extension du gate `check:qualification` au statut `qualified`

**Files:**
- Modify:
  - `tools/ci/qualification.ts` : `:13` (`ALLOWED_STATUSES`), `:17-27` (`QualificationFindingCode`), `:35-41` (`QualificationEntry` gagne `profile` et `evidence`), `:61-64` (signature), `:101-129` (boucle d'entrées) ;
  - `tools/ci/check-qualification.ts:11-31` : lecture des évidences et compteurs ;
  - `qualification/README.md`.
- Test: `tools/ci/qualification.test.ts`, `tools/ci/check-qualification.test.ts`

**Interfaces:**
- Consumes: Tasks 12, 13.
- Produces:

```ts
export function validateQualificationDocuments(documents: ReadonlyMap<string, unknown>, availablePaths: ReadonlySet<string>,
  evidence?: ReadonlyMap<string, Uint8Array>): readonly QualificationFinding[]; // evidence defaults to an empty Map
export interface QualificationSummary { readonly documents: number; readonly qualifiedEntries: number; readonly evidenceVerified: number; }
export function summarizeQualification(documents: ReadonlyMap<string, unknown>, evidence: ReadonlyMap<string, Uint8Array>): QualificationSummary;
```

Codes ajoutés : `qualified-outside-provider-matrix`, `qualified-unknown-profile`, `qualified-profile-mismatch`, `qualified-missing-evidence`, `qualified-invalid-evidence`, `invalid-profile`.

**Règle de passage à `qualified`.**
- `status: qualified` n'est admis que dans le document `kind: provider-matrix`.
- L'entrée porte un `profile` présent dans `CONNECTOR_PROFILE_IDS`, avec `MATRIX_ENTRY_FOR_PROFILE.get(profile) === id`.
- L'entrée porte un `evidence` présent dans l'index **et** dans la carte `evidence`, et `source === evidence`.
- `validateProviderEvidence(evidence, bytes)` est vide. Sinon, le gate émet un constat `qualified-invalid-evidence` par code, avec `detail` = `<id>:<code>`.

**Autres entrées.**
- Une entrée non qualifiée peut porter `profile`. S'il est présent, il doit apparier le motif du §4.1 ; sinon, le gate émet `invalid-profile`.
- Le `statement` n'est jamais réécrit par L5 : il garde le préfixe `<profil exact>: ` posé par L0. Le test de L0 lie chaque ligne v1.0 par `row.profile ?? préfixe du statement`.
- C'est cette forme que lit L4.

**Sortie et documentation.**
- `check-qualification.ts` lit en octets chaque fichier `.json` de l'index sous `qualification/evidence/`.
- Il imprime : `Qualification baseline verified: <n> document(s), <q> qualified entr(y|ies), <e> evidence file(s) verified, 0 findings`.
- `qualification/README.md` gagne : « `qualified`: provider-matrix only; an exact profile passed the live conformance suite, with dated evidence under `qualification/evidence/` validated by `check:qualification`. »

- [ ] **Step 1: Écrire les tests qui échouent** dans `tools/ci/qualification.test.ts` :

```ts
const EVIDENCE = "qualification/evidence/plane/2026-11-02.json";
function withQualifiedPlane(extra: Record<string, unknown> = {}) {
  const documents = new Map(validDocuments());
  documents.set("qualification/provider-matrix.yaml", { schema_version: "libre-ai.signalement.qualification.v1", kind: "provider-matrix",
    entries: [{ id: "plane", status: "qualified", statement: "plane/self-hosted/rest-v1: Plane exact profile", source: EVIDENCE,
      reopens_on: "Plane version change", profile: "plane/self-hosted/rest-v1", evidence: EVIDENCE, ...extra }] });
  return documents;
}
test("qualified requires readable, valid evidence", () => {
  expect(validateQualificationDocuments(withQualifiedPlane(), new Set(["README.md", EVIDENCE])))
    .toContainEqual({ path: "qualification/provider-matrix.yaml", code: "qualified-missing-evidence", detail: "plane" });
  expect(validateQualificationDocuments(withQualifiedPlane(), new Set(["README.md", EVIDENCE]), new Map([[EVIDENCE, validEvidenceBytes()]]))).toEqual([]);
});
test("qualified is refused outside the provider matrix", () => { /* browser-matrix entry status qualified → qualified-outside-provider-matrix */ });
test("a family name is not a qualified profile", () => {
  expect(validateQualificationDocuments(withQualifiedPlane({ profile: "plane" }), new Set(["README.md", EVIDENCE]),
    new Map([[EVIDENCE, validEvidenceBytes()]]))).toContainEqual(expect.objectContaining({ code: "qualified-unknown-profile" }));
});
test("invalid evidence surfaces each failure code", () => { /* fake-mode bytes → detail "plane:evidence-not-live" */ });
```

`tools/ci/check-qualification.test.ts` gagne deux cas, dans un dépôt temporaire qui contient les huit documents, une entrée `qualified` et son évidence :
- évidence stagée → la ligne de compteurs exacte, avec `1 qualified entry, 1 evidence file(s) verified` ;
- évidence non stagée → code de sortie 1 et `qualified-missing-evidence`.

- [ ] **Step 2: Rouge** — `bun test tools/ci/qualification.test.ts tools/ci/check-qualification.test.ts` ; attendu : `invalid-status` sur `qualified`.
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: Vert** — attendu : `0 fail`. Puis `bun run check:qualification` ; attendu : `Qualification baseline verified: 8 document(s), 0 qualified entries, 0 evidence file(s) verified, 0 findings`.
- [ ] **Step 5: Neutraliser** — deux substitutions, une à la fois :
  - remplacer `validateProviderEvidence(...)` par `[]` : le test des codes d'évidence rougit ;
  - remplacer le test `kind === "provider-matrix"` par `true` : le test « outside the provider matrix » rougit.

  Restaurer après chacune.
- [ ] **Step 6: Commit** — chemin gardé, artefact de revue joint. `git add` des cinq fichiers, puis `bun run check`, puis `git commit -s -m "feat(qualification): admit qualified provider entries only with validated live evidence"`.

### Task 15: Exécuteur de qualification réel

**Files:**
- Create: `connectors/conformance/{allowlist-http,qualify-config,qualify}.ts`, `connectors/conformance/live/{github,gitlab,jira,plane}.ts`
- Modify: `package.json`, qui gagne le script `"qualify:connectors": "bun run check:bun:runtime && bun connectors/conformance/qualify.ts"`
- Test: `connectors/conformance/{allowlist-http,qualify-config,qualify}.test.ts`

**Interfaces:**
- Consumes:
  - Tasks 3, 12, 13 ;
  - le SDK : `createFetchHttpPort` (registre §4.3, transport réel, seul code qui appelle `revealSecret`), `SecretHandle.fromString`.
- Produces:

```ts
export class OriginRefused extends Error {}
export function allowlistHttpPort(inner: HttpPort, origins: readonly string[]): HttpPort; // refuses before sending
export interface QualifyConfig { readonly profileId: string; readonly target: DestinationTarget; readonly invalidTarget: DestinationTarget;
  readonly nonconformantTarget: DestinationTarget; readonly allowedOrigins: readonly string[]; readonly allowPrivate: boolean; readonly secretName: string; }
export const QUALIFY_ENV: ReadonlyMap<string, readonly string[]>; // profile id → required variable names
export function readQualifyConfig(profileId: string, env: Readonly<Record<string, string | undefined>>): Result<QualifyConfig, { missing: readonly string[] }>;
export function liveObserver(config: QualifyConfig, ctx: ConnectorContext): RemoteObserver; // direct reads after LIVE_SETTLE_MS = 15_000, separate code from findByMarker
export function cleanupCreated(config: QualifyConfig, ctx: ConnectorContext, created: readonly RemoteItemRef[]):
  Promise<{ deleted: number; closedRetained: number; uploadsRetained: number; failed: number }>;
```

**Variables d'environnement.** Le plan ne donne que les noms. Les valeurs passent par un canal de secrets ; elles n'entrent jamais dans Git ni dans une sortie.

| Profil | Secret | Coordonnées |
| --- | --- | --- |
| GitHub | `SIGNALEMENT_QUALIFY_GITHUB_TOKEN` | `…_GITHUB_OWNER`, `…_GITHUB_REPO` |
| GitLab | `SIGNALEMENT_QUALIFY_GITLAB_TOKEN` | `…_GITLAB_PROJECT_ID` |
| Jira | `SIGNALEMENT_QUALIFY_JIRA_TOKEN` | `…_JIRA_CLOUD_ID`, `…_JIRA_SITE_URL`, `…_JIRA_PROJECT_KEY`, `…_JIRA_ISSUE_TYPE_ID` |
| Plane | `SIGNALEMENT_QUALIFY_PLANE_API_KEY` (rempli par Task 16 avec `--plane-container`) | `…_PLANE_BASE_URL`, `…_PLANE_WORKSPACE`, `…_PLANE_PROJECT_ID` |

**Nettoyage.** `HttpMethod` n'a pas `DELETE`. Le nettoyage passe donc par :
- GitHub : `PATCH`, avec `state: closed` et `state_reason: not_planned` ;
- GitLab : `PUT`, avec `state_event: close` ; les téléversements sont comptés dans `uploads_retained` ;
- Jira : une transition vers un statut de catégorie `done` ;
- Plane : la destruction du conteneur, comptée dans `deleted`.

Tout reliquat est déclaré.

**Déroulé de `qualify.ts --profile <id> [--write-evidence] [--plane-container]`.**
1. Préconditions :
   - le profil est connu de `connectorFor` ;
   - les variables sont présentes ; sinon sortie `2` et `unavailable: missing <NOMS>`, sans aucune valeur ;
   - `git status --porcelain` est vide hors `qualification/evidence/` ; sinon `blocked: dirty tree` et sortie `2` ;
   - `code_commit` vaut `git rev-parse HEAD`.
2. Transport :
   - `http = recordingHttpPort(allowlistHttpPort(createFetchHttpPort({ timeoutMs: 30000, maxResponseBytes: 8388608, allowPrivate }), allowedOrigins))` ;
   - origines autorisées : GitHub `https://api.github.com` ; GitLab `https://gitlab.com` ; Jira `https://api.atlassian.com` ; Plane, l'origine de base et l'origine de stockage ;
   - `allowPrivate` n'est vrai que pour Plane en boucle locale.
3. Exécution : `runConformance` sur `createXConnector(asHypothesis(profile))`, avec `requiredCaseIds("live")`. `cleanupCreated` tourne dans un `finally`.
4. Contrôle des secrets : chaque valeur secrète est cherchée dans la sortie console capturée, dans chaque `CaseReport` et dans les octets de l'évidence. Une occurrence suffit : rien n'est écrit, la sortie vaut `1`, avec `fail: secret detected in output`.
5. Sortie console :
   - une ligne `<id> <result>` par cas ;
   - puis une ligne `cases: <n> pass, <n> fail, <n> unavailable, <n> blocked; requests: <n>; created: <n>, deleted: <n>, closed-retained: <n>` ;
   - code de sortie : `0` si tout est `pass`, `1` si au moins un `fail`, `2` sinon.
6. `--write-evidence` :
   - écrit `evidencePath(entry, date)`, seulement si la sortie vaut `0` et si `validateProviderEvidence` est vide ;
   - la date vaut `new Date().toISOString().slice(0, 10)` ;
   - l'exécuteur ne modifie jamais `provider-matrix.yaml`.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
test("allowlist refuses another origin before the inner port is called", async () => {
  let called = 0;
  const port = allowlistHttpPort({ send: async () => { called += 1; return okResponse(); } }, ["https://api.github.com"]);
  await expect(port.send(get("https://evil.example/x"))).rejects.toBeInstanceOf(OriginRefused);
  expect(called).toBe(0);
});
test("missing variables are reported by name only", () => {
  expect(readQualifyConfig("github-issues/github.com/rest-2022-11-28", { SIGNALEMENT_QUALIFY_GITHUB_TOKEN: "test-token-not-a-secret" }))
    .toEqual({ ok: false, error: { missing: ["SIGNALEMENT_QUALIFY_GITHUB_OWNER", "SIGNALEMENT_QUALIFY_GITHUB_REPO"] } });
});
// qualify.test.ts — child process, purged environment (env -i), no network
test("missing secrets exit 2 and never print a value", async () => { /* exit 2; output lacks "test-token-not-a-secret" */ });
test("an unknown profile exits 2", async () => { /* --profile x/y/z */ });
test("a dirty tree is blocked", async () => { /* temp repo with an untracked file → "blocked: dirty tree", exit 2 */ });
```

- [ ] **Step 2: Rouge** — `bun test connectors/conformance/allowlist-http.test.ts connectors/conformance/qualify-config.test.ts connectors/conformance/qualify.test.ts`.
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: Vert** — attendu : `0 fail`.
- [ ] **Step 5: Neutraliser** — deux substitutions, une à la fois :
  - imprimer l'objet de configuration en cas d'erreur : le test « never print a value » rougit ;
  - remplacer le contrôle d'origine par `true` : le test de liste d'autorisation rougit.

  Restaurer après chacune.
- [ ] **Step 6: Commit** — `git add` des fichiers listés, puis `bun run check`, puis `git commit -s -m "feat(conformance): add live qualification runner with origin allowlist and secret checks"`.

### Task 16: Environnement Plane local et exécution réelle Plane

**Files:**
- Create: `connectors/conformance/plane/{compose.yaml,bootstrap.py,environment.ts,README.md}`
- Modify: `connectors/conformance/qualify.ts`, qui gagne l'option `--plane-container`
- Test: `connectors/conformance/plane/environment.test.ts`
- Create, après une exécution verte : `qualification/evidence/plane/<date>.json`

**Interfaces:**
- Consumes: Tasks 10, 15.
- Produces:
  - `PLANE_COMPOSE_PROJECT = "signalement-plane-qualification"` ;
  - `PLANE_LOCAL_PORT = 18080` ;
  - `startPlaneEnvironment(): Promise<Result<{ baseUrl: string; workspaceSlug: string; projectId: string; apiKey: SecretHandle; stop(): Promise<void> }, "docker-unavailable" | "start-failed" | "bootstrap-failed">>`.

**Valeurs fixées.**
- **`compose.yaml`** dérive du fichier `deployments/cli/community/docker-compose.yml`, au tag `PLANE_PINNED_VERSION`. Lecture : `gh api "repos/makeplane/plane/contents/deployments/cli/community/docker-compose.yml?ref=<tag>" --jq .content | base64 -d`.
  - Services conservés : `api`, `worker`, `beat-worker`, `migrator`, `plane-db`, `plane-redis`, `plane-mq`, `plane-minio` et `proxy`.
  - `web`, `space`, `admin` et `live` sont retirés si `proxy` démarre sans eux. C'est à prouver ; sinon, ils restent.
  - Chaque image est épinglée par digest, avec `docker buildx imagetools inspect <image>:<tag> --format '{{json .Manifest.Digest}}'`, y compris `minio/minio`, que l'amont tire en `latest`.
  - Une ligne `# plane-version: <tag>` porte la version.
  - Le proxy n'écoute que sur `127.0.0.1:18080`.
- **Aucun mot de passe dans le fichier.**
  - `${PLANE_QUAL_DB_PASSWORD:?}`, `${PLANE_QUAL_MQ_PASSWORD:?}`, `${PLANE_QUAL_MINIO_SECRET:?}` et `${PLANE_QUAL_SECRET_KEY:?}` sont générés par `environment.ts`, en 32 octets de `crypto.getRandomValues` en hexadécimal, puis passés à `docker compose` par l'environnement du sous-processus.
  - La base se configure par variables séparées, jamais par une URL à identifiants intégrés.
- **`bootstrap.py`** s'exécute dans le conteneur `api`, par `docker compose -p signalement-plane-qualification exec -T api python manage.py shell` sur l'entrée standard.
  - Il crée, par l'ORM, un utilisateur, un espace, un projet et une clé d'API d'espace.
  - Il imprime une seule ligne JSON `{"workspace_slug","project_id","api_key"}`, lue en mémoire et jamais affichée.
  - C'est un script du produit cible, hors de la chaîne Python du dépôt.
  - Les noms de modèles sont à confirmer sur le tag épinglé.
- **`stop()`** exécute `docker compose -p signalement-plane-qualification down --volumes --remove-orphans` dans un `finally`, y compris en cas d'échec.
- **Docker absent** : `docker-unavailable`, tous les cas à `unavailable`, sortie `2`. Jamais vert.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
test("compose pins every image by digest and binds loopback only", async () => {
  const compose = Bun.YAML.parse(await Bun.file("connectors/conformance/plane/compose.yaml").text()) as
    { services: Record<string, { image: string; ports?: string[] }> };
  for (const s of Object.values(compose.services)) {
    expect(s.image).toMatch(/@sha256:[0-9a-f]{64}$/);
    for (const p of s.ports ?? []) expect(p.startsWith("127.0.0.1:")).toBe(true);
  }
});
test("compose version comment equals the profile version", async () => { /* "# plane-version: <tag>" === PLANE_PINNED_VERSION */ });
test("compose carries no literal credential", async () => {
  const text = await Bun.file("connectors/conformance/plane/compose.yaml").text();
  expect(text).toContain("${PLANE_QUAL_DB_PASSWORD:?}");
  expect(text).not.toMatch(/PASSWORD:\s*[^$\s]/);
});
test("docker unavailable yields unavailable, never pass", async () => { /* PATH without docker → "docker-unavailable" */ });
```

- [ ] **Step 2: Rouge** — `bun test connectors/conformance/plane/environment.test.ts`.
- [ ] **Step 3: Implémenter** les quatre fichiers et l'option. Le `README.md` décrit la procédure, le port, le nettoyage et la licence AGPL de la cible.
- [ ] **Step 4: Vert** — attendu : `0 fail`.
- [ ] **Step 5: Exécution réelle** — `bun run qualify:connectors -- --profile plane/self-hosted/rest-v1 --plane-container`.
  - Attendu : une ligne `pass` par cas de `requiredCaseIds("live")`, `created = deleted`, sortie `0`, puis `docker compose -p signalement-plane-qualification ps` vide.
  - Si une hypothèse H-PL est réfutée, corriger le profil (la cellule passe à `unsupported`) et le dialecte, jamais l'assertion du cas, puis rejouer.
  - Relayer la sortie verbatim dans la PR.
- [ ] **Step 6: Neutraliser** — remplacer `stop()` par une fonction vide, puis provoquer un échec avec un `SIGNALEMENT_QUALIFY_PLANE_PROJECT_ID` invalide. Un `docker compose … ps` non vide prouve que le nettoyage dépend du `finally`. Restaurer, puis nettoyer.
- [ ] **Step 7: Évidence et profil.**
  - Rejouer avec `--write-evidence`.
  - Publier les cellules prouvées dans `connectors/plane/profile.ts` (`unproven` → `supported`), puis `bun test connectors/plane/profile.test.ts` ; attendu : `0 fail`.
  - `git add qualification/evidence/plane/<date>.json`, puis `bun run check:qualification` ; attendu : `0 qualified entries, 0 evidence file(s) verified, 0 findings`.
- [ ] **Step 8: Commit** — `git add connectors/conformance/plane connectors/conformance/qualify.ts connectors/plane/profile.ts qualification/evidence/plane`, puis `bun run check`, puis `git commit -s -m "feat(conformance): qualify Plane against a pinned local container"`.
- [ ] **Step 9: Promotion** — PR séparée, chemin gardé, artefact de revue joint.
  - Entrée `plane` : `status: qualified`, `profile: "plane/self-hosted/rest-v1"`, `evidence` et `source` égaux au chemin de l'évidence. Le `statement` est inchangé : il garde son préfixe L0.
  - `bun run check:qualification` ; attendu : `1 qualified entry, 1 evidence file(s) verified, 0 findings`.
  - `bun test tools/ci/qualification-v1.test.ts` (L0) ; attendu : `0 fail`.
  - `git commit -s -m "chore(qualification): qualify the pinned self-hosted Plane profile"`.

### Task 17: [ATTEND LE PROPRIÉTAIRE] Comptes réels GitHub, GitLab.com, Jira Cloud et promotions

Cette tâche bloque le jalon v1.0 (feuille de route §5.1), **pas** le critère de sortie de L5 (Task 18). Les trois profils sont indépendants.

**Files:**
- Create, après une exécution verte : `qualification/evidence/{github-issues,gitlab-issues,jira-cloud}/<date>.json`
- Modify:
  - `connectors/{github-issues,gitlab-issues,jira-cloud}/profile.ts`, pour les cellules prouvées ;
  - `qualification/provider-matrix.yaml`, avec une PR de promotion par profil (`status`, `profile`, `evidence`, `source` ; `statement` inchangé).

**Interfaces:**
- Consumes: Task 15.
- Produces: des évidences datées et des entrées `qualified`.

**Ce que fournit le propriétaire.** Tout passe par un canal de secrets, jamais en clair.
- **GitHub** :
  - un dépôt de test (question 2) ;
  - un jeton à grain fin limité à ce dépôt, avec `Metadata: read` et `Issues: read and write`, et l'expiration la plus courte possible.
- **GitLab.com** : selon `GITLAB_AUTH`, l'une de ces deux formules :
  - un compte dédié, membre du seul projet de test, avec son jeton personnel de portée `api` ;
  - un abonnement Premium ou Ultimate, avec un jeton d'accès de projet.
- **Jira Cloud** :
  - un site de test et un compte de service ;
  - un jeton portant les portées `read:jira-work` et `write:jira-work` ;
  - un projet, et un type d'issue dont le workflow comporte un statut de catégorie `done`.

- [ ] **Step 1** — `bun run qualify:connectors -- --profile <id>` ; attendu : sortie `0`, une ligne `pass` par cas, compteurs de nettoyage équilibrés.
- [ ] **Step 2** — Rejouer avec `--write-evidence`, puis publier les cellules prouvées. `git add` de l'évidence et du profil, `bun run check`, puis `git commit -s -m "chore(qualification): record live evidence for <entry>"`.
- [ ] **Step 3** — Une PR de promotion par profil, sur le modèle de Task 16 Step 9. Attendu : le compteur `qualified` augmente d'une unité.
- [ ] **Step 4** — Le propriétaire révoque les jetons après la campagne. La PR consigne la date, jamais la valeur.

### Task 18: Vérification du critère de sortie de L5

Critère (feuille de route §2) : « 4 connecteurs passant la suite de conformité sur le faux ; mode de qualification exécutable contre une instance réelle ; matrice prête à recevoir `qualified` ».

**Files:** aucun fichier nouveau.

**Interfaces:**
- Consumes: Tasks 1-16.
- Produces: une preuve verte, relayée verbatim dans la PR.

- [ ] **Step 1** — Stager les fichiers. `git status --short` ne doit montrer aucun fichier non suivi sous `connectors/`, `tools/ci/` ou `qualification/`. Puis `bun run check` ; attendu : sortie `0`.
- [ ] **Step 2** — `bun run check:connectors` ; attendu :
  - `0 fail`, couverture ≥ 0.9 ;
  - quatre fichiers `*.conformance.test.ts` exécutés, chacun avec un test par identifiant de `requiredCaseIds("fake")`.
- [ ] **Step 3** — `bun test connectors/conformance/negative.test.ts` ; attendu : `0 fail`.
- [ ] **Step 4** — `bun run qualify:connectors -- --profile plane/self-hosted/rest-v1 --plane-container` ; attendu : sortie `0`. Sans Docker, le résultat est `unavailable` : le critère n'est **pas** atteint, et le compte rendu le dit.
- [ ] **Step 5** — `bun run qualify:connectors -- --profile jira-cloud/cloud/rest-v3` sans variables ; attendu : sortie `2`, avec `unavailable: missing SIGNALEMENT_QUALIFY_JIRA_TOKEN, …`, sans aucune valeur.
- [ ] **Step 6** — `bun run check:qualification` ; attendu : la ligne de compteurs de Task 14, avec `0 findings`.
- [ ] **Step 7** — Proposer `/code-review:code-review` sur la PR de L5 avant la fusion.
