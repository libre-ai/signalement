# L6 — Partie 2 : remise (Tasks 8-13)

Index, Global Constraints et Review Focus : `2026-10-24-v1-L6-extension-delivery.md`.

### Task 8: Sonde — transport des arguments d'`executeScript` et taille de morceau

Tranche l'hypothèse du design §5.2 « arguments d'injection passés en JSON » et fixe
`DELIVERY_CHUNK_BYTES` (feuille de route §6 : si elle tombe, l'encodage s'adapte, le
protocole ne change pas).

**Files:**
- Create: `tools/probes/delivery/manifest.json`, `probe.html`, `probe.js`
- Create: `tools/browser-check/delivery-probe-chrome.ts`, `tools/browser-check/delivery-probe-firefox.ts`
- Create: `docs/qualification/<date -u +%F>-delivery-probes.md`
- Modify (si la mesure l'impose): `packages/delivery-protocol/constants.ts`, assertion `MAX_DELIVERY_CHUNKS` de `chunking.test.ts`

**Interfaces:**
- Consumes: modèles `tools/probes/extension/` et lanceurs `tools/browser-check/chrome.ts:51-70`, `firefox.ts:13-40`.
- Produces: `test-results/browser-check/delivery-probe-<browser>/<uuid>/probe.json` (ignoré par
  Git) = `{ browser, version, typedTag, isUint8, candidates: { rawBytes, base64Length, ok, errorName, durationMs }[] }`.

Valeurs fixées : manifest de sonde `permissions: ["activeTab", "scripting"]`, identifiant
Gecko `signalement-delivery-probe@libre-ai.invalid` ; candidats bruts `262_144`,
`1_048_576`, `4_194_304`, `8_388_608`, `16_777_216` octets, envoyés en base64 ; fonction de
sonde `(text, typed) => ({ length: text.length, typedTag: Object.prototype.toString.call(typed), isUint8: typed instanceof Uint8Array })`,
`args: [base64, new Uint8Array([1, 2, 3])]`, `world: "ISOLATED"`, sur l'onglet de la fixture
`tests/fixtures/capture-app`. Règle : `DELIVERY_CHUNK_BYTES` = plus grand candidat ≤ 4 MiB
réussi sur **chaque** navigateur mesuré avec `durationMs < ACK_TIMEOUT_MS / 3` ; si
`1_048_576` échoue quelque part : `BLOCKED` avec le relevé. Encodage base64 sur les trois
navigateurs quel que soit `isUint8` (même mécanisme partout, design §5.2).

- [ ] **Sonde.** Sonde et lanceurs (profil jetable, nettoyage en `finally`, délais bornés
  comme `chrome.ts`) ; recette hachée dans le relevé (`recipeEvidence`,
  `tools/browser-check/evidence.ts:51-67`). Outil de mesure, sans test unitaire.
- [ ] **Exécution.** `bun tools/browser-check/delivery-probe-chrome.ts` puis
  `GECKODRIVER_BINARY=<binaire vérifié> bun tools/browser-check/delivery-probe-firefox.ts`
  → un `probe.json` par navigateur, sortie 0 ; sortie non nulle si un candidat n'a pas de
  résultat lisible.
- [ ] **Safari.** Même sonde, empaquetée par la Task 17 ; tant qu'elle est `blocked`, la
  taille est fixée sur Chrome et Firefox et le relevé dit « Safari non mesuré » ; une
  mesure Safari plus petite fait descendre la constante dans une PR dédiée.
- [ ] **Relevé.** Rapport daté : `jq . probe.json` verbatim, versions, valeur retenue et règle appliquée.
- [ ] **Constante.** Si la règle donne une autre valeur que `1_048_576` : modifier
  `constants.ts`, calculer `Math.ceil(269_500_416 / taille)` par `bun -e` et reporter ce
  littéral dans `chunking.test.ts` ; `bun test packages/delivery-protocol` → `0 fail`.
- [ ] **Commit.**
  ```bash
  git add tools/probes/delivery tools/browser-check/delivery-probe-chrome.ts tools/browser-check/delivery-probe-firefox.ts docs/qualification/*-delivery-probes.md packages/delivery-protocol/constants.ts packages/delivery-protocol/chunking.test.ts
  git commit -s -m "test(delivery): measure executeScript argument transport and fix the chunk size per browser"
  ```

### Task 9: Fonction injectée fixe `deliverOne`

**Files:**
- Create: `apps/extension-shared/delivery-injected.ts`
- Test: `apps/extension-shared/delivery-injected.test.ts`

**Interfaces:**
- Consumes: aucune liaison de module dans le corps (la fonction est sérialisée par `executeScript`).
- Produces:
  ```ts
  export async function deliverOne(message: unknown, targetOrigin: string, timeoutMs: number):
    Promise<{ type: "signalement.delivery.ack"; deliveryId: string; index: number | "begin" | "end"; ok: boolean; code: string | null }
          | { type: "signalement.delivery.timeout" } | { type: "signalement.delivery.invalid" }>;
  ```

Algorithme : `targetOrigin` chaîne, `timeoutMs` entier dans `[1, 60_000]`, `message` objet
dont `type` commence par `"signalement.delivery."` et dont `deliveryId` est une chaîne,
sinon `{ type: "signalement.delivery.invalid" }` sans rien poster ; index attendu =
`message.index` ou `"begin"`/`"end"` ; écouteur `message` sur `window` qui n'accepte que
`event.source === window && event.origin === targetOrigin && data.type ===
"signalement.delivery.ack" && data.deliveryId === message.deliveryId && data.index ===
attendu`, et ne recopie que `{ type, deliveryId, index, ok, code }` après contrôle des
types primitifs ; `window.postMessage(message, targetOrigin)` ; délai →
`{ type: "signalement.delivery.timeout" }` ; écouteur et minuterie retirés dans tous les
cas. Globales admises : `window.postMessage`, `window.addEventListener`,
`window.removeEventListener`, `setTimeout`, `clearTimeout`, `Promise`, `Object`, `Number`,
`String`. La validation fine de l'acquittement (`parseDeliveryAck`) se fait côté éditeur
(Task 11).

- [ ] **Test rouge** (évalue la **source**, comme `executeScript`, dans un contexte `node:vm` neuf) :
  ```ts
  import { runInNewContext } from "node:vm";
  function sandbox() {
    const posted: { data: unknown; target: string }[] = []; const listeners = new Set<(e: unknown) => void>(); const touched: string[] = [];
    const allowed = { postMessage: (data: unknown, target: string) => { posted.push({ data, target }); },
      addEventListener: (_: string, fn: (e: unknown) => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: (e: unknown) => void) => listeners.delete(fn) };
    const window: object = new Proxy(allowed, { get(t, key) { touched.push(String(key));
      if (key in t) return t[key as keyof typeof t]; throw new Error(`page read: ${String(key)}`); } });
    const fn = runInNewContext(`(${deliverOne.toString()})`, { window, setTimeout, clearTimeout });
    return { fn, posted, listeners, touched,
      reply: (data: unknown, origin = "https://cp.example.org", source: unknown = window) => { for (const l of [...listeners]) l({ data, origin, source }); } };
  }
  const id = "6f1c2c1e-8a3b-4c5d-9e6f-0a1b2c3d4e5f";
  test("the source is self-contained and posts only to the explicit target origin", async () => {
    const s = sandbox();
    const pending = s.fn({ type: "signalement.delivery.end", deliveryId: id }, "https://cp.example.org", 1000);
    expect(s.posted).toEqual([{ data: { type: "signalement.delivery.end", deliveryId: id }, target: "https://cp.example.org" }]);
    s.reply({ type: "signalement.delivery.ack", deliveryId: id, index: "end", ok: true, code: null, extra: "<script>" });
    expect(await pending).toEqual({ type: "signalement.delivery.ack", deliveryId: id, index: "end", ok: true, code: null });
    expect(s.listeners.size).toBe(0);
    expect(new Set(s.touched)).toEqual(new Set(["postMessage", "addEventListener", "removeEventListener"]));
  });
  test("acks from another origin, another source, another delivery or another index are ignored", async () => {
    const s = sandbox();
    const pending = s.fn({ type: "signalement.delivery.chunk", deliveryId: id, index: 2, bytes: "AA==" }, "https://cp.example.org", 50);
    s.reply({ type: "signalement.delivery.ack", deliveryId: id, index: 2, ok: true, code: null }, "https://evil.example");
    s.reply({ type: "signalement.delivery.ack", deliveryId: id, index: 2, ok: true, code: null }, "https://cp.example.org", {});
    s.reply({ type: "signalement.delivery.ack", deliveryId: crypto.randomUUID(), index: 2, ok: true, code: null });
    s.reply({ type: "signalement.delivery.ack", deliveryId: id, index: 1, ok: true, code: null });
    expect(await pending).toEqual({ type: "signalement.delivery.timeout" });
    expect(s.listeners.size).toBe(0);
  });
  test("an invalid call posts nothing and the source never names a page surface or a wildcard", async () => {
    const s = sandbox();
    expect(await s.fn({ type: "other" }, "https://cp.example.org", 10)).toEqual({ type: "signalement.delivery.invalid" });
    expect(await s.fn({ type: "signalement.delivery.end", deliveryId: id }, "https://cp.example.org", 0)).toEqual({ type: "signalement.delivery.invalid" });
    expect(s.posted).toEqual([]);
    expect(deliverOne.toString()).not.toMatch(/["']\*["']|document|localStorage|indexedDB|cookie|location|fetch|XMLHttpRequest|eval|Function\(|innerHTML|chrome\.|browser\./u);
  });
  ```
- [ ] **Exécution rouge.** `bun test apps/extension-shared/delivery-injected.test.ts` → module absent.
- [ ] **Implémentation** au niveau du module, sans capture de variable.
- [ ] **Exécution verte.** même commande → `0 fail` ; `bun run build:extensions && grep -c "signalement.delivery.timeout" dist/extensions/chrome/editor.js` → ≥ 1.
- [ ] **Neutralisation.** (a) `event.origin === targetOrigin` → `true` : test 2 rouge ;
  (b) `targetOrigin` → `"*"` dans `postMessage` : tests 1 et 3 rouges ; (c) référence à une
  constante de module dans le corps : `ReferenceError` dans le bac à sable, test 1 rouge.
- [ ] **Commit.**
  ```bash
  git add apps/extension-shared/delivery-injected.ts apps/extension-shared/delivery-injected.test.ts
  git commit -s -m "feat(extension): add the fixed self-contained injected delivery function"
  ```

### Task 10: Ticket de remise émis par le service worker sur geste

**Files:**
- Modify: `apps/extension-shared/controller.ts:3-68`, `apps/extension-shared/background.ts:1-11`
- Test: `apps/extension-shared/controller.test.ts`

**Interfaces:**
- Consumes: Task 2 (`observedOriginOf`, `sameOrigin`), Task 3, Task 1.
- Produces:
  ```ts
  export interface DeliveryTicket { tabId: number; targetOrigin: string }
  export const DELIVERY_TICKET_TTL_MS = 60_000;
  export function createController(api: ExtensionApi, now?: () => number, nonce?: () => string,
    readControlPlaneOrigin?: () => Promise<string | null>): (input: unknown, sender: MessageSender) => Promise<Reply>;
  ```

Protocole fermé étendu : `{ kind: "deliver" }` (expéditeur `popup.html` seulement) et
`{ kind: "consume-delivery", nonce }` (expéditeur `editor.html` seulement). `deliver` :
`tabs.query({ active: true, currentWindow: true })`, `observedOriginOf(tab.url)` (`null` →
`origin-unavailable`), réglage (`null` → `origin-unset`), `sameOrigin` (différent →
`origin-mismatch`), puis seulement ticket à usage unique `{ nonce, ticket: { tabId,
targetOrigin }, created }` expirant après `DELIVERY_TICKET_TTL_MS` (modèle de la capture,
`controller.ts:51-57`) et ouverture de `editor.html#delivery=<nonce>`. Le contrôleur
n'injecte jamais rien. Lecteur de réglage par défaut : `async () => null`. Emplacements
capture et remise indépendants ; `busy` partagé.

- [ ] **Test rouge.**
  ```ts
  function deliveryApi(url: string | undefined, opened: string[]): ExtensionApi { /* tabs.query → [{ id: 5, windowId: 2, url }] ; create → opened.push(url) */ }
  test("only the popup can request a delivery, and only on the configured origin exactly", async () => {
    const opened: string[] = [];
    const api = deliveryApi("https://cp.example.org/receive?x#y", opened);
    const handle = createController(api, () => 0, () => "ticket-nonce", async () => "https://cp.example.org");
    const popup = { id: api.runtime.id, url: api.runtime.getURL("popup.html") };
    const editor = { id: api.runtime.id, url: api.runtime.getURL("editor.html") };
    expect(await handle({ kind: "deliver" }, editor)).toEqual({ ok: false, error: "not-authorized" });
    expect(await handle({ kind: "deliver" }, { id: "page", url: "https://cp.example.org/" })).toEqual({ ok: false, error: "not-authorized" });
    expect(opened).toEqual([]);
    expect(await handle({ kind: "deliver" }, popup)).toEqual({ ok: true });
    expect(opened).toEqual([`${api.runtime.getURL("editor.html")}#delivery=ticket-nonce`]);
    expect(await handle({ kind: "consume-delivery", nonce: "ticket-nonce" }, popup)).toEqual({ ok: false, error: "not-authorized" });
    expect(await handle({ kind: "consume-delivery", nonce: "ticket-nonce" }, editor)).toEqual({ ok: true, delivery: { tabId: 5, targetOrigin: "https://cp.example.org" } });
    expect(await handle({ kind: "consume-delivery", nonce: "ticket-nonce" }, editor)).toEqual({ ok: false, error: "delivery-expired" });
  });
  test("a different, unset or unreadable origin issues no ticket and opens nothing", async () => {
    for (const [url, setting, error] of [
      ["https://cp.example.org.evil.example/", "https://cp.example.org", "origin-mismatch"],
      ["https://cp.example.org:8443/", "https://cp.example.org", "origin-mismatch"],
      ["http://cp.example.org/", "https://cp.example.org", "origin-mismatch"],
      ["https://cp.example.org/", null, "origin-unset"],
      [undefined, "https://cp.example.org", "origin-unavailable"],
      ["about:blank", "https://cp.example.org", "origin-unavailable"],
    ] as const) {
      const opened: string[] = []; const api = deliveryApi(url, opened);
      const handle = createController(api, () => 0, () => "n", async () => setting);
      expect(await handle({ kind: "deliver" }, { id: api.runtime.id, url: api.runtime.getURL("popup.html") })).toEqual({ ok: false, error });
      expect(opened).toEqual([]);
      expect(await handle({ kind: "consume-delivery", nonce: "n" }, { id: api.runtime.id, url: api.runtime.getURL("editor.html") }))
        .toEqual({ ok: false, error: "delivery-expired" });
    }
  });
  test("a delivery ticket expires after its time to live", async () => { /* now = 60_001 au consume → delivery-expired */ });
  test("the default origin reader fails closed", async () => { /* createController(api) sans 4e argument → origin-unset */ });
  ```
- [ ] **Exécution rouge.** `bun test apps/extension-shared/controller.test.ts` → `invalid-message`.
- [ ] **Implémentation.** `controller.ts` selon le protocole ; `background.ts` ouvre
  `IndexedDbSettingsStore` à la demande et passe
  `() => readControlPlaneOrigin(store, { allowLoopbackHttp: ALLOW_LOOPBACK_HTTP })`.
- [ ] **Exécution verte.** `bun test apps/extension-shared` → `0 fail`.
- [ ] **Neutralisation (`gesture-bound-delivery`).** (a) contrôle d'expéditeur `popup.html`
  pour `deliver` → `true` : test 1 rouge ; (b) `!sameOrigin(...)` → `false` : test 2 rouge ;
  (c) contrôle d'expiration → `false` : test 3 rouge. Les trois sorties rouges vont dans le
  message de commit.
- [ ] **Commit.**
  ```bash
  git add apps/extension-shared/controller.ts apps/extension-shared/controller.test.ts apps/extension-shared/background.ts
  git commit -s -m "feat(extension): issue a one-shot delivery ticket only from a popup gesture on the configured origin"
  ```

### Task 11: Garde d'injection et émetteur (`gesture-bound-delivery`)

**Files:**
- Create: `apps/extension-shared/delivery.ts`
- Test: `apps/extension-shared/delivery.test.ts`

**Interfaces:**
- Consumes: Task 2, Task 6 (`deliveryMessages`, `parseDeliveryAck`, `ACK_TIMEOUT_MS`), `buildDeliveryEnvelope` (L1), Task 9, Task 10.
- Produces:
  ```ts
  export const DELIVERY_TICKET_MAX_AGE_MS = 600_000;
  export interface HeldTicket extends DeliveryTicket { receivedAt: number; used: boolean }
  export interface PreparedDelivery { envelope: DeliveryEnvelope; exportBytes: Uint8Array<ArrayBuffer>; generation: number }
  export interface DeliveryConfirmation { exportSha256: string; generation: number }
  export type DeliveryRefusal = "no-ticket" | "ticket-used" | "ticket-expired" | "origin-unset" | "origin-mismatch"
    | "not-prepared" | "not-confirmed" | "stale-preparation";
  export function authorizeInjection(input: { ticket: HeldTicket | null; now: number; configuredOrigin: string | null;
    tabUrl: string | undefined; prepared: PreparedDelivery | null; confirmation: DeliveryConfirmation | null; generation: number }):
    { ok: true } | { ok: false; refusal: DeliveryRefusal };
  export interface ScriptingPort { executeScript(injection: { target: { tabId: number }; world: "ISOLATED"; func: typeof deliverOne;
    args: [DeliveryMessage, string, number] }): Promise<{ result?: unknown }[]> }
  export interface DeliveryPorts { scripting: ScriptingPort; getTab(tabId: number): Promise<{ url?: string }>;
    readControlPlaneOrigin(): Promise<string | null>; now(): number; currentGeneration(): number; onProgress(sent: number, total: number): void }
  export type DeliveryResult = { kind: "delivered" } | { kind: "refused"; refusal: DeliveryRefusal }
    | { kind: "interrupted"; at: number | "begin" | "end"; code: string };
  export function sendDelivery(ticket: HeldTicket, prepared: PreparedDelivery, confirmation: DeliveryConfirmation | null, ports: DeliveryPorts): Promise<DeliveryResult>;
  ```

Ordre de `authorizeInjection` (premier refus gagnant) : `no-ticket`, `ticket-used`,
`ticket-expired` (`now - receivedAt > DELIVERY_TICKET_MAX_AGE_MS`), `origin-unset`,
`origin-mismatch` (`!sameOrigin(observedOriginOf(tabUrl), ticket.targetOrigin) ||
!sameOrigin(ticket.targetOrigin, configuredOrigin)`), `not-prepared`, `not-confirmed`
(absente, ou `exportSha256 !== prepared.envelope.exportSha256`), `stale-preparation`
(génération de la préparation ou de la confirmation ≠ génération courante).
`sendDelivery` : `getTab` et réglage relus **immédiatement** avant la garde ; refus → aucun
`executeScript` ; sinon `ticket.used = true` **avant** la première injection, puis pour
chaque message de `deliveryMessages` un appel exactement
`{ target: { tabId }, world: "ISOLATED", func: deliverOne, args: [message, targetOrigin, ACK_TIMEOUT_MS] }` ;
résultat attendu : un seul élément dont `result` passe `parseDeliveryAck`, même
`deliveryId`, index attendu, `ok: true`. Sinon `interrupted` (codes `ack.code`,
`"delivery.timeout"`, `"delivery.invalid"`, `"delivery.injection-failed"`) et aucun appel
ultérieur ; `currentGeneration()` relue avant chaque appel, changement →
`"delivery.stale"`.

- [ ] **Test rouge.**
  ```ts
  const target = "https://cp.example.org";
  async function prepared(generation = 3): Promise<PreparedDelivery> {
    const exportBytes = Uint8Array.from({ length: DELIVERY_CHUNK_BYTES + 10 }, (_, i) => i & 255);
    return { envelope: await buildDeliveryEnvelope(exportBytes, "https://fixture.invalid"), exportBytes, generation };
  }
  const confirmed = (p: PreparedDelivery): DeliveryConfirmation => ({ exportSha256: p.envelope.exportSha256, generation: p.generation });
  const ticket = (): HeldTicket => ({ tabId: 9, targetOrigin: target, receivedAt: 0, used: false });
  function ports(over: { url?: string; setting?: string | null; generation?: number; scripting?: ScriptingPort } = {}) {
    const calls: Parameters<ScriptingPort["executeScript"]>[0][] = [];
    const scripting: ScriptingPort = over.scripting ?? { async executeScript(injection) { calls.push(injection);
      const m = injection.args[0];
      const index = m.type === "signalement.delivery.chunk" ? m.index : m.type === "signalement.delivery.begin" ? "begin" : "end";
      return [{ result: { type: "signalement.delivery.ack", deliveryId: m.deliveryId, index, ok: true, code: null } }]; } };
    const value: DeliveryPorts = { scripting, getTab: async () => ({ url: over.url ?? `${target}/receive` }),
      readControlPlaneOrigin: async () => (over.setting === undefined ? target : over.setting),
      now: () => 1_000, currentGeneration: () => over.generation ?? 3, onProgress: () => {} };
    return { calls, value };
  }
  test("a confirmed delivery injects the fixed function once per message, in order, isolated, top frame only", async () => {
    const p = await prepared(); const t = ticket(); const { calls, value } = ports();
    expect(await sendDelivery(t, p, confirmed(p), value)).toEqual({ kind: "delivered" });
    expect(calls.map((c) => c.args[0].type)).toEqual(["signalement.delivery.begin", "signalement.delivery.chunk",
      "signalement.delivery.chunk", "signalement.delivery.end"]);
    for (const c of calls) {
      expect(c.func).toBe(deliverOne); expect(c.world).toBe("ISOLATED"); expect(c.target).toEqual({ tabId: 9 });
      expect(c.args[1]).toBe(target); expect(c.args[2]).toBe(ACK_TIMEOUT_MS);
      expect(Object.keys(c).sort()).toEqual(["args", "func", "target", "world"]);
    }
    expect(t.used).toBe(true);
  });
  test("no ticket (no gesture): zero executeScript calls", async () => { /* authorizeInjection({ ticket: null, … }) → no-ticket ; sendDelivery avec ticket used → ticket-used ; calls [] */ });
  test("tab now on another origin: zero executeScript calls", async () => {
    for (const url of ["https://evil.example/", "https://cp.example.org.evil.example/", undefined]) {
      const p = await prepared(); const { calls, value } = ports({ url });
      expect(await sendDelivery(ticket(), p, confirmed(p), value)).toEqual({ kind: "refused", refusal: "origin-mismatch" });
      expect(calls).toEqual([]);
    }
  });
  test("setting changed or cleared since the gesture: zero executeScript calls", async () => { /* "https://other.example" → origin-mismatch ; null → origin-unset */ });
  test("without confirmation, or confirmation of other bytes: zero executeScript calls", async () => { /* null → not-confirmed ; exportSha256 "0".repeat(64) → not-confirmed */ });
  test("a generation change after confirmation refuses stale-preparation", async () => { /* ports({ generation: 4 }) → stale-preparation, calls [] */ });
  test("a second send with the same ticket injects nothing more", async () => { /* 2e appel → ticket-used ; calls.length inchangé */ });
  test("an expired held ticket is refused", async () => { /* receivedAt -600_001 → ticket-expired */ });
  test("executeScript rejecting mid-stream stops every later call", async () => { /* rejet au 2e appel → interrupted at 0 code delivery.injection-failed ; 2 appels */ });
  test("a refused, forged or late ack stops the delivery", async () => {
    /* { ok:false, code:"protocol.order" } → interrupted code protocol.order ; ack d'un autre deliveryId → delivery.invalid ;
       { type:"signalement.delivery.timeout" } → delivery.timeout ; deux résultats → delivery.invalid ; aucun appel après l'échec */
  });
  ```
- [ ] **Exécution rouge.** `bun test apps/extension-shared/delivery.test.ts` → module absent.
- [ ] **Implémentation** selon l'ordre et l'algorithme.
- [ ] **Exécution verte.** même commande → `0 fail`.
- [ ] **Neutralisation (`gesture-bound-delivery`, une substitution par garde, relancée
  isolément).** N1 `no-ticket` → `false` : test 2 ; N2 origine de l'onglet → `false` :
  test 3 ; N3 comparaison au réglage → `false` : test 4 ; N4 `not-confirmed` → `false` :
  test 5 ; N5 `stale-preparation` → `false` : test 6 ; N6 `ticket.used = true` → `void 0` :
  test 7 ; N7 `interrupted` sur échec d'acquittement → `continue` : test 10. Le commit
  liste les sept tests rouges.
- [ ] **Commit.**
  ```bash
  git add apps/extension-shared/delivery.ts apps/extension-shared/delivery.test.ts
  git commit -s -m "feat(extension): gate every injection on gesture ticket, exact origin and confirmed fresh preparation"
  ```

### Task 12: Popup et éditeur — réglage, origine observée, confirmation, envoi

**Files:**
- Modify: `apps/extension-shared/popup.html:3`, `apps/extension-shared/popup.ts:1-17`
- Create: `apps/extension-shared/popup-messages.ts`, `apps/extension-shared/editor-hash.ts`
- Modify: `apps/extension-shared/editor.html:4-36`, `apps/extension-shared/editor.ts` (`476-549` → `collectExportInput()`, `564-584` initialisation, nouveaux liens)
- Modify: `apps/extension-shared/editor.browser-fixture.ts`, `apps/extension-shared/editor.browser-check.ts` (mode `--delivery-fixture`), `.github/workflows/ci.yml:47-52` (une ligne : `bun apps/extension-shared/editor.browser-check.ts --delivery-fixture`)
- Test: `apps/extension-shared/popup-messages.test.ts`, `apps/extension-shared/editor-hash.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 5, 9, 10, 11 ; `buildDeliveryEnvelope` (L1).
- Produces:
  ```ts
  export function popupMessage(kind: "capture" | "open" | "deliver", error: ReplyError): string;
  export function parseEditorHash(hash: string): { kind: "capture"; nonce: string } | { kind: "delivery"; nonce: string } | null;
  ```

