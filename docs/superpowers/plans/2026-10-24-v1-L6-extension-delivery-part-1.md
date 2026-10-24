# L6 — Partie 1 : fondations extension et protocole (Tasks 1-7)

Index, Global Constraints et Review Focus : `2026-10-24-v1-L6-extension-delivery.md`.

### Task 1: Préconditions, permission `scripting` et variante de développement

**Files:**
- Modify: `tools/build/manifest.ts:3-30`, `tools/build/manifest.test.ts:4-16`, `tools/build/extensions.ts:7-60`, `package.json:45`
- Create: `apps/extension-shared/build-variant.ts`
- Test: `tools/build/manifest.test.ts`, `tools/build/variant.test.ts`

**Interfaces:**
- Consumes: aucune interface de lot (vérifie la présence de L0, L1, L4).
- Produces:
  ```ts
  // tools/build/manifest.ts
  export type BuildVariant = "release" | "development";
  export function extensionManifest(target: BrowserTarget, variant?: BuildVariant): ExtensionManifest; // défaut "release"
  // apps/extension-shared/build-variant.ts
  export const BUILD_VARIANT: BuildVariant;   // "release" si la constante de build est absente (échec fermé)
  export const ALLOW_LOOPBACK_HTTP: boolean;   // true seulement pour "development"
  ```

Valeurs fixées : variante `development` = même manifest, `name` suffixé
` (développement)`, identifiant Gecko `signalement-development@libre-ai.invalid`, sortie
`dist/extensions-development/<browser>/` ; constante `SIGNALEMENT_BUILD_VARIANT` injectée
par `Bun.build({ define: { SIGNALEMENT_BUILD_VARIANT: JSON.stringify(variant) } })` ;
`build-evidence.json` gagne `"variant"`. `build:extensions` (dans `check:tree`) ne
construit que `release`.

- [ ] **Préconditions (arrêt si une seule manque).**
  ```bash
  grep -c "observed origin retention, and gesture-bound delivery to one configured origin" docs/adr/0005-local-vault-and-reviewed-export.md
  jq -r '.contracts[] | select(.id=="signalement-delivery-envelope-v1") | .status' vendor/contracts/contracts/catalog.v1.json
  grep -n "export async function buildDeliveryEnvelope\|export interface DeliveryEnvelope\|export type DeliveryEnvelope" packages/domain/delivery-envelope.ts
  grep -rln "deliveries/uploads" apps/control-plane/src --include=*.ts | head -3
  grep -n "mountReceiver\|ReceiverHost" apps/control-plane/web/receive-contract.ts apps/control-plane/web/receive/index.ts
  grep -n "export async function startTestControlPlane\|export function startTestControlPlane" apps/control-plane/testing/harness.ts
  ```
  Attendu : `1`, `locked`, le type et le constructeur, un fichier de route, le point
  d'accroche, le banc. Sinon `BLOCKED` avec la sortie manquante.
- [ ] **Test rouge — manifest** (remplace `manifest.test.ts:4-16`) :
  ```ts
  test("every package and variant adds scripting only, with no host access and no network", () => {
    for (const target of ["chrome", "firefox", "safari"] as const)
      for (const variant of ["release", "development"] as const) {
        const manifest = extensionManifest(target, variant);
        expect(manifest.permissions).toEqual(["activeTab", "scripting"]);
        for (const key of ["host_permissions", "optional_permissions", "optional_host_permissions",
          "content_scripts", "externally_connectable", "web_accessible_resources"])
          expect(manifest).not.toHaveProperty(key);
        expect(manifest.content_security_policy.extension_pages).toContain("connect-src 'none'");
        expect(manifest.content_security_policy.extension_pages).not.toContain("unsafe-eval");
      }
    expect(extensionManifest("chrome").background).toEqual({ service_worker: "background.js" });
    expect(extensionManifest("firefox").background).toEqual({ scripts: ["background.js"] });
    expect(extensionManifest("firefox", "development").browser_specific_settings?.gecko.id)
      .toBe("signalement-development@libre-ai.invalid");
    expect(extensionManifest("firefox").browser_specific_settings?.gecko.id).toBe("signalement@libre-ai.invalid");
  });
  ```
- [ ] **Test rouge — variante.** `variant.test.ts` construit trois fois (cible `browser`,
  format `esm`, sortie sous `mkdtemp`, retirée en `afterAll`) un point d'entrée qui
  réexporte `build-variant.ts` : `define` `"release"`, `"development"`, absent → attendus
  `(false,"release")`, `(true,"development")`, `(false,"release")`.
- [ ] **Exécution rouge.** `bun test tools/build` → échec sur `["activeTab"]` et module absent.
- [ ] **Implémentation.** `manifest.ts` (`permissions`, paramètre `variant`) ;
  `build-variant.ts` (`declare const SIGNALEMENT_BUILD_VARIANT: string | undefined;`, lecture
  protégée par `typeof`, toute valeur autre que `"development"` → `"release"`) ;
  `extensions.ts` (`--variant=release|development`, défaut `release`, autre valeur → sortie
  2) ; `package.json` : `"build:extensions:development": "bun run check:bun:runtime && bun tools/build/extensions.ts --variant=development"`.
