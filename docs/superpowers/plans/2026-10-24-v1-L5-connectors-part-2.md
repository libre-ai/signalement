# Signalement v1.0 — L5, partie 2 : GitLab, Jira, Plane, registre (Tasks 6-12)

Index, Goal, Global Constraints et Review Focus : `docs/superpowers/plans/2026-10-24-v1-L5-connectors.md`. Les tâches de cette partie suivent le modèle des Tasks 4 et 5 (partie 1). Seuls les écarts à ce modèle sont écrits ici.

### Task 6: Connecteur GitLab Issues

**Files:**
- Create: `connectors/gitlab-issues/{profile,target,requests,connector,hypotheses,index}.ts`
- Modify: aucun fichier hors du module. La correction du §5.6 du design et le `statement` de `gitlab-issues` appartiennent à L0 (tâche 7B), avant le verrou L1.
- Test: `connectors/gitlab-issues/{profile,target,requests,connector}.test.ts`

**Interfaces:**
- Consumes: comme Task 4.
- Produces:
  - `GITLAB_AUTH: { readonly mode: "personal-access-token" | "project-access-token"; readonly scopes: readonly string[] }` ;
  - `gitlabIssuesProfile`, `createGitlabIssuesConnector(profile)`, `gitlabIssuesConnector` ;
  - `parseGitlabTarget(target): Result<{ projectId: string }, ConnectorFailure>` ;
  - `GITLAB_TARGET_COORDINATES: readonly ["projectId"]`, `GITLAB_HYPOTHESES`.

**Authentification, une seule variable.** L'hypothèse est confirmée (registre §6) : « On GitLab.com, project access tokens require a Premium or Ultimate subscription ». Source : https://docs.gitlab.com/user/project/settings/project_access_tokens/, relue le 2026-10-24.

Le choix du propriétaire ne touche que `GITLAB_AUTH`, dans `connectors/gitlab-issues/profile.ts`. `gitlabIssuesProfile.auth` vaut `GITLAB_AUTH` ; rien d'autre ne lit le mode. Deux valeurs possibles :
- compte dédié : `{ mode: "personal-access-token", scopes: ["api"] }` ;
- abonnement payant : `{ mode: "project-access-token", scopes: ["api"] }`.

Dans les deux cas, l'en-tête reste `private-token` : https://docs.gitlab.com/api/rest/authentication/, « Pass the token using the `PRIVATE-TOKEN` header (recommended) ». La fixture L1 est corrigée selon ce choix avant son verrou (registre §6), et le test de profil exige l'égalité avec elle.

**Profil.** C'est l'entrée GitLab de la fixture : `attachmentUpload: "supported"`, `visibility: "discovered"`, `consistentLookup { filtered-list, unproven }`, `bodyFormat: "markdown-glfm"`. Base exacte : `https://gitlab.com/api/v4`.

**Appels.** Ils sont relus le 2026-10-24, sauf mention.

| Opération | Requête | Source |
| --- | --- | --- |
| auth | `auth: { header: "private-token", prefix: "", secret }` ; 401 si le jeton est invalide, 403 `insufficient_scope` si la portée manque | https://docs.gitlab.com/api/rest/authentication/ |
| découverte | `GET /projects/{id}` → `visibility`, `issues_access_level` ; `GET /metadata` → `version`, rendu comme `instanceVersion` (consigné, jamais comparé) | https://docs.gitlab.com/api/projects/, https://docs.gitlab.com/api/metadata/ (non relues) |
| auteur | `GET /user` → `id` | doc « Users » de l'API GitLab (non relue) |
| création | `POST /projects/{id}/issues` `{ title, description }` | https://docs.gitlab.com/api/issues/ |
| commentaire | `POST /projects/{id}/issues/{iid}/notes` `{ body }` ; « Limited to 1,000,000 characters » | https://docs.gitlab.com/api/notes/ |
| pièce jointe | `POST /projects/{id}/uploads`, multipart, champ `file` → `url`, `full_path`, `id` ; puis la note `Signalement attachment <n>: [attachment](<url>)` | https://docs.gitlab.com/api/project_markdown_uploads/ |
| reprise d'item | `GET /projects/{id}/issues?scope=all&author_id=<viewer>&created_after=<floor>&order_by=created_at&sort=desc&per_page=100&page=N` ; jamais le paramètre `search` | https://docs.gitlab.com/api/issues/ (« Return issues created on or after the given time ») |
| reprise de commentaire | `GET /projects/{id}/issues/{iid}/notes?sort=desc&order_by=created_at&per_page=100&page=N`, arrêt à `floor` | https://docs.gitlab.com/api/notes/ |
| changements | `GET /projects/{id}/issues?scope=all&order_by=updated_at&sort=asc&updated_after=<ts>&pagination=keyset&per_page=100` (+ `cursor`) ; keyset « added in GitLab 18.3 », ordre par `updated_at` à prouver (H-GL-3) | https://docs.gitlab.com/api/issues/ |

