# L3, partie 1 — SDK et faux fournisseur (tâches 1 à 7)

Index, contraintes globales et Review Focus : `2026-10-24-v1-L3-sdk-projection-core.md`.

### Task 1: Texte Apache-2.0, squelette du SDK et gate de frontière des paquets

**Files:**
- Create: `LICENSES/Apache-2.0.txt`, `packages/connector-sdk/index.ts`, `packages/connector-sdk/README.md`, `tools/ci/package-boundary.ts`, `tools/ci/check-package-boundaries.ts`
- Test: `tools/ci/package-boundary.test.ts`
- Modify: `package.json:43` (`check:tree` : `bun run check:package-boundaries` ajouté après `check:public-boundary`) ; nouveau script `check:package-boundaries` après `package.json:48`

**Interfaces:**
- Consumes : `REUSE.toml:19-22`, `Bun.Glob`, `Bun.Transpiler#scanImports`, `Bun.TOML.parse`.
- Produces :

```ts
export interface BoundaryPolicy {
  readonly root: string;                                  // repo-relative package directory
  readonly allowedSource: readonly RegExp[];              // resolved repo-relative specifiers allowed in non-test files
  readonly allowedTest: readonly RegExp[];                // additional specifiers allowed in *.test.ts
  readonly typeOnly: readonly RegExp[];                   // must be imported with `import type` in non-test files
  readonly forbiddenTokens: readonly string[];            // substrings refused in non-test files
  readonly tokenExemptions: Readonly<Record<string, readonly string[]>>; // file (repo-relative) → tokens it may use
}
export interface BoundaryFinding { readonly path: string; readonly code: "import" | "type-only" | "token" | "dynamic-specifier" | "scanner-mismatch"; readonly detail: string }
export interface BoundaryReport { readonly files: number; readonly testFiles: number; readonly specifiers: number; readonly unreadable: readonly string[]; readonly findings: readonly BoundaryFinding[] }
export const PACKAGE_BOUNDARY_POLICIES: readonly BoundaryPolicy[];
export function inspectPackageBoundary(repoRoot: string, policy: BoundaryPolicy): BoundaryReport;
```

**Politique `packages/connector-sdk`.**
- Imports permis :
  - en source, les relatifs résolus sous `packages/connector-sdk/` seulement ;
  - en test, en plus `bun:test`, `node:fs`, `node:os`, `node:path` et `node:child_process`.
- `forbiddenTokens` : `fetch(`, `Bun.dns`, `Bun.file`, `Bun.write`, `Bun.spawn`, `node:`, `process.`, `require(`, `revealSecret(`, `console.`.
- `tokenExemptions` :
  - `packages/connector-sdk/fetch-http-port.ts` → `fetch(`, `Bun.dns`, `revealSecret(` ;
  - `packages/connector-sdk/secret.ts` → `revealSecret(`.

La politique de `projection-core` s'ajoute à la tâche 8.

- [ ] **Test rouge** (`tools/ci/package-boundary.test.ts`). Un dépôt de fixture est écrit dans `mkdtempSync(join(tmpdir(), "boundary-"))`.

```ts
test("the real connector-sdk tree has files, specifiers counted and no finding", () => {
  const report = inspectPackageBoundary(repoRoot, sdk);
  expect(report.files).toBeGreaterThan(0);
  expect(report.unreadable).toEqual([]);
  expect(report.findings).toEqual([]);
});
test("EUPL value import, EUPL type import, bare package, dynamic specifier, fetch and revealSecret are refused", () => {
  const root = fixtureRepo({
    "packages/connector-sdk/a.ts": 'import { buildReview } from "../domain/export.ts";\n',
    "packages/connector-sdk/b.ts": 'import type { ExportInput } from "../domain/export.ts";\n',
    "packages/connector-sdk/c.ts": 'export * from "ajv";\n',
    "packages/connector-sdk/d.ts": "const name = 'x'; await import(name);\n",
    "packages/connector-sdk/e.ts": 'await fetch("https://example.invalid");\n',
    "packages/connector-sdk/f.ts": "revealSecret(handle);\n",
    "packages/connector-sdk/fetch-http-port.ts": 'await fetch("https://example.invalid");\n',
  });
  expect(inspectPackageBoundary(root, sdk).findings.map((f) => `${f.path}:${f.code}`).sort()).toEqual([
    "packages/connector-sdk/a.ts:import", "packages/connector-sdk/b.ts:import", "packages/connector-sdk/c.ts:import",
    "packages/connector-sdk/d.ts:dynamic-specifier", "packages/connector-sdk/e.ts:token", "packages/connector-sdk/f.ts:token",
  ]);
});
test("an absent package directory is a failure, never a clean zero", () => {
  expect(inspectPackageBoundary(fixtureRepo({ "README.md": "x" }), sdk)).toMatchObject({ files: 0, unreadable: ["packages/connector-sdk"] });
});
test("Apache-2.0 text is present and REUSE assigns it to the SDK only", async () => {
  const text = await Bun.file(join(repoRoot, "LICENSES/Apache-2.0.txt")).text();
  expect(text.trimStart().startsWith("Apache License")).toBe(true);
  expect(text).toContain("Version 2.0, January 2004");
  const reuse = Bun.TOML.parse(await Bun.file(join(repoRoot, "REUSE.toml")).text()) as { annotations: { path: string[]; "SPDX-License-Identifier": string }[] };
  expect(reuse.annotations.filter((a) => a["SPDX-License-Identifier"] === "Apache-2.0").map((a) => a.path)).toEqual([["packages/connector-sdk/**"]]);
});
```