- [ ] **Exécution verte.** `bun test tools/build && bun run build:extensions && jq -r .variant dist/extensions/chrome/build-evidence.json` → `0 fail`, `release`.
- [ ] **Neutralisation.** (a) `permissions: ["activeTab"]` → test manifest rouge ;
  (b) `=== "development"` substitué par `!== "release"` → cas sans `define` à `true`, rouge.
- [ ] **Commit.**
  ```bash
  git add tools/build/manifest.ts tools/build/manifest.test.ts tools/build/extensions.ts tools/build/variant.test.ts apps/extension-shared/build-variant.ts package.json
  git commit -s -m "feat(extension): add bounded scripting permission and a fail-closed development build variant"
  ```

### Task 2: Règles d'origine (origine observée, origine du control plane)

**Files:**
- Create: `apps/extension-shared/origin.ts`
- Test: `apps/extension-shared/origin.test.ts`

**Interfaces:**
- Consumes: registre §4.1 « Origine observée » (`new URL(x).origin`, `https`/`http`, `null` si retirée).
- Produces:
  ```ts
  export type OriginRefusal = "origin.invalid" | "origin.too-long" | "origin.https-required" | "origin.credentials" | "origin.path";
  export const MAX_ORIGIN_INPUT_LENGTH = 2048;
  export function observedOriginOf(url: string | undefined): string | null;
  export function isCanonicalOrigin(value: unknown): value is string;   // observedOriginOf(value) === value
  export function parseControlPlaneOrigin(input: string, options: { allowLoopbackHttp: boolean }):
    { ok: true; origin: string } | { ok: false; code: OriginRefusal };
  export function sameOrigin(a: string | null, b: string | null): boolean; // canoniques et égales octet pour octet
  ```

Algorithmes : `observedOriginOf` — illisible ou absent → `null` ; `protocol` hors
`http:`/`https:` → `null` (exclut `blob:`, dont `origin` est l'origine interne, et
`data:`/`about:`/`file:`, dont `origin` vaut `"null"`) ; sinon `url.origin`.
`parseControlPlaneOrigin` — `trim()` ; longueur > 2048 → `origin.too-long` ; illisible ou
non `http(s)` → `origin.invalid` ; identifiants → `origin.credentials` ; `pathname !== "/"`,
`search` ou `hash` → `origin.path` ; `https:` admis ; `http:` admis seulement si
`allowLoopbackHttp && hostname === "localhost"`, sinon `origin.https-required`.