**Règles fixées.**
- `parseGitlabTarget` :
  - `baseUrl` doit valoir exactement `https://gitlab.com/api/v4`, sinon `gitlab.instance-nonconformant`, sans requête ;
  - `projectId` doit apparier `^[1-9][0-9]{0,19}$` : identifiant numérique seulement, jamais un chemin encodé.
- `issues_access_level === "disabled"` rend `valid: false`, code `gitlab.issues-disabled`.
- `findByMarker` : algorithme de Task 4, avec :
  - `floor = Date.parse(marker.notBefore) − 300_000`, passé en `created_after` ;
  - les filtres `author_id` et `author.id === viewer.id` ;
  - `GITLAB_RECOVERY_MAX_PAGES = 10`.
- Pièce jointe :
  - le nom de fichier vient de `uploadFilename` ;
  - l'`url` renvoyée doit apparier `^/uploads/[0-9a-f]{32}/[A-Za-z0-9._-]{1,128}$`, sinon `gitlab.untrusted-remote-url`, et aucune note n'est publiée.
- `web_url` est validée contre le préfixe `https://gitlab.com/` et doit contenir `/-/issues/`.

**Hypothèses.**
- H-GL-1 : `GITLAB_AUTH` avec le rôle Reporter suffit à créer, téléverser et commenter. Cas : `create-first-delivery`, `attachment-or-declared-fallback`.
- H-GL-2 : la liste filtrée est fortement cohérente. Cas : `live-recovery-read-consistency`.
- H-GL-3 : la pagination keyset accepte l'ordre par `updated_at`. Cas : `read-changes-cursor`.
- H-GL-4 : un téléversement d'un projet privé n'est pas lisible anonymement. Cas : `attachment-or-declared-fallback`.
- H-GL-5 : l'ancre d'une note est `#note_<id>`. Cas : `comment-revision`.

- [ ] **Step 1: Écrire les tests qui échouent.** Les équivalents GitLab des tests de Task 4 (profil contre fixture, requêtes, auteur étranger, `notBefore`, `within`, profil publié sans lecture), plus :

```ts
test("the profile auth is GITLAB_AUTH and nothing else", () => expect(gitlabIssuesProfile.auth).toEqual(GITLAB_AUTH));
test("the recovery list is bounded by notBefore through created_after", () => {
  expect(listIssuesRequest({ projectId: "42" }, { viewerId: 7, floor: "2026-10-24T11:55:00.000Z", page: 1 }, secret()).url).toBe(
    "https://gitlab.com/api/v4/projects/42/issues?scope=all&author_id=7&created_after=2026-10-24T11%3A55%3A00.000Z&order_by=created_at&sort=desc&per_page=100&page=1");
});
test("internal visibility is reported as internal, never as private", async () => { /* GET /projects/42 → "internal" */ });
test("a project path instead of a numeric id is refused", () => {
  expect(parseGitlabTarget(target({ projectId: "group%2Fproject" })).ok).toBe(false);
});
test("the upload never carries the export file name", async () => { /* fileName "media/kept-shot-a1.png" → filename "attachment-<12hex>.png" */ });
test("an upload URL outside /uploads/<32hex>/ is refused and no note is posted", async () => { /* one POST uploads, zero POST notes */ });
```

- [ ] **Step 2: Rouge** — `bun test connectors/gitlab-issues`.
- [ ] **Step 3: Implémenter** le module. `GITLAB_AUTH` reprend la cellule `auth` de la fixture L1, déjà corrigée par L0 et L1 selon le choix du propriétaire.
- [ ] **Step 4: Vert** — `bun test connectors/gitlab-issues` ; attendu : `0 fail`.
- [ ] **Step 5: Neutraliser** — accepter `projectId` sans motif : le test du chemin encodé rougit. Restaurer.
- [ ] **Step 6: Commit** — `git add connectors/gitlab-issues`, `bun run check`, puis `git commit -s -m "feat(connectors): add GitLab Issues connector with a single auth choice"`.