- [ ] **Rouge attendu.** `bun test tools/ci/package-boundary.test.ts` : module introuvable.
- [ ] **Implémenter.**
  - Énumérer par `new Bun.Glob("**/*.ts").scanSync({ cwd })`, sur le système de fichiers et non par `git ls-files`, pour voir aussi les fichiers non indexés (gate-integrity §6). Répertoire absent ou vide → `unreadable`.
  - Extraire les spécificateurs par expressions régulières : `import … from`, `import type … from`, `export … from`, `import "x"`, `import(…)`, `require(…)`.
  - Second instrument : `new Bun.Transpiler({ loader: "ts" }).scanImports`. Il omet `import type`. Un chemin qu'il voit et que les expressions ont manqué → `scanner-mismatch`.
  - `import(` sans littéral → `dynamic-specifier`. Résoudre chaque relatif en chemin repo-relatif avant de le confronter aux listes.
  - `check-package-boundaries.ts` exécute toutes les politiques et imprime `package-boundaries: <root> files=<n> tests=<n> specifiers=<n> findings=0`. Sortie `1` sur toute trouvaille ou toute entrée `unreadable`.
  - Script : `"check:package-boundaries": "bun run check:bun:runtime && bun tools/ci/check-package-boundaries.ts"`.
  - `LICENSES/Apache-2.0.txt` est écrit par `uvx reuse download Apache-2.0` (texte SPDX canonique). Sans réseau : `BLOCKED`, jamais un texte retapé.
  - `index.ts` : `export {};`, remplacé à la tâche 2.
  - README : licence, frontière (« no import from this repository outside this directory, enforced by `check:package-boundaries` »), contrat de `SecretHandle`.
- [ ] **Vert.** `bun test tools/ci/package-boundary.test.ts` : `4 pass`. `bun run check:package-boundaries` : une ligne `packages/connector-sdk … findings=0`.
- [ ] **Neutralisation.** `findings.push(finding)` → `void finding` : le deuxième test rougit. Restaurer.
- [ ] **Commit.**
  - `git add LICENSES/Apache-2.0.txt packages/connector-sdk/index.ts packages/connector-sdk/README.md tools/ci/package-boundary.ts tools/ci/check-package-boundaries.ts tools/ci/package-boundary.test.ts package.json`
  - `bun run check`
  - `git commit -s -m "feat(connector-sdk): add Apache-2.0 boundary and import gate" -m "Neutralization: replacing findings.push with a no-op turns the refused-imports test red."`

### Task 2: Types, résultats et profil du SDK (registre §4.3)