- [ ] **Test rouge.**
  ```ts
  // Credential-bearing URLs are concatenated so the public-boundary gate never sees one literally.
  const withCredentials = (rest: string) => "https://" + "user:pw@" + rest;
  test("observed origin keeps scheme, host and port only", () => {
    expect(observedOriginOf("https://exämple.org/a?b#c")).toBe("https://xn--exmple-cua.org");
    expect(observedOriginOf(withCredentials("host.example.org:443/p"))).toBe("https://host.example.org");
    expect(observedOriginOf("http://[::1]:8080/x")).toBe("http://[::1]:8080");
    expect(observedOriginOf("https://CP.Example.org:443/")).toBe("https://cp.example.org");
  });
  test("non-http(s) and unreadable URLs give null, never \"null\" nor an inner origin", () => {
    for (const url of ["about:blank", "file:///etc/hosts", "chrome://settings/", "moz-extension://abc/x.html",
      "safari-web-extension://abc/x.html", "data:text/html,x", "blob:https://a.example/uuid", "ws://a.example/",
      "not a url", "", undefined])
      expect(observedOriginOf(url)).toBeNull();
  });
  test("control plane origin: https only, canonical, no credentials or path", () => {
    const release = { allowLoopbackHttp: false };
    expect(parseControlPlaneOrigin(" https://CP.Example.org:443/ ", release)).toEqual({ ok: true, origin: "https://cp.example.org" });
    expect(parseControlPlaneOrigin("https://cp.example.org:8443", release)).toEqual({ ok: true, origin: "https://cp.example.org:8443" });
    expect(parseControlPlaneOrigin("http://cp.example.org", release)).toEqual({ ok: false, code: "origin.https-required" });
    expect(parseControlPlaneOrigin("http://localhost:3000", release)).toEqual({ ok: false, code: "origin.https-required" });
    expect(parseControlPlaneOrigin(withCredentials("cp.example.org"), release)).toEqual({ ok: false, code: "origin.credentials" });
    expect(parseControlPlaneOrigin("https://cp.example.org/receive", release)).toEqual({ ok: false, code: "origin.path" });
    expect(parseControlPlaneOrigin("https://cp.example.org/?x=1", release)).toEqual({ ok: false, code: "origin.path" });
    for (const bad of ["", "javascript:alert(1)", "data:text/html,x", "cp.example.org"])
      expect(parseControlPlaneOrigin(bad, release)).toEqual({ ok: false, code: "origin.invalid" });
    expect(parseControlPlaneOrigin(`https://a.example/${"x".repeat(2048)}`, release)).toEqual({ ok: false, code: "origin.too-long" });
  });
  test("loopback http is admitted only for localhost in the development variant", () => {
    const development = { allowLoopbackHttp: true };
    expect(parseControlPlaneOrigin("http://localhost:3000", development)).toEqual({ ok: true, origin: "http://localhost:3000" });
    expect(parseControlPlaneOrigin("http://127.0.0.1:3000", development)).toEqual({ ok: false, code: "origin.https-required" });
    expect(parseControlPlaneOrigin("http://localhost.example.org", development)).toEqual({ ok: false, code: "origin.https-required" });
  });
  test("comparison is exact between canonical origins only", () => {
    expect(sameOrigin("https://a.example", "https://a.example")).toBe(true);
    expect(sameOrigin("https://a.example", "https://a.example:443")).toBe(false);
    expect(sameOrigin("https://a.example", "https://a.example.evil")).toBe(false);
    expect(sameOrigin("http://a.example", "https://a.example")).toBe(false);
    expect(sameOrigin(null, null)).toBe(false);
    expect(sameOrigin("null", "null")).toBe(false);
    expect(isCanonicalOrigin("https://a.example/")).toBe(false);
  });
  ```
- [ ] **Exécution rouge.** `bun test apps/extension-shared/origin.test.ts` → module absent.
- [ ] **Implémentation** selon les algorithmes ; aucune dépendance.
- [ ] **Exécution verte.** même commande → `0 fail`.
- [ ] **Neutralisation.** (a) contrôle de protocole → `false` : test 2 rouge (`blob:`,
  `"null"`) ; (b) `hostname === "localhost"` → `true` : test 4 rouge ; (c) contrôle de
  canonicité de `sameOrigin` → `true` : test 5 rouge.
- [ ] **Commit.**
  ```bash
  git add apps/extension-shared/origin.ts apps/extension-shared/origin.test.ts
  git commit -s -m "feat(extension): derive the observed origin and validate the control plane origin"
  ```

### Task 3: Réglage « origine du control plane » sans permission `storage`

**Files:**
- Create: `apps/extension-shared/settings.ts`, `apps/extension-shared/settings-store.ts`
- Test: `apps/extension-shared/settings.test.ts`

**Interfaces:**
- Consumes: Task 2, Task 1 (`ALLOW_LOOPBACK_HTTP`).
- Produces:
  ```ts
  export interface SettingsStore {
    read(key: "control-plane-origin"): Promise<unknown>;
    write(key: "control-plane-origin", value: string): Promise<void>;
    remove(key: "control-plane-origin"): Promise<void>;
  }
  export function readControlPlaneOrigin(store: SettingsStore, options: { allowLoopbackHttp: boolean }): Promise<string | null>;
  export function saveControlPlaneOrigin(store: SettingsStore, input: string, options: { allowLoopbackHttp: boolean }):
    Promise<{ ok: true; origin: string } | { ok: false; code: OriginRefusal | "settings.unavailable" }>;
  export function clearControlPlaneOrigin(store: SettingsStore): Promise<void>;
  export class IndexedDbSettingsStore implements SettingsStore {   // settings-store.ts
    static open(name?: string, factory?: IDBFactory): Promise<IndexedDbSettingsStore>; // défaut "signalement-settings"
    close(): void;
  }
  ```

Valeurs fixées : base `signalement-settings`, version 1, magasin `settings`, clé
`control-plane-origin`, valeur = origine canonique. Base distincte du coffre
(`packages/draft-storage/indexeddb.ts:6`) : réglage non secret, lisible verrouillé
(service worker, popup). Lecture : toute valeur qui ne repasse pas
`parseControlPlaneOrigin` à l'identique, ou toute erreur de lecture, vaut `null`.

- [ ] **Test rouge** (`MemorySettingsStore` local : `Map` et drapeau `fail`) :
  ```ts
  const release = { allowLoopbackHttp: false };
  test("saving stores the canonical origin and reading re-validates it", async () => {
    const store = new MemorySettingsStore();
    expect(await saveControlPlaneOrigin(store, " https://CP.Example.org/ ", release)).toEqual({ ok: true, origin: "https://cp.example.org" });
    expect(store.values.get("control-plane-origin")).toBe("https://cp.example.org");
    expect(await readControlPlaneOrigin(store, release)).toBe("https://cp.example.org");
  });
  test("a refused input keeps the previous value", async () => {
    const store = new MemorySettingsStore();
    await saveControlPlaneOrigin(store, "https://cp.example.org", release);
    expect(await saveControlPlaneOrigin(store, "http://cp.example.org", release)).toEqual({ ok: false, code: "origin.https-required" });
    expect(await readControlPlaneOrigin(store, release)).toBe("https://cp.example.org");
  });
  test("a tampered or non-canonical stored value reads as unset", async () => {
    for (const value of ["https://cp.example.org/path", "https://CP.example.org", "http://cp.example.org",
      "http://localhost:3000", "null", 42, null, { origin: "x" }]) {
      const store = new MemorySettingsStore();
      store.values.set("control-plane-origin", value);
      expect(await readControlPlaneOrigin(store, release)).toBeNull();
    }
  });
  test("an unreadable store is unset and an unwritable one reports settings.unavailable", async () => {
    const store = new MemorySettingsStore(); store.fail = true;
    expect(await readControlPlaneOrigin(store, release)).toBeNull();
    expect(await saveControlPlaneOrigin(store, "https://cp.example.org", release)).toEqual({ ok: false, code: "settings.unavailable" });
  });
  ```
- [ ] **Exécution rouge.** `bun test apps/extension-shared/settings.test.ts` → module absent.
- [ ] **Implémentation.** Logique pure ; adaptateur sur le modèle de
  `packages/draft-storage/indexeddb.ts:3-58` (`readonly` en lecture, `readwrite` +
  `durability: "strict"` en écriture, erreurs sans message natif). L'adaptateur est
  exercé en navigateur (Task 15, étape `control-plane-origin-saved-validated-persisted`).
- [ ] **Exécution verte.** même commande → `0 fail`.
- [ ] **Neutralisation.** Revalidation substituée par `typeof value === "string" ? value : null` → test 3 rouge.
- [ ] **Commit.**
  ```bash
  git add apps/extension-shared/settings.ts apps/extension-shared/settings-store.ts apps/extension-shared/settings.test.ts
  git commit -s -m "feat(extension): store the control plane origin in extension IndexedDB without the storage permission"
  ```

### Task 4: La capture conserve l'origine observée

**Files:**
- Modify: `apps/extension-shared/capture.ts:22-63`, `apps/extension-shared/controller.ts:11,19,37-52`
- Modify: `apps/extension-shared/capture.test.ts:49-55`, `apps/extension-shared/controller.test.ts:38-41`
- Modify: `apps/extension-shared/editor.ts:15-17,572-575`, `apps/extension-shared/editor.browser-fixture.ts:46-52,74,81`

**Interfaces:**
- Consumes: Task 2 (`observedOriginOf`).
- Produces:
  ```ts
  export interface ExplicitCapture { data: string; observedOrigin: string | null }   // capture.ts
  export async function captureExplicitly(tabs: CaptureTabs): Promise<ExplicitCapture>;
  export type ReplyError = "not-authorized" | "invalid-message" | "capture-expired" | "capture-busy"
    | "capture-unavailable" | "origin-unset" | "origin-unavailable" | "origin-mismatch" | "delivery-expired";
  export type Reply = { ok: true } | { ok: true; capture: ExplicitCapture }
    | { ok: true; delivery: DeliveryTicket /* Task 10 */ } | { ok: false; error: ReplyError };
  ```

`observedOrigin` se calcule sur `target.url` déjà lu (`capture.ts:30`). La capture refuse
toujours les pages non `http(s)` (`capture.ts:36`) ; le `null` des URL non `http(s)` est
couvert à un seul site, `observedOriginOf` (Task 2).

- [ ] **Test rouge.** `capture.test.ts:52` attend `{ data: "data:image/png;base64,c3ludGhldGlj",
  observedOrigin: "https://fixture.invalid" }`, plus :
  ```ts
  test("the observed origin drops path, query, fragment and credentials of the bound tab", async () => {
    const f = fixture();
    // Credential-bearing URL concatenated for the public-boundary gate.
    f.tabs.query = async () => [{ id: 7, windowId: 3, url: "https://" + "u:p@" + "fixture.invalid:443/a/b?q=1#frag" }];
    expect((await captureExplicitly(f.tabs)).observedOrigin).toBe("https://fixture.invalid");
  });
  ```
  `controller.test.ts:38-41` attend `{ ok: true, capture: { data: "data:image/png;base64,c3ludGhldGlj", observedOrigin: "https://fixture.invalid" } }`.
- [ ] **Exécution rouge.** `bun test apps/extension-shared/capture.test.ts apps/extension-shared/controller.test.ts` → 3 échecs.
- [ ] **Implémentation.** `capture.ts` rend `{ data, observedOrigin }` ; `controller.ts`
  garde `pending: { nonce; capture; created }` et répond `{ ok: true, capture }` ;
  `editor.ts` range `capture.observedOrigin` dans l'état `observedOrigin` (affichage en
  Task 12) ; la fixture simule la nouvelle réponse.
- [ ] **Exécution verte.** même commande, puis `bun apps/extension-shared/editor.browser-check.ts` → verts.
- [ ] **Neutralisation.** `observedOriginOf(target.url)` → `target.url ?? null` : nouveau test rouge.
- [ ] **Commit.**
  ```bash
  git add apps/extension-shared/capture.ts apps/extension-shared/capture.test.ts apps/extension-shared/controller.ts apps/extension-shared/controller.test.ts apps/extension-shared/editor.ts apps/extension-shared/editor.browser-fixture.ts
  git commit -s -m "feat(extension): keep only the observed origin of the explicitly captured tab"
  ```

### Task 5: Codec du contenu de brouillon, version 2 avec origine observée

**Files:**
- Create: `apps/extension-shared/draft-content.ts`
- Modify: `apps/extension-shared/editor.ts:334-358` (encodage) et `386-414` (décodage)
- Test: `apps/extension-shared/draft-content.test.ts`

**Interfaces:**
- Consumes: Task 2 (`isCanonicalOrigin`) ; `Rectangle`, `ReviewedMedia["operations"]`.
- Produces:
  ```ts
  export interface DraftVideoContent { sourceId: string; capturedAt: string; audioIncluded: boolean; sourceAudioCaptured: boolean;
    sourceType: string; width: number; height: number; masks: Rectangle[] }
  export interface DraftContent { version: 2; dossierId: string; createdAt: string; revision: number; captureId: string;
    capturedAt: string; operations: ReviewedMedia["operations"]; screenshot: boolean; video: DraftVideoContent | null;
    fields: Record<"expected" | "observed" | "application" | "environment" | "steps", string>; observedOrigin: string | null }
  export function encodeDraftContent(value: DraftContent): Uint8Array<ArrayBuffer>;
  export function decodeDraftContent(bytes: Uint8Array<ArrayBuffer>, attachmentCount: number): DraftContent; // lève "draft.format"
  ```

Règles : écriture en version 2 ; une version 1 (format actuel, `editor.ts:335-357`) se
décode avec `observedOrigin: null` ; en version 2, `observedOrigin` est obligatoire, `null`
ou canonique ; contrôle du nombre de pièces jointes repris de `editor.ts:407-414`. Le
brouillon reste chiffré par `DraftVault` (`packages/draft-storage/vault.ts:271-292`),
inchangé.

- [ ] **Test rouge.**
  ```ts
  const base = { version: 2, dossierId: "d-1", createdAt: "2026-10-24T00:00:00Z", revision: 1, captureId: "source-1",
    capturedAt: "2026-10-24T00:00:00Z", operations: ["metadata-removal"], screenshot: true, video: null,
    observedOrigin: "https://fixture.invalid", fields: { expected: "a", observed: "b", application: "c", environment: "d", steps: "e" } } as const;
  const utf8 = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
  test("version 2 round-trips the observed origin, including its withdrawal", () => {
    expect(decodeDraftContent(encodeDraftContent(base), 2)).toEqual(base);
    expect(decodeDraftContent(encodeDraftContent({ ...base, observedOrigin: null }), 2).observedOrigin).toBeNull();
  });
  test("a version 1 draft resumes with no observed origin", () => {
    const { observedOrigin: _, ...v1 } = { ...base, version: 1 };
    expect(decodeDraftContent(utf8(v1), 2).observedOrigin).toBeNull();
  });
  test("a non-canonical, non-http(s) or missing version 2 origin is refused", () => {
    for (const observedOrigin of ["https://fixture.invalid/path", "null", "blob:https://a.example/x", 7, undefined])
      expect(() => decodeDraftContent(utf8({ ...base, observedOrigin }), 2)).toThrow("draft.format");
  });
  test("attachment count must match screenshot and video flags", () => {
    expect(() => decodeDraftContent(encodeDraftContent(base), 0)).toThrow("draft.format");
  });
  ```
- [ ] **Exécution rouge.** `bun test apps/extension-shared/draft-content.test.ts` → module absent.
- [ ] **Implémentation.** Codec pur ; « save » et « load » de l'éditeur délèguent ; `load` restaure `observedOrigin`.
- [ ] **Exécution verte.** même commande, puis `bun apps/extension-shared/editor.browser-check.ts` → verts.
- [ ] **Neutralisation.** Contrôle `isCanonicalOrigin` du décodeur → `true` : test 3 rouge.
- [ ] **Commit.**
  ```bash
  git add apps/extension-shared/draft-content.ts apps/extension-shared/draft-content.test.ts apps/extension-shared/editor.ts
  git commit -s -m "feat(extension): persist the withdrawable observed origin in the encrypted draft (format v2)"
  ```

### Task 6: `packages/delivery-protocol` — constantes, messages, base64, découpage

**Files:**
- Modify: `packages/domain/zip.ts:5-6` (exporter `MAX_ARCHIVE_BYTES`, valeur inchangée), `tools/contracts/verify-export.ts:30` (littéral `269500416` → `MAX_ARCHIVE_BYTES`)
- Create: `packages/delivery-protocol/index.ts`, `constants.ts`, `messages.ts`, `base64.ts`, `envelope-guard.ts`, `chunking.ts`
- Test: `packages/delivery-protocol/chunking.test.ts`, `base64.test.ts`, `envelope-guard.test.ts`

**Interfaces:**
- Consumes: `DeliveryEnvelope`, `buildDeliveryEnvelope(exportBytes, observedOrigin)`
  (`packages/domain/delivery-envelope.ts`, L1, registre §4.1) ; `rawDeliveryEnvelopeFailures`
  (vérificateur vendorisé) et ses vecteurs
  `vendor/contracts/contracts/fixtures/signalement-delivery-envelope-v1/vectors.json`.
- Produces (registre §4.6) :
  ```ts
  export const DELIVERY_CHUNK_BYTES: number;            // 1_048_576 provisoire, fixé par la Task 8
  export const DELIVERY_CHUNK_BYTES_CEILING = 4_194_304;
  export const MIN_DELIVERY_BYTES = 22;                  // plus petite archive admise par readZip (zip.ts:99)
  export const MAX_DELIVERY_BYTES: number;               // = MAX_ARCHIVE_BYTES = 269_500_416
  export const MAX_DELIVERY_CHUNKS: number;              // Math.ceil(MAX_DELIVERY_BYTES / DELIVERY_CHUNK_BYTES)
  export const ACK_TIMEOUT_MS = 15_000;
  export const DELIVERY_IDLE_TIMEOUT_MS = 60_000;
  export type DeliveryMessage =
    | { type: "signalement.delivery.begin"; deliveryId: string; envelope: DeliveryEnvelope; chunkCount: number }
    | { type: "signalement.delivery.chunk"; deliveryId: string; index: number; bytes: string /* base64 */ }
    | { type: "signalement.delivery.end"; deliveryId: string };
  export type DeliveryAckCode = "protocol.shape" | "protocol.busy" | "protocol.unknown-delivery" | "protocol.order"
    | "protocol.duplicate" | "protocol.chunk-count" | "protocol.chunk-size" | "protocol.total-size" | "protocol.base64"
    | "protocol.incomplete" | "protocol.idle-timeout" | "envelope.invalid" | "export.length-mismatch"
    | "export.digest-mismatch" | "export.archive-invalid";
  export type DeliveryAck = { type: "signalement.delivery.ack"; deliveryId: string; index: number | "begin" | "end"; ok: boolean; code: DeliveryAckCode | null };
  export function chunkCount(byteLength: number): number;    // lève "protocol.total-size"
  export function encodeBase64(bytes: Uint8Array): string;
  export function decodeBase64(text: string, expectedLength: number): Uint8Array<ArrayBuffer> | null;
  export function deliveryMessages(envelope: DeliveryEnvelope, exportBytes: Uint8Array<ArrayBuffer>): Generator<DeliveryMessage>;
  export function parseDeliveryMessage(value: unknown): DeliveryMessage | null;
  export function parseDeliveryAck(value: unknown): DeliveryAck | null;
  ```
  Interne, non réexporté par `index.ts` : `guardDeliveryEnvelope(value: unknown):
  DeliveryEnvelope | null` (`envelope-guard.ts`), contrôle structurel en page avant toute
  allocation ; il ne construit rien.

Règles : `deliveryId` = UUID v4 minuscule produit par `buildDeliveryEnvelope`
(`crypto.randomUUID()`, motif `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
plan L1 partie 1, ligne 90), recoupé à l'exécution par `jq '.properties.deliveryId' vendor/contracts/contracts/schemas/signalement-delivery-envelope.v1.schema.json` ;
chaque morceau sauf le dernier fait exactement `DELIVERY_CHUNK_BYTES` octets, le dernier de
1 à `DELIVERY_CHUNK_BYTES` ; `index` de 0 à `chunkCount - 1` ; base64 standard avec
remplissage, sans espace, longueur multiple de 4, décodé de longueur exacte sinon `null` ;
`deliveryMessages` est un générateur, un seul morceau encodé à la fois. Les analyseurs
refusent toute clé supplémentaire, tout type inattendu, et un `code` non nul quand `ok`
est vrai. `guardDeliveryEnvelope` reprend les champs du schéma vendorisé
(`schemaVersion` et les quatre du registre) : `deliveryId` UUID v4 minuscule au motif
ci-dessus, origine canonique ou `null`, digest en hexadécimal minuscule, longueur dans
`[MIN_DELIVERY_BYTES, MAX_DELIVERY_BYTES]` ; toute clé hors schéma est refusée. Le test de
conformité ajoute une enveloppe de `buildDeliveryEnvelope` dont `deliveryId` est passé en
majuscules : refusée par la garde comme par `rawDeliveryEnvelopeFailures`.