### Task 7: Dialecte GitLab et conformance sur le faux

**Files:**
- Create: `connectors/conformance/dialects/gitlab.ts`
- Test: `connectors/conformance/gitlab.conformance.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 6.
- Produces: `gitlabDialect(options: { visibility: "private" | "internal" | "public"; issuesAccessLevel: "enabled" | "private" | "disabled"; viewerId: number; foreignMarker: string | null; staleMarkerBeforeFloor: boolean; tamperUrls: boolean; readOnly: boolean }): FakeDialect & { observer(store: FakeStore): RemoteObserver }`.

**Comportements scriptés.**
- `iid` croissant ; la liste filtrée par `author_id` et `created_after` est immédiatement cohérente (H-GL-2).
- Pagination keyset par `updated_at`, avec un `cursor` opaque (H-GL-3).
- Le téléversement rend une `url` de la forme `/uploads/<32hex>/<nom>`.
- Avec `readOnly`, toute écriture rend 403 `insufficient_scope`. Le faux ne voit jamais la valeur du secret.
- La note d'une issue absente rend 404.

- [ ] **Step 1: Écrire le test qui échoue** — la boucle de Task 5 sur `gitlabSubject()`, plus :

```ts
test("a token without the api scope is a typed auth failure", async () => {
  const env = gitlabFakeEnvironment({ readOnly: true });
  expect(await gitlabIssuesConnector.create(createRequestFixture(), env.ctx))
    .toEqual({ ok: false, error: expect.objectContaining({ kind: "auth", code: "gitlab.forbidden" }) });
});
```

- [ ] **Step 2: Rouge** — `bun test connectors/conformance/gitlab.conformance.test.ts`.
- [ ] **Step 3: Implémenter** `dialects/gitlab.ts`.
- [ ] **Step 4: Vert** — attendu : `0 fail`.
- [ ] **Step 5: Neutraliser** — avec `tamperUrls: true`, remplacer la validation de l'URL de téléversement par `true` : `remote-url-untrusted-refused` rougit. Restaurer.
- [ ] **Step 6: Commit** — `git add` des deux fichiers, `bun run check`, puis `git commit -s -m "test(conformance): run GitLab Issues through the suite on the fake provider"`.

### Task 8: Connecteur Jira Cloud

**Files:**
- Create: `connectors/jira-cloud/{profile,target,requests,connector,hypotheses,index}.ts`
- Test: `connectors/jira-cloud/{profile,target,requests,connector}.test.ts`

**Interfaces:**
- Consumes: comme Task 4 ; `RenderedContent` au format `adf` (`AdfDocument`).
- Produces :
  - `jiraCloudProfile`, `createJiraCloudConnector(profile)`, `jiraCloudConnector` ;
  - `parseJiraTarget(target): Result<{ gatewayBase: string; siteUrl: string; projectKey: string; issueTypeId: string }, ConnectorFailure>` ;
  - `JIRA_TARGET_COORDINATES: readonly ["siteUrl", "projectKey", "issueTypeId"]`, `JIRA_HYPOTHESES`.

**Sources relues le 2026-10-24.**
- https://support.atlassian.com/user-management/docs/manage-api-tokens-for-service-accounts/ :
  - « Tokens must always use the Platform API Gateway URLs beginning with `api.atlassian.com` to make API requests. »
  - « Bearer token authentication or basic authentication in the HTTP header » : le schéma `Bearer` évite de transmettre l'adresse électronique du compte, qu'exige `Basic`.
  - « Typical scopes include `read:jira-work` and `write:jira-work`. »
  - « Token expiration can be between 1 and 365 days. »
- https://developer.atlassian.com/cloud/jira/platform/search-and-reconcile/ :
  - « The API doesn't provide read-after-write consistency by default. »
  - « … consistency is ensured only for the specified issues. »
  - Conséquence, inscrite au registre §6 : la fixture L1 porte `lookup: unsupported`. `findByMarker` pour un item rend `unavailable` sans requête, et toute création ambiguë finit en `to-resolve`.
- Pages de référence tronquées par l'outil de lecture, à relire à l'exécution :
  - `…/rest/v3/api-group-issues/` (création, `createmeta`) ;
  - `…/api-group-issue-comments/` ;
  - `…/api-group-issue-attachments/`, déjà consigné dans `docs/qualification/official-capability-baseline.md` ;
  - `…/api-group-server-info/`.

**Profil.** C'est l'entrée Jira de la fixture, telle quelle : `attachmentUpload: "supported"`, `visibility: "declared"`, lecture `unsupported`, `bodyFormat: "adf"`, `auth.mode: "api-token"`.

**Appels.** Tous portent `auth: { header: "authorization", prefix: "Bearer ", secret }`.
- découverte : `GET /rest/api/3/serverInfo` (`deploymentType === "Cloud"`, sinon `jira.instance-nonconformant`), puis `GET /rest/api/3/attachment/meta` → `enabled`, `uploadLimit` ;
- mapping : `GET /rest/api/3/issue/createmeta/{projectKey}/issuetypes/{issueTypeId}`. Tout champ `required` sans `hasDefaultValue`, hors `summary`, `description`, `project`, `issuetype` et `reporter`, produit une issue de code `jira.required-field-unmapped` ;
- création : `POST /rest/api/3/issue` `{ fields: { project: { key }, issuetype: { id }, summary, description: <AdfDocument> } }` → `id`, `key` ;
- commentaire : `POST /rest/api/3/issue/{id}/comment` `{ body: <AdfDocument> }` ;
- pièce jointe : `POST /rest/api/3/issue/{id}/attachments`, multipart `file`, en-tête `x-atlassian-token: no-check` ;
- reprise de commentaire, quand `within` est non nul : `GET /rest/api/3/issue/{id}/comment?orderBy=-created&maxResults=100`, arrêt à `floor`. C'est une lecture directe de l'item, hors index (H-JI-4) ;
- changements : `POST /rest/api/3/search/jql` `{ jql: project = "<KEY>" AND updated >= "<yyyy-MM-dd HH:mm>" ORDER BY updated ASC, fields: ["status", "updated"], maxResults: 100, nextPageToken }`. Usage d'affichage seulement : la cohérence différée est assumée.

**Règles fixées.**
- Motifs :
  - `baseUrl` : `^https://api\.atlassian\.com/ex/jira/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` ;
  - `siteUrl` : `^https://[a-z0-9-]{1,63}\.atlassian\.net$` ;
  - `projectKey` : `^[A-Z][A-Z0-9_]{1,9}$` ;
  - `issueTypeId` : `^[0-9]{1,18}$`.