**Files:**
- Create: `packages/connector-sdk/types.ts`, `packages/connector-sdk/result.ts`, `packages/connector-sdk/profile.ts`
- Modify: `packages/connector-sdk/index.ts` (barrel)
- Test: `packages/connector-sdk/result.test.ts`, `packages/connector-sdk/profile.test.ts`, `packages/connector-sdk/types.test.ts`
- Test: `tools/contracts/connector-profile-conformance.test.ts` (EUPL : il lit les fichiers vendorisés, ce que le SDK n'a pas le droit de faire)

**Interfaces:**
- Consumes : schéma et fixture L1, `vendor/contracts/contracts/schemas/signalement-connector-profile.v1.schema.json` et `vendor/contracts/contracts/fixtures/signalement-connector-profile-v1/profiles.v1.json`.
- Produces. `Result`, `ConnectorFailure`, `HttpPort`, `Connector`, `ConnectorContext`, `FindOutcome` et `RemoteItemReceipt` sont recopiés **mot pour mot** du registre §4.3. Le reste :

```ts
// result.ts
export function ok<T>(value: T): Result<T, never>;
export function err<E>(error: E): Result<never, E>;
export const CONNECTOR_FAILURE_KINDS: readonly ConnectorFailure["kind"][];   // the 9 kinds, registry order
export function connectorFailure(kind: ConnectorFailure["kind"], code: string,
  options?: { retryable?: boolean; retryAfterMs?: number | null }): ConnectorFailure;

// types.ts
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH";
export interface OutboundAuth { header: "authorization" | "private-token" | "x-api-key"; prefix: "Bearer " | "Basic " | ""; secret: SecretHandle }
export interface OutboundRequest {
  method: HttpMethod; url: string;                     // absolute; https, or http on loopback only
  headers: Readonly<Record<string, string>>;           // lowercase names, never an auth header
  body: Uint8Array<ArrayBuffer> | null;                // exact bytes (multipart included); never FormData
  auth: OutboundAuth | null;                           // only the transport reveals the secret
}
export interface OutboundResponse { status: number; headers: Readonly<Record<string, string>>; body: Uint8Array<ArrayBuffer>; requestBodyDigest: string | null } // digest set by instrumentHttpPort only
export interface DestinationTarget { destinationId: string; profileId: string; baseUrl: string; coordinates: Readonly<Record<string, string>> }
export interface RemoteAttributes { visibility: "public" | "internal" | "private" | "unknown"; attachmentUpload: boolean } // same shape as DiscoveredAttributes (registry §4.2), checked in task 8
export interface Discovery { profileId: string; edition: string; apiVersion: string; providerVersion: string | null; attributes: RemoteAttributes }
export interface MappingReport { valid: boolean; issues: readonly { field: string; code: string }[] }
export interface RemoteItemRef { kind: "item" | "comment"; remoteId: string; remoteUrl: string }
export interface ProjectionMarker { projectionId: string; deliveryKey: string; text: string; within: RemoteItemRef | null; notBefore: string } // notBefore: first attempt, ISO 8601; list recovery never looks earlier
export interface AdfText { type: "text"; text: string; marks?: readonly { type: "link"; attrs: { href: string } }[] }
export type AdfNode =
  | { type: "heading"; attrs: { level: 2 | 3 }; content: AdfText[] } | { type: "paragraph"; content: AdfText[] }
  | { type: "codeBlock"; content: AdfText[] }
  | { type: "bulletList"; content: { type: "listItem"; content: { type: "paragraph"; content: AdfText[] }[] }[] };
export interface AdfDocument { version: 1; type: "doc"; content: readonly AdfNode[] }
export type RenderedContent =
  | { format: "markdown"; title: string; text: string } | { format: "adf"; title: string; document: AdfDocument }
  | { format: "html"; title: string; html: string };
export interface CreateRequest { target: DestinationTarget; content: RenderedContent; marker: ProjectionMarker; idempotencyKey: string }
export interface CommentRequest { target: DestinationTarget; remote: RemoteItemRef; content: RenderedContent; marker: ProjectionMarker; idempotencyKey: string }
export interface AttachRequest { target: DestinationTarget; remote: RemoteItemRef; fileName: string; mimeType: string; bytes: Uint8Array<ArrayBuffer> }
export interface AttachmentReceipt { path: string; remoteId: string; requestBodyDigests: string[] }
export interface RemoteChange { remote: RemoteItemRef; status: "open" | "closed"; updatedAt: string }
export interface ChangePage { items: readonly RemoteChange[]; nextCursor: string | null }

// profile.ts
export interface ConnectorProfile { /* mirror of the L1 schema, see below */ }
export const CONNECTOR_PROFILE_FIELDS: readonly (keyof ConnectorProfile)[];
export function profileIdOf(profile: ConnectorProfile): string;
export function attachmentModeOf(profile: ConnectorProfile): "upload" | "none";        // "upload" iff attachmentUpload === "supported"
export function lookupOf(profile: ConnectorProfile): "strong" | "unavailable";         // "strong" iff consistentLookup.status === "supported"
```

**`ConnectorProfile`** est le miroir exact du schéma L1 (plan L1, profil). Les propriétés connues à ce jour :
- `schemaVersion`, `profileId`, `family`, `edition`, `api { style, version }`, `providerVersion`, `auth { mode, scopes }`, `bodyFormat` ;
- `capabilities`, avec `discovery`, `mappingValidation`, `idempotentCreate`, `attachExisting`, `attachmentUpload`, `comment`, `cursorRead`, `visibility`, `consistentLookup { method, status }` ;
- `limits`, `conflictPolicy`.

La source fait foi : `jq '.properties | keys' <schéma>`. Une capacité `unproven` est lue comme absente, ce qui suit le plan L5.

- [ ] **Tests rouges.**

```ts
// result.test.ts
test("failure kinds are the nine of the registry, in order", () => {
  expect(CONNECTOR_FAILURE_KINDS).toEqual(["auth", "not-found", "rate-limited", "conflict", "unsupported", "invalid-mapping", "ambiguous", "transport", "provider-error"]);
});
test("retryable defaults: rate-limited, ambiguous and transport only", () => {
  expect(CONNECTOR_FAILURE_KINDS.filter((k) => connectorFailure(k, "x").retryable)).toEqual(["rate-limited", "ambiguous", "transport"]);
});
test("a code that could carry a provider body is refused", () => {
  for (const code of ["", "Bad Request", '{"message":"x"}', "a".repeat(65), "x\ny", "UPPER"])
    expect(() => connectorFailure("provider-error", code)).toThrow("connector-failure.code");
});
test("retryAfterMs is null or a safe integer in [0, 86400000]", () => {
  for (const value of [-1, 1.5, 86_400_001, Number.NaN])
    expect(() => connectorFailure("rate-limited", "x", { retryAfterMs: value })).toThrow("connector-failure.retry-after");
});
// profile.test.ts — literal profiles built in the test from the L1 field list
test("unproven and unsupported capabilities read as absent", () => {
  expect(attachmentModeOf(profileWith({ attachmentUpload: "unproven" }))).toBe("none");
  expect(attachmentModeOf(profileWith({ attachmentUpload: "supported" }))).toBe("upload");
  expect(lookupOf(profileWith({ consistentLookup: { method: "issue-list", status: "unproven" } }))).toBe("unavailable");
  expect(lookupOf(profileWith({ consistentLookup: { method: "external-id", status: "supported" } }))).toBe("strong");
});
// types.test.ts — compile-time, checked by `bun run typecheck`
test("Connector and ProjectionMarker match the registry", () => {
  expectTypeOf<Connector["findByMarker"]>().toEqualTypeOf<(t: DestinationTarget, m: ProjectionMarker, c: ConnectorContext) => Promise<Result<FindOutcome, ConnectorFailure>>>();
  expectTypeOf<ProjectionMarker["notBefore"]>().toEqualTypeOf<string>();
});
// tools/contracts/connector-profile-conformance.test.ts
test("ConnectorProfile fields equal the L1 schema properties", () => {
  expect([...CONNECTOR_PROFILE_FIELDS].sort()).toEqual(Object.keys(schema.properties).sort());
});
test("accessors over the four published profiles", () => {
  const byId = new Map(fixture.profiles.map((p: ConnectorProfile) => [profileIdOf(p), p]));
  expect([...byId.keys()].sort()).toEqual(["github-issues/github.com/rest-2022-11-28", "gitlab-issues/gitlab.com/rest-v4", "jira-cloud/cloud/rest-v3", "plane/self-hosted/rest-v1"]);
  expect([...byId.values()].map(attachmentModeOf)).toEqual(expectedModesFromFixtureCells);
});
```

`expectedModesFromFixtureCells` est écrit dans le test à partir des cellules publiées par L1 (`attachmentUpload` : GitHub `unsupported`, GitLab `supported`, Jira `supported`, Plane `unproven`), relues à l'exécution par `jq '.profiles[] | [.profileId, .capabilities.attachmentUpload]' <fixture>`.

- [ ] **Rouge attendu.** `bun test packages/connector-sdk tools/contracts/connector-profile-conformance.test.ts` : modules introuvables.
- [ ] **Implémenter.**
  - `connectorFailure` valide `code` contre `^[a-z][a-z0-9]*(?:[.-][a-z0-9]+){0,7}$` (≤ 64 caractères), sinon `TypeError("connector-failure.code")`.
  - `CONNECTOR_PROFILE_FIELDS` porte `satisfies` et une assertion d'exhaustivité (`Exclude<keyof ConnectorProfile, (typeof FIELDS)[number]> extends never`).
- [ ] **Vert.** Les tests passent ; `bun run typecheck` : 0 erreur ; `bun run check:package-boundaries` : `findings=0`.
- [ ] **Neutralisation.**
  - Le test de motif de `connectorFailure` remplacé par `true` → le test du code de fournisseur rougit.
  - `attachmentModeOf` qui rend `"upload"` pour `unproven` → le test de capacités rougit.
  - Restaurer chaque fois.
- [ ] **Commit.**
  - `git add packages/connector-sdk/types.ts packages/connector-sdk/result.ts packages/connector-sdk/profile.ts packages/connector-sdk/index.ts packages/connector-sdk/result.test.ts packages/connector-sdk/profile.test.ts packages/connector-sdk/types.test.ts tools/contracts/connector-profile-conformance.test.ts`
  - `bun run check`
  - `git commit -s -m "feat(connector-sdk): define connector interface, typed failures and profile accessors" -m "Neutralization: accepting any failure code, or reading unproven as upload, turns its test red."`

### Task 3: `SecretHandle`, qui ne s'imprime jamais

**Files:** Create `packages/connector-sdk/secret.ts` ; Modify `packages/connector-sdk/index.ts` ; Test `packages/connector-sdk/secret.test.ts`

**Interfaces:**
- Produces :

```ts
export class SecretHandle {
  static fromString(value: string): SecretHandle;   // TypeError("secret.invalid"): empty, or contains CR, LF or NUL
  toString(): "[secret]"; toJSON(): "[secret]"; [Symbol.toPrimitive](): "[secret]"; [Bun.inspect.custom](): "[secret]";
}
export function revealSecret(handle: SecretHandle): string;  // sole access; only fetch-http-port.ts may call it (gate, task 1)
```

La valeur vit dans un champ privé `#value`. Le handle n'a aucune propriété énumérable.

- [ ] **Test rouge.**

```ts
const VALUE = "fixture-credential-not-a-secret";
test("no printing path reveals the value", () => {
  const h = SecretHandle.fromString(VALUE);
  for (const r of [String(h), `${h}`, JSON.stringify({ n: { h } }), Bun.inspect(h), Bun.inspect({ n: [h] }), Object.keys(h).join(","), JSON.stringify(structuredClone({ h })), new Error(`x ${h}`).message])
    expect(r).not.toContain(VALUE);
  expect([String(h), JSON.stringify(h), Bun.inspect(h)]).toEqual(["[secret]", '"[secret]"', "[secret]"]);
});
test("revealSecret is the only access", () => { expect(revealSecret(SecretHandle.fromString(VALUE))).toBe(VALUE); });
test("header-injection and empty values are refused", () => {
  for (const bad of ["", "a\r\nx-evil: 1", "a\nb", "a\u0000b"]) expect(() => SecretHandle.fromString(bad)).toThrow("secret.invalid");
});
```

- [ ] **Rouge attendu**, puis **implémenter**, puis **vert** : `bun test packages/connector-sdk/secret.test.ts`, `3 pass`.
- [ ] **Neutralisation.**
  - `toJSON()` qui rend `this.#value` → le premier test rougit. Restaurer.
  - Contre-épreuve, à relever : `[Bun.inspect.custom]()` qui rend `this` ne fait rien fuir, parce que le champ est privé. Cette substitution ne discrimine pas.
- [ ] **Commit.**
  - `git add packages/connector-sdk/secret.ts packages/connector-sdk/secret.test.ts packages/connector-sdk/index.ts`
  - `bun run check`
  - `git commit -s -m "feat(connector-sdk): add non-printing SecretHandle" -m "Neutralization: toJSON returning the private value turns the printing test red."`

### Task 4: `instrumentHttpPort` et `parseRetryAfter`

**Files:** Create `packages/connector-sdk/http.ts`, `packages/connector-sdk/retry-after.ts` ; Modify `index.ts` ; Test `http.test.ts`, `retry-after.test.ts` (même répertoire)

**Interfaces:**
- Produces :

```ts
export interface InstrumentedHttpPort extends HttpPort { readonly sentBodyDigests: readonly string[] }
export function instrumentHttpPort(port: HttpPort): InstrumentedHttpPort;
export function parseRetryAfter(value: string | undefined, now: string): number | null;  // ms; null if absent, invalid or > 86400 s; past date → 0
```

Contrôles faits **avant** l'appel interne. Toute violation lève `TypeError` :
- `http.method` : méthode hors de `HttpMethod` ;
- `http.url` : URL non absolue ; ou ni `https:`, ni `http:` sur `localhost`, `127.0.0.1` ou `[::1]` ;
- `http.header` : nom hors de `^[a-z0-9!#$%&'*+.^_\`|~-]+$`, ou valeur contenant CR, LF ou NUL ;
- `http.secret-header` : en-tête simple nommé `authorization`, `proxy-authorization`, `cookie`, `private-token` ou `x-api-key`.

Traitement du corps :
- le corps est copié ;
- le SHA-256 hexadécimal de la copie est ajouté à `sentBodyDigests` **avant** l'appel : une requête que le transport rejette a pu partir ;
- c'est la copie qui part ;
- la réponse porte `requestBodyDigest` (ou `null`), qui écrase la valeur du transport interne.

- [ ] **Tests rouges.** Le digest `44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a` est celui des octets `{}` (`printf '{}' | shasum -a 256`).

```ts
test("records each body digest in send order and overwrites the inner digest", async () => {
  const port = instrumentHttpPort(innerReturning({ requestBodyDigest: "forged" }));
  const r = await port.send(post("{}"));
  await port.send({ ...post("{}"), method: "GET", body: null });
  expect([r.requestBodyDigest, port.sentBodyDigests]).toEqual([D_EMPTY_OBJECT, [D_EMPTY_OBJECT]]);
});
test("digest and forwarded bytes are a private copy taken before the inner send", async () => {
  const body = new TextEncoder().encode("{}");
  const pending = port.send({ ...post("{}"), body });
  body.fill(0x41);
  expect((await pending).requestBodyDigest).toBe(D_EMPTY_OBJECT);
  expect(new TextDecoder().decode(innerSeen.at(-1))).toBe("{}");
});
test("a body handed to a failing transport is still recorded", async () => { /* inner throws "reset" → rejects, sentBodyDigests length 1 */ });
test("refuses secret-bearing plain headers, bad names, bad URLs and bad methods", async () => {
  for (const name of ["authorization", "proxy-authorization", "cookie", "private-token", "x-api-key"])
    await expect(port.send({ ...post("{}"), headers: { [name]: "x" } })).rejects.toThrow("http.secret-header");
  for (const url of ["http://fake-provider.invalid/x", "javascript:alert(1)", "/relative", "ftp://h/x"])
    await expect(port.send({ ...post("{}"), url })).rejects.toThrow("http.url");
  await expect(port.send({ ...post("{}"), url: "http://localhost:8080/x" })).resolves.toBeDefined();
});
// retry-after.test.ts, now = "2026-10-24T10:00:00Z"
test.each([["120", 120_000], ["0", 0], [undefined, null], ["", null], ["-1", null], ["1.5", null], ["86401", null],
  ["86400", 86_400_000], ["Sat, 24 Oct 2026 10:02:00 GMT", 120_000], ["Sat, 24 Oct 2026 09:00:00 GMT", 0], ["not a date", null]])
  ("parseRetryAfter(%p) = %p", (v, e) => { expect(parseRetryAfter(v as string | undefined, now)).toBe(e as number | null); });
```

- [ ] **Rouge attendu**, puis **implémenter** (digest par `crypto.subtle.digest`), puis **vert**.
- [ ] **Neutralisation.**
  - `const copy = new Uint8Array(request.body)` → `const copy = request.body` : le test « private copy » rougit.
  - Le contrôle `http.secret-header` remplacé par un no-op : le test des refus rougit.
  - Restaurer chaque fois.
- [ ] **Commit.**
  - `git add packages/connector-sdk/http.ts packages/connector-sdk/retry-after.ts packages/connector-sdk/http.test.ts packages/connector-sdk/retry-after.test.ts packages/connector-sdk/index.ts`
  - `bun run check`
  - `git commit -s -m "feat(connector-sdk): instrument outbound bodies with SHA-256 digests" -m "Neutralization: forwarding the caller buffer instead of a copy turns the private-copy test red."`

### Task 5: `createFetchHttpPort`, le transport réel

`createFetchHttpPort` vit dans le SDK (registre §4.3). Il est consommé par le dispatcher L4 et par l'outillage de qualification L5. Les options et les codes d'erreur sont ceux qu'attend déjà le plan L4.

**Files:** Create `packages/connector-sdk/fetch-http-port.ts` ; Modify `index.ts` ; Test `packages/connector-sdk/fetch-http-port.test.ts`

**Interfaces:**
- Consumes : `HttpPort`, `OutboundRequest`, `revealSecret`.
- Produces :

```ts
export function createFetchHttpPort(options: { timeoutMs: number; maxResponseBytes: number; allowPrivate: boolean }): HttpPort; // registry §4.3, exact
```

Aucune option ne désactive la vérification TLS, et aucune n'ajoute une autorité de certification.

**Règles.** Chaque refus lève `Error("egress.<code>")`, sans corps, sans en-tête, sans URL dans le message.
1. Résolution de l'hôte par `Bun.dns.lookup` avant tout envoi, pour un nom comme pour un littéral IP. Échec → `egress.dns`.
2. Garde SSRF sur les adresses **résolues**, et non sur le nom ; **toutes** sont contrôlées. Refus → `egress.address_refused` :
   - toujours, même avec `allowPrivate` : lien-local `169.254.0.0/16`, `fe80::/10`, non spécifiée `0.0.0.0` et `::` ;
   - sauf si `allowPrivate` : privées `10/8`, `172.16/12`, `192.168/16`, `fc00::/7`, et bouclage `127/8`, `::1`.
3. Connexion à l'adresse vérifiée, et non à un nouveau nom résolu, pour fermer la fenêtre de « DNS rebinding ». Le nom d'hôte reste dans `Host` et dans le SNI TLS (`tls.serverName`). *À vérifier à l'exécution* : la prise en charge de `tls.serverName` par `fetch` dans la version de Bun épinglée (`bun --version`). Si elle manque : connexion par nom, limite consignée dans le README du SDK et dans la PR.
4. TLS vérifié, échec fermé : jamais `rejectUnauthorized: false`. Un certificat non approuvé lève `egress.tls`.
5. `redirect: "manual"` : une réponse 3xx est rendue telle quelle, jamais suivie.
6. `AbortSignal.timeout(timeoutMs)` → `egress.timeout`.
7. Lecture bornée, morceau par morceau. Au-delà de `maxResponseBytes` → `egress.response_too_large`.
8. En-tête d'authentification posé au moment de l'appel : `request.auth.header`, valeur `prefix + revealSecret(secret)`. Aucune copie de la valeur n'est conservée.
9. Aucune journalisation : ni `console.*` ni rapport d'erreur portant corps, en-têtes ou URL. Le gate de la tâche 1 interdit `console.` dans le SDK.

- [ ] **Tests rouges.** Serveurs locaux par `Bun.serve` (HTTP sur `localhost`, joints avec `allowPrivate: true`). Le serveur TLS utilise un certificat auto-signé généré dans `mktemp -d` par `openssl req -x509 -newkey ed25519 -nodes -subj /CN=localhost -addext subjectAltName=DNS:localhost`, lancé par `node:child_process` (permis en test). Si `openssl` est absent, le test **échoue** ; il ne se saute jamais.

```ts
test("refuses an untrusted certificate", async () => {
  await expect(createFetchHttpPort({ ...base, allowPrivate: true }).send(get(`https://localhost:${tlsPort}/`))).rejects.toThrow("egress.tls");
});
test("does not follow redirects", async () => { /* 302 returned, server saw exactly one request */ });
test.each(["https://127.0.0.1/", "https://10.0.0.1/", "https://169.254.169.254/", "https://[::1]/", "https://localhost/"])
  ("allowPrivate false refuses %s (resolved address, not the name)", async (url) => {
    await expect(createFetchHttpPort(base).send(get(url))).rejects.toThrow("egress.address_refused");
  });