- [ ] **Test rouge — découpage.**
  ```ts
  const pattern = (length: number) => Uint8Array.from({ length }, (_, i) => (i * 31 + 7) & 255);
  test("chunk geometry follows the fixed chunk size and the export contract bound", () => {
    expect(DELIVERY_CHUNK_BYTES).toBeLessThanOrEqual(DELIVERY_CHUNK_BYTES_CEILING);
    expect(MAX_DELIVERY_BYTES).toBe(269_500_416);
    expect(MAX_DELIVERY_CHUNKS).toBe(258); // à 1 MiB ; la Task 8 met ce littéral à jour si elle change la taille
    expect(chunkCount(22)).toBe(1);
    expect(chunkCount(DELIVERY_CHUNK_BYTES)).toBe(1);
    expect(chunkCount(DELIVERY_CHUNK_BYTES + 1)).toBe(2);
    expect(chunkCount(MAX_DELIVERY_BYTES)).toBe(MAX_DELIVERY_CHUNKS);
    expect(() => chunkCount(21)).toThrow("protocol.total-size");
    expect(() => chunkCount(MAX_DELIVERY_BYTES + 1)).toThrow("protocol.total-size");
  });
  test("messages are begin, ordered chunks, end, and decode to the exact export bytes", async () => {
    const bytes = pattern(DELIVERY_CHUNK_BYTES * 2 + 5);
    const envelope = await buildDeliveryEnvelope(bytes, null);
    const messages = [...deliveryMessages(envelope, bytes)];
    expect(messages.map((m) => m.type)).toEqual(["signalement.delivery.begin", "signalement.delivery.chunk",
      "signalement.delivery.chunk", "signalement.delivery.chunk", "signalement.delivery.end"]);
    expect(messages[0]).toMatchObject({ chunkCount: 3, deliveryId: envelope.deliveryId });
    const decoded = messages.slice(1, 4).map((m, i) =>
      m.type === "signalement.delivery.chunk" && m.index === i ? decodeBase64(m.bytes, i < 2 ? DELIVERY_CHUNK_BYTES : 5) : null);
    expect(Buffer.concat(decoded.map((d) => d ?? new Uint8Array())).equals(Buffer.from(bytes))).toBe(true);
    for (const m of messages) expect(parseDeliveryMessage(structuredClone(m))).toEqual(m);
  });
  test("messages and acks refuse extra keys, foreign types and malformed fields", async () => {
    const { deliveryId: id } = await buildDeliveryEnvelope(pattern(22), null);
    expect(parseDeliveryMessage({ type: "signalement.delivery.end", deliveryId: id, extra: 1 })).toBeNull();
    expect(parseDeliveryMessage({ type: "signalement.delivery.chunk", deliveryId: id, index: -1, bytes: "" })).toBeNull();
    expect(parseDeliveryMessage({ type: "signalement.delivery.chunk", deliveryId: id, index: 1.5, bytes: "AA==" })).toBeNull();
    for (const deliveryId of ["short", id.toUpperCase(), "6f1c2c1e-8a3b-1c5d-9e6f-0a1b2c3d4e5f", "6f1c2c1e-8a3b-4c5d-7e6f-0a1b2c3d4e5f"])
      expect(parseDeliveryMessage({ type: "signalement.delivery.end", deliveryId })).toBeNull(); // casse, version 1, variante
    expect(parseDeliveryAck({ type: "signalement.delivery.ack", deliveryId: id, index: "begin", ok: true, code: "protocol.busy" })).toBeNull();
    expect(parseDeliveryAck({ type: "signalement.delivery.ack", deliveryId: id, index: 0, ok: false, code: "not-a-code" })).toBeNull();
    expect(parseDeliveryAck({ type: "signalement.delivery.ack", deliveryId: id, index: 0, ok: false, code: "protocol.order" }))
      .toEqual({ type: "signalement.delivery.ack", deliveryId: id, index: 0, ok: false, code: "protocol.order" });
  });
  ```