- Le JQL n'interpole que la `projectKey` validée et un horodatage que le connecteur formate lui-même.
- `remoteId` vaut l'`id`, stable au déplacement de l'issue. `remoteUrl` vaut `${siteUrl}/browse/${key}`, avec `key` validée contre `^[A-Z][A-Z0-9_]{1,9}-[1-9][0-9]{0,9}$`.
- Refus sans requête :
  - un contenu au format autre que `adf` rend `jira.content-format` ;
  - un fichier au-delà de `uploadLimit` rend `jira.attachment-too-large` ;
  - `enabled === false` rend `jira.attachments-disabled`.

**Hypothèses.**
- H-JI-1 : les portées `read:jira-work` et `write:jira-work` suffisent, pièces jointes comprises.
- H-JI-2 : `serverInfo`, appelé par la passerelle, rend `"Cloud"`.
- H-JI-3 : `attachment/meta` rend `enabled` et `uploadLimit`.
- H-JI-4 : la liste des commentaires d'un item est fortement cohérente. Cas : `resume-after-cut-comment`.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
test("findByMarker for an item is unavailable and sends nothing", async () => {
  const calls: OutboundRequest[] = [];
  expect(await jiraCloudConnector.findByMarker(jiraTarget(), markerFixture({ within: null }), recordingCtx(calls)))
    .toEqual({ ok: true, value: { consistency: "unavailable" } });
  expect(calls).toEqual([]);
});
test("requests go through the gateway, never the site URL", () => {
  expect(createIssueRequest(coordinatesFixture(), adfContentFixture(), secret()).url)
    .toBe("https://api.atlassian.com/ex/jira/0b7c3e2a-1f4d-4c55-9a7e-3d2b1c0a9f8e/rest/api/3/issue");
});
test("attachment carries the XSRF bypass header and a derived filename", async () => { /* headers["x-atlassian-token"] === "no-check" */ });
test("a non-ADF content is refused before any request", async () => { /* markdown → jira.content-format */ });
test("a project key with JQL syntax is refused", () => {
  expect(parseJiraTarget(target({ projectKey: 'X" OR project = "Y' })).ok).toBe(false);
});
```

- [ ] **Step 2: Rouge** — `bun test connectors/jira-cloud`.
- [ ] **Step 3: Implémenter** le module.
- [ ] **Step 4: Vert** — attendu : `0 fail`.
- [ ] **Step 5: Neutraliser** — faire envoyer à `findByMarker` une recherche JQL qui rend `strong` : le premier test rougit. Restaurer.
- [ ] **Step 6: Commit** — `git add connectors/jira-cloud`, `bun run check`, puis `git commit -s -m "feat(connectors): add Jira Cloud connector through the scoped-token gateway"`.

### Task 9: Dialecte Jira et conformance sur le faux

**Files:**
- Create: `connectors/conformance/dialects/jira.ts`
- Test: `connectors/conformance/jira.conformance.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 8.
- Produces: `jiraDialect(options: { deploymentType: "Cloud" | "Server"; attachmentsEnabled: boolean; uploadLimit: number; searchLagCalls: number; tamperUrls: boolean }): FakeDialect & { observer(store: FakeStore): RemoteObserver }`.