test("link-local stays refused even with allowPrivate", async () => {
  for (const url of ["https://169.254.169.254/", "https://[fe80::1]/"])
    await expect(createFetchHttpPort({ ...base, allowPrivate: true }).send(get(url))).rejects.toThrow("egress.address_refused");
});
test("a hung server times out; an oversized response is cut", async () => { /* timeoutMs 200 → egress.timeout; maxResponseBytes 16 → egress.response_too_large */ });
test("the secret is revealed only into the declared auth header, and nothing is logged", async () => {
  // spy console.log/info/warn/error/debug; send with auth { header: "authorization", prefix: "Bearer ", secret }
  // server sees that header with prefix + secret; no other header, URL or body holds the value; error paths too; spies called 0 times
});
```

- `base` = `{ timeoutMs: 30000, maxResponseBytes: 8388608, allowPrivate: false }`, les valeurs fixées par le plan L4.
- Les tests commentés s'écrivent en entier selon leur commentaire.

- [ ] **Rouge attendu**, puis **implémenter**, puis **vert** : `bun test packages/connector-sdk/fetch-http-port.test.ts`. `bun run check:package-boundaries` : `findings=0`, avec l'exemption de la tâche 1.
- [ ] **Neutralisation.**
  - `redirect: "manual"` → `redirect: "follow"` : le test de redirection rougit.
  - Option `tls: { rejectUnauthorized: false }` ajoutée : le test de certificat rougit.
  - Prédicats d'adresses, chacun remplacé par `false`, l'un après l'autre :
    - bouclage IPv4 → les cas `127.0.0.1` et `localhost` rougissent ;
    - privé `10/8` → le cas `10.0.0.1` rougit ;
    - lien-local → les cas `169.254.169.254` rougissent ;
    - bouclage IPv6 → le cas `[::1]` rougit.
  - Contrôle fait sur le nom au lieu de l'adresse résolue (le littéral `localhost` n'est pas une IP) : le cas `localhost` rougit.
  - Restaurer chaque fois.
- [ ] **Commit.**
  - `git add packages/connector-sdk/fetch-http-port.ts packages/connector-sdk/fetch-http-port.test.ts packages/connector-sdk/index.ts`
  - `bun run check`
  - `git commit -s -m "feat(connector-sdk): add fail-closed fetch transport" -m "Neutralization: following redirects, skipping the link-local check or disabling certificate verification each turn their test red."`

### Task 6: Faux fournisseur — capture, pannes, magasin, dialecte de référence

**Files:**
- Create: `packages/fake-provider/{provider,reference-dialect,leaks,export-fixture,index}.ts`, `packages/fake-provider/README.md`
- Test: `packages/fake-provider/provider.test.ts`, `packages/fake-provider/leaks.test.ts`

**Interfaces:**
- Consumes : `HttpPort`, `OutboundRequest`, `OutboundResponse`, `HttpMethod` (SDK) ; `buildReview`, `readZip` (`packages/domain`).
- Produces :

```ts
export interface CapturedRequest { seq: number; method: HttpMethod; url: string; path: string; headers: Readonly<Record<string, string>>; authHeader: string | null; body: Uint8Array<ArrayBuffer> }
export interface RequestMatcher { method: HttpMethod; path: RegExp; occurrence: number }   // 1-based among matching requests
export type FakeFault =
  | { kind: "drop-after-send"; match: RequestMatcher }      // applied to the store, then send() rejects "fake.connection-reset"
  | { kind: "respond"; match: RequestMatcher; status: number; headers: Readonly<Record<string, string>>; applied: boolean }
  | { kind: "visibility-read-failure" };                     // destination read answers 503