- [ ] **Test rouge — base64.** Aller-retour des longueurs 0, 1, 2, 3, 4, 65 537 et
  `DELIVERY_CHUNK_BYTES` contre `Buffer.from(bytes).toString("base64")` (implémentation
  indépendante) ; `decodeBase64("AAA=", 3)`, `("AA A=", 2)`, `("AA-_", 3)`, `("AAA", 2)` → `null`.
- [ ] **Test rouge — garde d'enveloppe et conformité à l'autorité.** Pour chaque vecteur
  valide et invalide de `vectors.json` (forme lue par `jq 'keys'`), `guardDeliveryEnvelope`
  accepte si et seulement si `rawDeliveryEnvelopeFailures` rend `[]` ; toute enveloppe de
  `buildDeliveryEnvelope` est acceptée ; le test imprime le nombre de vecteurs examinés et
  échoue s'il vaut 0.
- [ ] **Exécution rouge.** `bun test packages/delivery-protocol` → modules absents.
- [ ] **Implémentation.** `encodeBase64` : `btoa` sur une chaîne binaire construite par
  tranches de 32 768 octets ; `decodeBase64` : motif, longueur multiple de 4, `atob` en
  `try`, longueur décodée exacte. Une seule source de la borne : `MAX_ARCHIVE_BYTES`.