**Comportements scriptés.**
- La recherche JQL est à cohérence différée : un item n'y apparaît qu'après `searchLagCalls` appels.
- `serverInfo` et `attachment/meta` sont servis.
- Une pièce jointe sans `x-atlassian-token` rend 403.
- Le commentaire d'une issue supprimée rend 404.
- L'observateur compte depuis le `FakeStore`, jamais depuis la recherche.

- [ ] **Step 1: Écrire le test qui échoue** — la boucle de Task 5 sur `jiraSubject()`, plus :

```ts
test("an ambiguous Jira create resolves to to-resolve and never creates again", async () => {
  const env = jiraFakeEnvironment({ searchLagCalls: 3 });
  expect((await runConformance(jiraSubject(), env, ["resume-after-cut-create"]))[0]?.result).toBe("pass");
  expect(env.captured().filter((r) => r.method === "POST" && r.path.endsWith("/rest/api/3/issue"))).toHaveLength(1);
});
```

- [ ] **Step 2: Rouge** — `bun test connectors/conformance/jira.conformance.test.ts`.
- [ ] **Step 3: Implémenter** `dialects/jira.ts`.
- [ ] **Step 4: Vert** — attendu : `0 fail`.
- [ ] **Step 5: Neutraliser** — dans `connectors/jira-cloud/requests.ts`, remplacer `"no-check"` par une chaîne vide : `attachment-or-declared-fallback` rougit. Restaurer.
- [ ] **Step 6: Commit** — `git add` des deux fichiers, `bun run check`, puis `git commit -s -m "test(conformance): run Jira Cloud through the suite with eventual-consistency search"`.

### Task 10: Connecteur Plane auto-hébergé

**Files:**
- Create: `connectors/plane/{profile,target,requests,connector,hypotheses,index}.ts`
- Test: `connectors/plane/{profile,target,requests,connector}.test.ts`

**Interfaces:**
- Consumes: comme Task 4.
- Produces :
  - `planeProfile`, `createPlaneConnector(profile)`, `planeConnector`, `PLANE_PINNED_VERSION` ;
  - `parsePlaneTarget(target): Result<{ baseUrl: string; storageOrigin: string; workspaceSlug: string; projectId: string; maxAttachmentBytes: number }, ConnectorFailure>` ;
  - `PLANE_TARGET_COORDINATES: readonly ["workspaceSlug", "projectId", "storageOrigin", "maxAttachmentBytes"]`, `PLANE_HYPOTHESES`.

**Version épinglée.** `PLANE_PINNED_VERSION` se fixe à l'exécution par `gh api repos/makeplane/plane/releases/latest --jq .tag_name`. Il est ensuite gelé dans `profile.ts` et dans le Compose de Task 16 ; un test compare les deux. Un changement de version fait un nouveau profil exact : l'entrée `plane` de la matrice se rouvre.