export function rateLimited(match: RequestMatcher, retryAfterSeconds: number): FakeFault;     // respond 429 + retry-after, applied false
export function serverError(match: RequestMatcher, status: 500 | 502 | 503, applied: boolean): FakeFault;
export interface FakeItem { id: string; destinationKey: string; url: string; createdAt: string; title: string; body: string; comments: { id: string; url: string; createdAt: string; body: string }[]; attachments: { id: string; fileName: string; bytes: Uint8Array<ArrayBuffer> }[] }
export interface FakeStore { items: FakeItem[]; visibility: Map<string, "public" | "internal" | "private" | "unknown">; nextId(): string; now(): string }
export interface ParsedFakeRequest { method: HttpMethod; path: string; query: URLSearchParams; headers: Readonly<Record<string, string>>; body: Uint8Array<ArrayBuffer> }
export interface FakeReply { status: number; headers: Readonly<Record<string, string>>; body: Uint8Array<ArrayBuffer> }
export interface FakeDialect { readonly id: string; handle(request: ParsedFakeRequest, store: FakeStore, search: "strong" | "unavailable"): FakeReply }
export interface FakeProviderOptions { dialect: FakeDialect; search: "strong" | "unavailable"; baseUrl: string; clock: () => string }
export interface FakeProvider { readonly http: HttpPort; readonly requests: readonly CapturedRequest[]; readonly store: FakeStore; inject(fault: FakeFault): void }
export function createFakeProvider(options?: Partial<FakeProviderOptions>): FakeProvider;
// defaults: referenceDialect, "strong", FAKE_BASE_URL, fixed clock "2026-10-24T10:00:00Z"
export const referenceDialect: FakeDialect;                  // id "fake-reference.v1"
export const FAKE_BASE_URL = "https://fake-provider.invalid";
export interface Needle { label: string; bytes: Uint8Array<ArrayBuffer> }
export interface Leak { seq: number; label: string; where: "url" | "header" | "body" }
export function findLeaks(captured: readonly CapturedRequest[], withheld: readonly Needle[]): Leak[];
export function fileNeedles(path: string, bytes: Uint8Array<ArrayBuffer>, sha256: string): Needle[];  // raw, base64, base64url, hex, sha256-hex, sha256-base64, path, basename, stem
export function textNeedle(label: string, text: string): Needle;                                      // Error("leaks.needle-too-short") under 8 bytes
export interface ExportFixture { zip: Uint8Array<ArrayBuffer>; exportDigest: string; files: ReadonlyMap<string, Uint8Array<ArrayBuffer>>; sentinels: Readonly<Record<"expected" | "observed" | "application" | "environment" | "step", string>> }
export function buildExportFixture(options?: { extraTransmittedMedia?: boolean }): Promise<ExportFixture>;
```

**Routes du `referenceDialect`**, sous `baseUrl`. `{key}` vaut `target.coordinates.destination`. Toute autre route rend `404`.

| Méthode et chemin | Réponse |
| --- | --- |
| `GET /v1/destinations/{key}` | `200 {"visibility","attachmentUpload"}` ; `503` sous `visibility-read-failure` |
| `GET /v1/destinations/{key}/items?marker=<préfixe>&since=<ISO>` | `strong` : `200 {"items":[{"id","url"}]}`, balayage des corps des items avec `createdAt ≥ since` ; `unavailable` : `501` |
| `POST /v1/destinations/{key}/items` (JSON `{title, format, content}`) | `201 {"id","url"}` |
| `GET /v1/items/{id}/comments?marker=<texte>&since=<ISO>` | comme ci-dessus, sur les commentaires |
| `POST /v1/items/{id}/comments` (JSON `{format, content}`) | `201 {"id","url"}` |
| `POST /v1/items/{id}/attachments` (octets bruts, `content-type`, `x-file-name`) | `201 {"id"}` |
| `GET /v1/destinations/{key}/changes?cursor=` | `200 {"items":[],"nextCursor":null}` |

Identifiants `fake-1`, `fake-2`… ; URL `https://fake-provider.invalid/items/<id>`.