- [ ] **Exécution verte.** `bun test packages/delivery-protocol packages/domain tools/contracts` → `0 fail`.
- [ ] **Neutralisation.** (a) contrôle de longueur décodée → `true` ; (b) refus de clé
  supplémentaire → `false` ; (c) borne haute de `chunkCount` → `Number.MAX_SAFE_INTEGER` ;
  chacun fait rougir son test.
- [ ] **Commit.**
  ```bash
  git add packages/delivery-protocol packages/domain/zip.ts tools/contracts/verify-export.ts
  git commit -s -m "feat(delivery): add chunked delivery protocol messages, base64 codec and splitter"
  ```

### Task 7: `packages/delivery-protocol` — réassemblage borné

**Files:**
- Create: `packages/delivery-protocol/reassembler.ts` (réexporté par `index.ts`)
- Test: `packages/delivery-protocol/reassembler.test.ts`

**Interfaces:**
- Consumes: Task 6.
- Produces:
  ```ts
  export interface ReassemblerDeps { now(): number; allocate?(byteLength: number): Uint8Array<ArrayBuffer>; digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> }
  export type ReassemblyOutcome = { kind: "complete"; envelope: DeliveryEnvelope; bytes: Uint8Array<ArrayBuffer> } | { kind: "refused"; code: DeliveryAckCode };
  export interface Reassembler {
    accept(message: unknown): Promise<{ ack: DeliveryAck | null; outcome: ReassemblyOutcome | null }>;
    expire(): DeliveryAck | null;
    readonly active: { deliveryId: string; received: number; chunkCount: number; envelope: DeliveryEnvelope } | null;
  }
  export function createReassembler(deps: ReassemblerDeps): Reassembler;
  ```