**Profil.** C'est l'entrée Plane de la fixture (`attachmentUpload: "unproven"`, `visibility: "declared"`, `consistentLookup { external-id, unproven }`, `bodyFormat: "html"`, `auth.mode: "api-key"`), avec `providerVersion = PLANE_PINNED_VERSION`. Le schéma L1 interdit `qualified` à un profil auto-hébergé sans version.

**Appels.**

| Opération | Requête | Source |
| --- | --- | --- |
| auth | `auth: { header: "x-api-key", prefix: "", secret }` | https://developers.plane.so/api-reference/issue/add-issue |
| version | `GET {base}/api/instances/` ; seul `instance.current_version` est lu et comparé exactement à `PLANE_PINNED_VERSION` (sinon `plane.instance-nonconformant`) ; la réponse peut porter l'adresse de l'administrateur, rien d'autre n'est lu | code `apps/api/plane/license/api/views/instance.py` au tag lu (H-PL-1) |
| projet | `GET /api/v1/workspaces/{slug}/projects/{projectId}/` | introduction de l'API Plane (non relue) |
| auteur | route v1 `users/me/` (préfixe `/api/v1`), présente dans `apps/api/plane/api/urls/user.py` au tag lu | H-PL-6 |
| création | `POST /api/v1/workspaces/{slug}/projects/{projectId}/work-items/` `{ name, description_html, external_id: marker.text, external_source: "signalement" }` → 201 ; doublon : 409 avec `id` au tag lu | https://developers.plane.so/api-reference/issue/add-issue (« … for sync and import correlation ») ; H-PL-3 |
| reprise d'item | `GET …/work-items/?external_id=<marker.text>&external_source=signalement` → l'objet seul (200) ou 404 au tag lu ; requête exacte, donc sans balayage, et `notBefore` sans objet | https://developers.plane.so/api-reference/issue/list-issues (« for filtering or lookup ») ; H-PL-2 |
| commentaire | `POST …/work-items/{id}/comments/` `{ comment_html, external_id: marker.text, external_source: "signalement" }` | doc des commentaires Plane (non relue) |
| reprise de commentaire | `GET …/work-items/{id}/comments/?external_id=…&external_source=signalement` | décrit pour l'API v2 ; à prouver en v1 (H-PL-7) |
| pièce jointe | (1) `POST …/work-items/{id}/attachments/` `{ name, type, size, external_id, external_source }` → `upload_data { url, fields }`, `asset_id` ; (2) `POST upload_data.url`, multipart (champs, puis `file`), `auth: null` ; (3) `PATCH …/attachments/{asset_id}/` `{ is_uploaded: true }` → 204 | https://developers.plane.so/api-reference/issue-attachments/get-upload-credentials, `…/complete-upload` |
| changements | `GET …/work-items/?per_page=100&order_by=updated_at&cursor=<c>` → `next_cursor` ; un item est fermé si son état appartient au groupe `completed` ou `cancelled` (`GET …/states/`) | https://developers.plane.so/api-reference/issue/list-issues |

**Règles fixées.**
- `parsePlaneTarget` :
  - `baseUrl` en `https:` ou en `http:` de bouclage, sans chemin ni requête ;
  - `storageOrigin` vaut par défaut l'origine de `baseUrl` ;
  - `workspaceSlug` doit apparier `^[a-z0-9-]{1,48}$`, et `projectId` est un UUID ;
  - `maxAttachmentBytes` est un entier de `1` à `104_857_600`, par défaut `5_242_880` (défaut de `FILE_SIZE_LIMIT` dans `apps/api/plane/settings/common.py` au tag lu ; propre à chaque instance, donc déclaré par destination).
- `findByMarker` :
  - 200 rend `strong` avec l'item, si son `created_by` est l'utilisateur de la clé ;
  - 200 rend `strong`, `null`, si un autre utilisateur l'a créé ;
  - 404 rend `strong`, `null` ;
  - tout autre statut rend un échec typé ;
  - quand `within` est non nul, même logique sur les commentaires.