**Capture.**
- Elle a lieu **avant** l'application d'une panne, et le corps est une copie.
- `authHeader` ne garde que le nom de l'en-tête.
- Le faux n'appelle jamais `revealSecret`. Le gate le prouve : la tâche 8 ajoute `packages/fake-provider` à `PACKAGE_BOUNDARY_POLICIES`, avec `revealSecret(` interdit.

**`buildExportFixture`.**
- Construit par `buildReview` puis `toZip` (vrai contrat d'export) ; dossier `dossier-fixture`.
- Sentinelles : `SENTINEL-EXPECTED-7c1d`, `SENTINEL-OBSERVED-2a9e`, `SENTINEL-APPLICATION-5b3f`, `SENTINEL-ENVIRONMENT-8d0c`, `SENTINEL-STEP-4e6a`.
- Médias `screenshot` PNG `kept-shot-a1` et `held-shot-b2`, plus `kept-shot-c3` si `extraTransmittedMedia`. Chacun fait 96 octets, `i => (i * 31 + seed) & 255`, avec `seed` = 7, 101 et 53.

- [ ] **Tests rouges** (valeurs exactes) :
  - `captures every request with a body copy and no secret value` : un POST d'item → `201`, `requests.length === 1`, le corps capturé contient `"title":"t"` après remise à zéro du tampon de l'appelant, `store.items.length === 1`, et `JSON.stringify(requests)` ne contient pas le secret de test ;
  - `drop-after-send applies the write then rejects` : rejet `fake.connection-reset`, `items.length === 1`, `requests.length === 1` ;
  - `429 carries retry-after and does not apply` : `[429, "120", 0]` ;
  - `5xx may or may not apply, as declared` : `applied: true` → `[502, 1]`, `false` → `[502, 0]` ;
  - `visibility read failure answers 503; unavailable search answers 501` ;
  - `since bounds the list recovery` : un item créé à `2026-10-24T09:00:00Z` qui porte le préfixe n'est pas rendu avec `since=2026-10-24T09:30:00Z` ;
  - `faults fire once, on the declared occurrence only` : trois POST, `occurrence: 2` → `[201, rejet, 201]`, `items.length === 3`.
  - Dans `leaks.test.ts` :
    - `fileNeedles` rend exactement les 9 libellés listés dans la signature ;
    - les octets bruts dans le corps sont détectés (`raw`), le SHA-256 en paramètre d'URL aussi (`where: "url"`), et `x-file-name: held-shot-b2.png` donne `basename` et `stem` ;
    - le base64 dans le corps est détecté ;
    - un corps propre donne `[]` ;
    - `textNeedle("short", "abc")` lève `leaks.needle-too-short`.
- [ ] **Rouge attendu**, puis **implémenter** : `findLeaks` cherche une suite d'octets, sans décodage, dans l'URL en UTF-8, dans chaque `nom: valeur` d'en-tête et dans le corps. README : routes, pannes, le dialecte comme point d'extension de L5, et la règle « tout ce qui est capturé est réputé envoyé ».
- [ ] **Vert.** `bun test packages/fake-provider`.
- [ ] **Neutralisation.**
  - `captured.push(record)` → `void record` : le test de capture rougit.
  - Le test d'inclusion de `findLeaks` remplacé par `false` : le test de détection rougit.
  - Restaurer chaque fois.
- [ ] **Commit.**
  - `git add packages/fake-provider/provider.ts packages/fake-provider/reference-dialect.ts packages/fake-provider/leaks.ts packages/fake-provider/export-fixture.ts packages/fake-provider/index.ts packages/fake-provider/README.md packages/fake-provider/provider.test.ts packages/fake-provider/leaks.test.ts`
  - `bun run check`
  - `git commit -s -m "test(fake-provider): add in-process provider with request capture and fault injection" -m "Neutralization: dropping the capture push, or a constant-false matcher, turns its test red."`

### Task 7: Connecteur de référence

**Files:** Create `packages/fake-provider/reference-connector.ts` ; Modify `packages/fake-provider/index.ts` ; Test `packages/fake-provider/reference-connector.test.ts`

**Interfaces:**
- Consumes : `Connector`, `ConnectorProfile`, `connectorFailure`, `ok`, `err`, `parseRetryAfter`, `lookupOf`, `attachmentModeOf` (SDK) ; `referenceDialect`.
- Produces :

```ts
export function createReferenceConnector(options: { profile: ConnectorProfile }): Connector;
export function referenceProfile(profileId: string): ConnectorProfile;  // the exact L1-published profile for this id (vendored fixture); Error("reference.unknown-profile")
```

`referenceProfile` lit la fixture L1 vendorisée. C'est permis : le paquet est EUPL et le fichier est un fichier de test. Le connecteur est réservé aux tests ; aucune API ne le sert (le prédicat `capability-overclaim` relève de L4).

**Correspondance des pannes**, à reprendre par L5 :

| Observation | `ConnectorFailure` ou résultat |
| --- | --- |
| `send` rejette sur une requête avec corps | `ambiguous`, retryable, `reference.write-unconfirmed` |
| `send` rejette sur un `GET` | `transport`, retryable, `reference.transport` |
| `5xx` sur une écriture | `ambiguous`, retryable, `reference.http-5xx-write` |
| `5xx` sur une lecture | `provider-error`, retryable, `reference.http-5xx` |
| `429` | `rate-limited`, `retryAfterMs = parseRetryAfter(headers["retry-after"], ctx.clock())` |
| `401`, `403` / `404` / `409` | `auth` non retryable / `not-found` / `conflict` |
| `501` sur une recherche, ou `lookupOf(profile) === "unavailable"` | `ok({ consistency: "unavailable" })`, sans requête dans le second cas |

Règles d'envoi :
- `findByMarker` passe `marker.notBefore` en `since` ;
- `create` et `comment` sérialisent `{title, format, content}` en JSON et recopient `requestBodyDigests` depuis `response.requestBodyDigest`. Le connecteur ne calcule jamais lui-même : un `null` donne `[]` ;
- `attach` envoie les octets bruts avec `x-file-name` ;
- l'authentification passe par `auth: { header: "authorization", prefix: "Bearer ", secret: ctx.credential }`.

- [ ] **Test rouge.**
  - `test.each` sur le tableau : une ligne par panne, injectée sur `instrumentHttpPort(fake.http)`, avec le `ConnectorFailure` exact.
  - `findByMarker is strong over the item list and bounded by notBefore` : un item antérieur à `notBefore` n'est pas trouvé.
  - `create copies the instrumented digest and never computes its own` : sur un port nu, `requestBodyDigests` vaut `[]`.
- [ ] **Rouge attendu**, puis **implémenter**, puis **vert** : `bun test packages/fake-provider`.
- [ ] **Neutralisation.** Rejet sur requête avec corps mappé vers `transport` au lieu d'`ambiguous` : la ligne correspondante rougit. Restaurer.
- [ ] **Commit.**
  - `git add packages/fake-provider/reference-connector.ts packages/fake-provider/reference-connector.test.ts packages/fake-provider/index.ts`
  - `bun run check`
  - `git commit -s -m "test(fake-provider): add reference connector with typed failure mapping" -m "Neutralization: mapping an unconfirmed write to transport turns the ambiguous-write case red."`