Règles : une seule remise active ; `begin` valide l'enveloppe (`guardDeliveryEnvelope`),
`envelope.deliveryId === deliveryId` et `chunkCount === chunkCount(envelope.exportByteLength)`
**avant** toute allocation ; tampon unique de `exportByteLength` octets ; morceaux dans
l'ordre (`index === reçus`), inférieur → `protocol.duplicate`, supérieur →
`protocol.order` ; taille exacte sinon `protocol.chunk-size` ; `end` prématuré →
`protocol.incomplete` ; à `end`, SHA-256 du tampon comparé à `exportSha256` →
`export.digest-mismatch`. Toute erreur abandonne (tampon rempli de zéros, référence
lâchée) ; message ultérieur de ce `deliveryId` → `protocol.unknown-delivery`. Message
illisible sans `deliveryId` lisible → `ack: null` ; avec → `protocol.shape`. `expire()`
abandonne si `now() - dernier message > DELIVERY_IDLE_TIMEOUT_MS`.

- [ ] **Test rouge.**
  ```ts
  const sha = async (b: Uint8Array) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
  function harness() {
    let clock = 0; const allocations: number[] = [];
    const r = createReassembler({ now: () => clock, digest: sha, allocate: (n) => { allocations.push(n); return new Uint8Array(n); } });
    return { r, allocations, advance: (ms: number) => { clock += ms; } };
  }
  test("a complete in-order delivery acknowledges each message and returns the exact bytes", async () => { /* 3 morceaux ; acks begin,0,1,2,end ok:true code:null ; outcome complete ; octets égaux */ });
  test("out-of-bounds announcements are refused before any allocation", async () => {
    const { r, allocations } = harness();
    /* exportByteLength MAX_DELIVERY_BYTES + 1 → "envelope.invalid" ; chunkCount incohérent → "protocol.chunk-count" ;
       deliveryId du message ≠ envelope.deliveryId → "envelope.invalid" */
    expect(allocations).toEqual([]);
  });
  test("a second begin during an active delivery is refused busy and never replaces it", async () => { /* "protocol.busy" ; active.deliveryId inchangé ; la première finit "complete" */ });
  test("duplicate, skipped, oversized and undersized chunks abort the delivery", async () => { /* protocol.duplicate, protocol.order, protocol.chunk-size ; puis protocol.unknown-delivery */ });
  test("end before the last chunk is incomplete and a digest mismatch is refused", async () => { /* protocol.incomplete ; enveloppe d'autres octets → export.digest-mismatch */ });
  test("inactivity beyond the idle timeout abandons and zeroes the buffer", async () => {
    const { r, advance } = harness();
    /* begin + 1 morceau */ advance(DELIVERY_IDLE_TIMEOUT_MS + 1);
    expect(r.expire()).toMatchObject({ ok: false, code: "protocol.idle-timeout" });
    expect(r.active).toBeNull();
  });
  ```
  Chaque corps commenté est écrit en entier avec les valeurs et codes indiqués ; les
  enveloppes viennent de `buildDeliveryEnvelope`, les variantes invalides par
  substitution d'un champ.
- [ ] **Exécution rouge.** `bun test packages/delivery-protocol/reassembler.test.ts` → module absent.
- [ ] **Implémentation** selon les règles.
- [ ] **Exécution verte.** `bun test packages/delivery-protocol && bun run check` → verts (sortie de phase A).
- [ ] **Neutralisation.** (a) allocation avant le contrôle de `chunkCount` → test 2 rouge ;
  (b) `protocol.busy` remplacé par un remplacement de la remise active → test 3 rouge ;
  (c) comparaison de digest → `true` → test 5 rouge.
- [ ] **Commit.**
  ```bash
  git add packages/delivery-protocol/reassembler.ts packages/delivery-protocol/reassembler.test.ts packages/delivery-protocol/index.ts
  git commit -s -m "feat(delivery): add the bounded single-delivery reassembler with per-chunk acknowledgements"
  ```