- `create` : un 409 rend `conflict`/`plane.external-id-exists`, jamais un succès.
- `attach`, avant toute requête :
  - une taille au-delà de `maxAttachmentBytes` rend `unsupported`/`plane.attachment-too-large` ;
  - un type MIME hors `text/markdown`, `image/png`, `video/webm`, `video/mp4` rend `plane.attachment-type-unsupported`.
- `attach`, après l'étape (1) :
  - si `new URL(upload_data.url).origin !== storageOrigin`, le résultat est `plane.untrusted-upload-url`, et aucune requête de stockage n'est envoyée ;
  - `fields` doit compter au plus 16 entrées de type chaîne, chacune de 4096 caractères au plus, sinon `plane.malformed-response` ;
  - un `acl` dont la valeur n'est pas `private` rend `plane.attachment-public-acl`, et aucune requête de stockage n'est envoyée.
- `remoteUrl` vaut `${baseUrl}/${slug}/projects/${projectId}/issues/${id}` (H-PL-5).

**Hypothèses.**
- H-PL-1 : `current_version` est égal au tag de l'image.
- H-PL-2 : la recherche par `external_id` est fortement cohérente.
- H-PL-3 : un doublon à la création rend 409.
- H-PL-4 : le téléversement présigné vers l'origine de stockage réussit, le `PATCH` rend 204, et l'actif n'est pas lisible anonymement.
- H-PL-5 : forme de l'URL web d'un item.
- H-PL-6 : `x-api-key` suffit pour tous les appels v1 utilisés.
- H-PL-7 : le filtre `external_id` des commentaires existe en v1.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
test("presigned upload URL outside the storage origin is refused with zero storage request", async () => { /* upload_data.url "https://evil.example/u" */ });
test("storage request carries no auth", async () => { /* storage request: auth === null, no x-api-key header */ });
test("acl other than private → unsupported, no storage request", async () => { /* fields.acl "public-read" */ });
test("file above the declared limit → unsupported before any request", async () => { /* zero calls */ });
test("a version mismatch refuses the instance", async () => { /* current_version "v0.0.0" → plane.instance-nonconformant */ });
test("a 409 on create is a declared conflict, never a success", async () => { /* … */ });
test("findByMarker ignores an item carrying the marker but authored by another account", async () => { /* created_by ≠ me */ });
test("findByMarker with within searches comments only", async () => { /* … */ });
test("plain http is refused unless loopback", () => {
  expect(parsePlaneTarget(target({ baseUrl: "http://plane.example" })).ok).toBe(false);
  expect(parsePlaneTarget(target({ baseUrl: "http://127.0.0.1:18080" })).ok).toBe(true);
});
```

- [ ] **Step 2: Rouge** — `bun test connectors/plane`.
- [ ] **Step 3: Implémenter** le module.
- [ ] **Step 4: Vert** — attendu : `0 fail`.
- [ ] **Step 5: Neutraliser** — deux substitutions, une à la fois, puis restaurer :
  - remplacer la comparaison d'origine par `true` : le premier test rougit ;
  - poser `auth: { header: "x-api-key", … }` sur la requête de stockage : le deuxième test rougit.
- [ ] **Step 6: Commit** — `git add connectors/plane`, `bun run check`, puis `git commit -s -m "feat(connectors): add self-hosted Plane connector pinned to one version"`.

### Task 11: Dialecte Plane et conformance sur le faux

**Files:**
- Create: `connectors/conformance/dialects/plane.ts`
- Test: `connectors/conformance/plane.conformance.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 10.
- Produces: `planeDialect(options: { version: string; storageOrigin: string; uploadAcl: string | null; viewerId: string; foreignMarker: string | null; tamperUrls: boolean; duplicateCreates: boolean }): FakeDialect & { observer(store: FakeStore): RemoteObserver }`.

**Comportements scriptés.** Ils reprennent le code lu au tag `v1.4.2`, à titre d'hypothèses :
- un doublon d'`external_id` rend 409 avec `id`, sauf avec `duplicateCreates`, réservé aux mutants ;
- la recherche par `external_id` rend l'objet seul, ou 404 ;
- le téléversement présigné rend une `url` égale à `storageOrigin + "/uploads"`, et `fields` porte `acl` si `uploadAcl` est non nul ;
- le `PATCH` rend 204 ;
- la pagination passe par `next_cursor`.