Textes fixés (affichés par `textContent`) :
- popup : bouton `deliver` « Envoyer au control plane » ; `origin-unset` « Aucune origine
  de control plane n'est configurée. Configurez-la dans l'éditeur, section « Control plane
  de l'organisation ». Rien n'a été remis. » ; `origin-mismatch` « Cet onglet n'est pas le
  control plane configuré. Rien n'a été remis. » ; `origin-unavailable` « Origine de
  l'onglet illisible. Rien n'a été remis. » ; autres codes de `deliver` « Remise
  indisponible. Rien n'a été remis. » ; `capture`/`open` gardent `popup.ts:13-14`.
- éditeur, section « Observation de capture » : `observed-origin` (« Origine observée à la
  capture : <origine> » ou « Aucune origine observée. »), bouton `withdraw-origin` « Retirer
  l'origine observée », texte « Observation enregistrée par l'extension à la capture
  (schéma, hôte, port), distincte de vos déclarations. Jamais incluse dans l'export local ;
  transmise seulement lors d'une remise au control plane, si vous la gardez. » ; retirer
  met `observedOrigin = null` et appelle `invalidate()` (`editor.ts:91-100`).
- section « Control plane de l'organisation » : `control-plane-origin` (`type="url"`,
  `maxlength="2048"`, `autocomplete="off"`), bouton `save-control-plane`,
  `control-plane-current` ; refus par code (`origin.https-required` → « HTTPS requis. ») ;
  variante `development` : « Build de développement : http://localhost admis. ».