- [ ] **Step 1: Écrire le test qui échoue** — la boucle de Task 5 sur `planeSubject()`, plus un test : avec `uploadAcl: "public-read"`, le cas des pièces jointes prend le repli déclaré, et aucune requête de stockage ne part.
- [ ] **Step 2: Rouge** — `bun test connectors/conformance/plane.conformance.test.ts`.
- [ ] **Step 3: Implémenter** `dialects/plane.ts`.
- [ ] **Step 4: Vert** — attendu : `0 fail`.
- [ ] **Step 5: Neutraliser** — avec `duplicateCreates: true`, faire rendre à `findByMarker` la constante `strong`, `null` : `predicate-duplicate-external-item` rougit. Restaurer.
- [ ] **Step 6: Commit** — `git add` des deux fichiers, `bun run check`, puis `git commit -s -m "test(conformance): run self-hosted Plane through the suite on the fake provider"`.

### Task 12: Registre `connectorFor` et `CONNECTORS`

**Files:**
- Create: `connectors/index.ts`
- Test: `connectors/index.test.ts`

**Interfaces:**
- Consumes: les quatre `index.ts` de famille ; `profileIdOf` (SDK).
- Produces (registre §4.4 bis ; seuls points d'entrée consommés par L4) :

```ts
export const CONNECTORS: readonly Connector[];          // the four published-profile connectors
export function connectorFor(profileId: string): Connector | null;
export const CONNECTOR_PROFILE_IDS: readonly string[];  // the four registry §4.1 ids, sorted
export const MATRIX_ENTRY_FOR_PROFILE: ReadonlyMap<string, string>; // profile id → provider-matrix.yaml entry id (gate, Task 14)
export const TARGET_COORDINATES: ReadonlyMap<string, readonly string[]>; // profile id → DestinationTarget.coordinates keys
```

**Correspondances.**

| Profil | Entrée de la matrice |
| --- | --- |
| `github-issues/github.com/rest-2022-11-28` | `github-issues` |
| `gitlab-issues/gitlab.com/rest-v4` | `gitlab-issues` |
| `jira-cloud/cloud/rest-v3` | `jira-cloud` |
| `plane/self-hosted/rest-v1` | `plane` |

`connectorFor` lit une table exacte (`Map`), sans normalisation de casse ni préfixe. Il ne lit pas la matrice : le filtrage des profils `qualified` appartient à L4.

- [ ] **Step 1: Écrire le test qui échoue**

```ts
test("connectorFor resolves exactly the four registry ids, each bound to its own profile", () => {
  expect(CONNECTOR_PROFILE_IDS).toEqual(["github-issues/github.com/rest-2022-11-28", "gitlab-issues/gitlab.com/rest-v4",
    "jira-cloud/cloud/rest-v3", "plane/self-hosted/rest-v1"]);
  for (const id of CONNECTOR_PROFILE_IDS) expect(connectorFor(id)?.profiles.map(profileIdOf)).toEqual([id]);
  expect(CONNECTORS.flatMap((c) => c.profiles.map(profileIdOf)).sort()).toEqual([...CONNECTOR_PROFILE_IDS]);
});
test("a family name, another version, another case or a prototype key is never a profile", () => {
  for (const id of ["github-issues", "plane/self-hosted/rest-v2", "GITHUB-ISSUES/github.com/rest-2022-11-28", "", "__proto__", "constructor"])
    expect(connectorFor(id)).toBeNull();
});
test("every profile maps to an existing provider-matrix entry", async () => {
  const matrix = Bun.YAML.parse(await Bun.file("qualification/provider-matrix.yaml").text()) as { entries: { id: string }[] };
  const ids = new Set(matrix.entries.map((e) => e.id));
  expect([...MATRIX_ENTRY_FOR_PROFILE.values()].every((id) => ids.has(id))).toBe(true);
});
```

- [ ] **Step 2: Rouge** — `bun test connectors/index.test.ts`.
- [ ] **Step 3: Implémenter** `connectors/index.ts`.
- [ ] **Step 4: Vert** — attendu : `0 fail`.
- [ ] **Step 5: Neutraliser** — remplacer la `Map` par un objet littéral indexé : le cas `__proto__`/`constructor` rougit. Restaurer.
- [ ] **Step 6: Commit** — `git add connectors/index.ts connectors/index.test.ts`, `bun run check`, puis `git commit -s -m "feat(connectors): expose connectorFor and CONNECTORS"`.