- section « Remise au control plane » (masquée sans ticket) : `delivery-target`
  (« Destination : <origine> »), bouton `prepare-delivery` « Préparer la remise », bloc
  `delivery-review` avec `delivery-destination`, `delivery-observed` (« Origine observée
  transmise : <origine> » ou « Origine observée retirée : non transmise »),
  `delivery-files`, `delivery-markdown`, `delivery-image`, `delivery-digest` (« Empreinte :
  <12 premiers caractères> — longueur <n> octets »), case `delivery-approved` « J'approuve
  la remise de ce contenu exact à cette destination. », bouton `send-delivery` « Confirmer
  et remettre », statut `delivery-status` (« Remise : <i> / <n> » ; échec : « Remise
  interrompue (<code>). Rien n'a été accepté par le control plane. »).

Comportement : `parseEditorHash` remplace `editor.ts:565` (`#<nonce>` capture,
`#delivery=<nonce>` remise) ; le ticket est consommé à l'initialisation et gardé en
`HeldTicket` ; « Préparer la remise » exige coffre déverrouillé et `readyVideo()`, puis
`collectExportInput()` (même construction que « prepare », `editor.ts:489-531`),
`buildReview(payload, utc())`, `toZip()`, `buildDeliveryEnvelope(exportBytes,
observedOrigin)` : nouvelle frontière d'approbation (ADR-0005), indépendante de la revue
d'export local ; la case fixe `DeliveryConfirmation`, toute invalidation la retire ;
« Confirmer et remettre » appelle `sendDelivery` avec `scripting`, `tabs.get`, le réglage
relu et `generation`. Verrouiller (`editor.ts:119-150`) efface ticket, préparation et
confirmation.

Hypothèse H2 (tranchée par l'étape 7 des Tasks 15-17) : l'autorisation `activeTab` du
geste survit au passage de l'éditeur au premier plan, jusqu'à navigation ou fermeture de
l'onglet. Si elle tombe, `executeScript` rejette (`delivery.injection-failed`), ce
navigateur reste non qualifié et la question remonte au propriétaire ; aucune permission
d'hôte n'est ajoutée pour la contourner.

- [ ] **Test rouge.** `popup-messages.test.ts` : les quatre textes `deliver` à l'octet, et
  `popupMessage("capture", "capture-unavailable")` égal au texte actuel de
  `popup.ts:13-14`. `editor-hash.test.ts` : `#<identifiant>` → capture,
  `#delivery=<identifiant>` → delivery, `"#delivery="`, `"#capture=x"`, `""`, `"#"` → `null`.
- [ ] **Test rouge — DOM réel (`--delivery-fixture`).** La fixture simule
  `runtime.sendMessage` (réponse `consume-delivery`), `tabs.get`
  (`https://cp.example.org/receive`) et `scripting.executeScript` (compteur + ack
  synthétique), avec IndexedDB réel ; assertions nommées : `observed-origin-shown`,
  `observed-origin-withdrawn-invalidates-review`, `control-plane-origin-http-refused-in-release`,
  `control-plane-origin-saved`, `send-refused-before-confirmation-zero-injections`,
  `confirmation-revoked-by-edit-zero-injections`, `delivery-sent-in-order-with-fixed-function`,
  `second-send-zero-injections`.
- [ ] **Exécution rouge.** `bun test apps/extension-shared/popup-messages.test.ts apps/extension-shared/editor-hash.test.ts` et `bun apps/extension-shared/editor.browser-check.ts --delivery-fixture` → échecs.
- [ ] **Implémentation** selon les éléments fixés.
- [ ] **Exécution verte.** mêmes commandes, plus `editor.browser-check.ts`, `--audio-fixture`, `--init-lock` → verts.
- [ ] **Neutralisation.** Confirmation passée à `sendDelivery` recalculée à l'envoi au lieu
  de celle fixée par la case → `confirmation-revoked-by-edit-zero-injections` rouge.
- [ ] **Commit.**
  ```bash
  git add apps/extension-shared/popup.html apps/extension-shared/popup.ts apps/extension-shared/popup-messages.ts apps/extension-shared/popup-messages.test.ts apps/extension-shared/editor-hash.ts apps/extension-shared/editor-hash.test.ts apps/extension-shared/editor.html apps/extension-shared/editor.ts apps/extension-shared/editor.browser-fixture.ts apps/extension-shared/editor.browser-check.ts .github/workflows/ci.yml
  git commit -s -m "feat(extension): add control plane setting, withdrawable observed origin and confirmed delivery UI"
  ```

### Task 13: Récepteur de page et bout en bout contre le banc L4

**Dépend de la décision du propriétaire sur la question 1** (vérification côté page,
option A appliquée ici, écart au design §5.2 point 5 inscrit au registre §4.5). Option B
retenue → les contrôles de transport restent et le vérificateur navigateur de L1 s'ajoute
avant `upload` ; option C → la tâche est réécrite.

L4 livre la page `/receive`, sa CSP, son authentification et le point d'accroche
(Task 25 de son plan) : `web/receive/index.ts` exporte `mountReceiver: MountReceiver`
(substitut affichant un texte d'absence) et `web/receive-contract.ts` définit
`ReceiverHost`. L6 remplace le substitut, sans toucher route, CSP ni requête.

**Files:**
- Create: `apps/control-plane/web/receive/receiver.ts` (pur), `apps/control-plane/web/receive/view.ts` (DOM, `textContent`)
- Modify: `apps/control-plane/web/receive/index.ts` (remplacement intégral, export `mountReceiver` conservé)
- Modify: le test de substitut de L4 (« the placeholder receiver exports mountReceiver and the exact absence text », localisé par `grep -rln "RECEIVER_UNAVAILABLE_TEXT" apps/control-plane`) et l'assertion correspondante du contrôle navigateur de L4 (Task 28 de son plan) : texte au repos au lieu du texte d'absence
- Test: `apps/control-plane/web/receive/receiver.test.ts`, `apps/control-plane/web/receive/receive.e2e.test.ts`

**Interfaces:**
- Consumes: Task 6/7 (`createReassembler`, `deliveryMessages`) ; `readZip`
  (`packages/domain/zip.ts:98`) ; registre §4.5 : `ReceiverHost` (dont
  `upload(exportBytes, envelope)` et `controlPlaneOrigin`, `announce`, `goToSend`),
  `MountReceiver`, réponse `{ dossierId, revisionId, exportSha256, created }`,
  `startTestControlPlane()` (`apps/control-plane/testing/harness.ts`).
- Produces:
  ```ts
  export type ReceiverState =
    | { kind: "idle" }
    | { kind: "receiving"; deliveryId: string; received: number; total: number; observedOrigin: string | null; exportSha256: string }
    | { kind: "verifying" } | { kind: "uploading" }
    | { kind: "accepted"; dossierId: string; revisionId: string; created: boolean }
    | { kind: "refused"; code: string };
  export function createPageReceiver(deps: { now(): number; digest(bytes: Uint8Array<ArrayBuffer>): Promise<string>;
    upload: ReceiverHost["upload"]; onState(state: ReceiverState): void }):
    { handle(data: unknown): Promise<DeliveryAck | null>; tick(): DeliveryAck | null };
  export const RECEIVER_IDLE_TEXT = "Prêt à recevoir. Sur cet onglet, ouvrez l'extension Signalement et choisissez « Envoyer au control plane ».";
  export const mountReceiver: MountReceiver;
  ```

Règles : après `outcome.kind === "complete"`, `readZip(bytes)` (exception → ack `end`
`export.archive-invalid`) et présence de `manifest.json` ; l'ack `end` `ok: true` part
**après** ; puis `host.upload(bytes, envelope)` ; refus serveur → `refused` avec son code
(jamais `accepted`) ; exception → `refused("upload.unreachable")`. `mountReceiver` :
écouteur `message` filtrant `event.source === window && event.origin ===
host.controlPlaneOrigin`, réponse `window.postMessage(ack, host.controlPlaneOrigin)`,
`setInterval(tick, 5_000)` ; affichage : état, « Réception : <i> / <n> », origine
observée (ou « retirée »), 12 premiers caractères du digest ; `host.announce` à chaque
changement ; après `accepted`, bouton « Continuer vers l'envoi » → `host.goToSend(dossierId)`.

- [ ] **Test rouge — récepteur.**
  ```ts
  test("the page uploads only after end with matching length and digest", async () => { /* upload espion : 0 appel avant end, 1 après ; octets et enveloppe identiques ; idle→receiving→verifying→uploading→accepted */ });
  test("an unreadable archive with a correct digest is refused before upload", async () => { /* 64 octets de motif, digest exact → ack end ok:false export.archive-invalid ; upload 0 appel */ });
  test("a server refusal is shown as refused with its code, never as accepted", async () => { /* upload → refus upload.export_invalid → refused upload.export_invalid */ });
  test("an upload exception is refused upload.unreachable", async () => { /* upload rejette */ });
  test("messages that are not delivery protocol messages are ignored without ack", async () => { /* handle("x"), handle({ type: "other" }) → null */ });
  ```
  Les archives valides viennent de `buildReview(...).toZip()` comme dans
  `tools/contracts/export-roundtrip.test.ts`.
- [ ] **Test rouge — bout en bout** (`receive.e2e.test.ts`, sous `tools/ci/with-postgres.ts`) :
  `startTestControlPlane()` ; `upload` réel = requête vers `${cp.url}/api/v1/deliveries/uploads`
  au format du registre §4.5, authentifiée par l'en-tête `Authorization` de schéma `Bearer`
  portant `await cp.issueToken("reporter")` (valeur assemblée en code, jamais littérale) ;
  chaque message de `deliveryMessages` passe par `createPageReceiver.handle`. Assertions :
  export valide → état `accepted` avec `created: true` et `exportSha256` égal à celui de
  l'enveloppe ; même export remis une seconde fois (nouvelle enveloppe) → `created: false`,
  même `revisionId` ; export dont un octet du manifeste est altéré, enveloppe recalculée →
  `refused("upload.export_invalid")` (seul `verifyExport` serveur peut le refuser) ;
  `cp.stop()` en `finally`.
- [ ] **Test rouge — point d'accroche.** `mountReceiver` est une fonction et
  `RECEIVER_IDLE_TEXT` vaut le texte fixé ; le test d'hôte de L4 reste vert.
- [ ] **Exécution rouge.** `bun test apps/control-plane/web` et `bun tools/ci/with-postgres.ts -- bun test apps/control-plane/web/receive/receive.e2e.test.ts` → échecs.
- [ ] **Implémentation.** `receiver.ts` pur ; `view.ts` et `index.ts` pour le câblage.
- [ ] **Exécution verte.** mêmes commandes → `0 fail` ; contrôle navigateur de L4 (Task 28) vert avec l'assertion mise à jour.
- [ ] **Neutralisation.** (a) `upload` avant `readZip` → test 2 rouge ; (b) passage refus →
  `refused` remplacé par `accepted` → test 3 et l'assertion `upload.export_invalid` du bout
  en bout rouges ; (c) filtre `event.origin === host.controlPlaneOrigin` → `true` :
  `receiverIgnoresForeignOrigin` de l'étape 5 de la Task 15 devient faux, reçu en échec.
- [ ] **Commit.**
  ```bash
  git add apps/control-plane/web/receive <test de substitut L4 modifié> <contrôle navigateur L4 modifié>
  git commit -s -m "feat(control-plane): mount the delivery receiver and prove it end to end against the test control plane"
  ```
