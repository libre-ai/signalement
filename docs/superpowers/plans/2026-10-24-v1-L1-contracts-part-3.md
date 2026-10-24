# Signalement v1.0 L1 — partie 3 : `signalement`, revues, verrou, tâches 10 à 15

Index, Global Constraints, décisions DL1-DL12 et Review Focus :
`2026-10-24-v1-L1-contracts.md`. Tâches 10, 11, 14 et 15 dans `libre-ai/signalement`
(worktree propre à chaque branche, créé et retiré dans le même flux) ; 12 et 13 dans
l'autorité.

## Phase B — `signalement`

### Task 10: `pin.json` v2 et gate de dérive généralisé

Indépendante de la phase A ; fusionnable seule (aucun contrat nouveau consommé, même
commit épinglé).

**Files:**
- Create: `tools/contracts/pin.ts`, `tools/contracts/pin.test.ts`
- Modify: `vendor/contracts/pin.json` (format v2, même commit, mêmes 9 fichiers)
- Modify: `tools/contracts/check-drift.ts:5-57` (lecture du pin, contrôles par contrat), `:134-166` (autorité, ligne de succès)
- Modify: `tools/contracts/check-drift.test.ts:5-13` (chemins via `parsePin`) + tests ci-dessous
- Modify: `tools/contracts/export-roundtrip.test.ts:28-29` (invariance de l'export)

**Interfaces:**
- Produces:
  ```ts
  // tools/contracts/pin.ts
  export const CONTRACT_PIN_SCHEMA_VERSION = "signalement.contract-pin.v2";
  export interface PinnedContract { id: string; status: "locked" | "candidate"; files: readonly string[] }
  export interface ContractPin {
    schemaVersion: typeof CONTRACT_PIN_SCHEMA_VERSION;
    repository: string; commit: string;
    contracts: readonly PinnedContract[];
    files: Readonly<Record<string, string>>;
  }
  export function parsePin(bytes: Uint8Array): ContractPin | null;

  // tools/contracts/check-drift.ts
  export interface VendorExpectation {
    root: URL; pinDigest: string; repository: string; commit: string;
    consumed: readonly string[];                          // contract ids, pin order
    validator: { committed: URL; generated: () => string } | null;
  }
  export const CONSUMED_CONTRACTS: readonly string[];
  export const PRODUCTION_VENDOR: VendorExpectation;
  export async function vendoredDriftFailures(expectation?: VendorExpectation): Promise<string[]>;
  export async function authorityDriftFailures(reader?: AuthorityReader, pin?: ContractPin):
    Promise<{ failures: string[]; verified: number; servedBranch: string | null }>;
  ```

`parsePin` renvoie `null` sauf si : `schemaVersion` exact ; `repository`
`^(https|file)://\S+$` ; `commit` `^[0-9a-f]{40}$` ; `contracts` non vide, ids uniques
`^[a-z][a-z0-9-]*-v[1-9][0-9]*$`, `status` `locked|candidate`, `files` non vide sans
doublon ; chemins `^(contracts|tools)/[A-Za-z0-9._/-]+$` sans `..` ; hachages
`^[a-f0-9]{64}$` ; aucune clé inconnue.

Codes de `vendoredDriftFailures`, dans l'ordre : `pin.digest` (seul, arrêt), `pin.schema`
(seul, arrêt), `pin.identity`, `pin.contract_missing:<id>`, `pin.contract_unexpected:<id>`,
`pin.file_undeclared:<path>` (cité par un contrat, absent de `files`),
`pin.file_orphan:<path>`, `vendor.inventory`, `vendor.missing:<path>` (fichier absent ou
illisible : échec nommé, alors qu'aujourd'hui `readFile` lève), `vendor.drift:<path>`,
puis par contrat : `contract.missing:<id>`, `contract.status_mismatch:<id>`,
`contract.not_locked:<id>` (catalogue ≠ `locked` ou porte `review`),
`contract.authority_unvendored:<id>` (`path`, `profiles` ou `vectors` absents des `files`
du contrat) ; enfin `validator.drift`. `AUTHORITY_COMMIT` et `PIN_DIGEST` restent des
constantes revues.

- [ ] **Avant toute modification**, relever les empreintes normatives de l'export :
  `jq -r '.files | to_entries[] | select(.key | test("schemas/signalement-local-export|fixtures/signalement-local-export|tools/quality/")) | "\(.key) \(.value)"' vendor/contracts/pin.json`
  et `shasum -a 256 packages/domain/schema-validator.js` → constante
  `LOCAL_EXPORT_NORMATIVE_BYTES` (7 entrées ; ce sont l'invariant B5, pas des faits volatils).
- [ ] Tests rouges. `pin.test.ts` : v2 acceptée ; v1, id dupliqué, `contracts/../x`, clé
  inconnue, `status: "draft"` → `null`. `check-drift.test.ts`, avec `syntheticVendor(spec)`
  qui écrit sous `mktemp` catalogue, fichiers et pin (`validator: null`) :
  ```ts
  test("a clean synthetic vendor of two locked contracts passes", async () =>
    expect(await vendoredDriftFailures(await syntheticVendor(twoLocked))).toEqual([]));
  test("a candidate at the pinned commit is contract.not_locked, never a pass", async () =>
    expect(await vendoredDriftFailures(await syntheticVendor(withCatalogStatus("b-v1", "candidate", "candidate"))))
      .toEqual(["contract.not_locked:b-v1"]));
  test("a pin status that disagrees with the catalog is contract.status_mismatch", async () =>
    expect(await vendoredDriftFailures(await syntheticVendor(withCatalogStatus("b-v1", "candidate", "locked"))))
      .toEqual(["contract.status_mismatch:b-v1", "contract.not_locked:b-v1"]));
  test("a consumed contract absent from the pin is pin.contract_missing", async () =>
    expect(await vendoredDriftFailures({ ...(await syntheticVendor(twoLocked)), consumed: ["a-v1", "b-v1", "c-v1"] }))
      .toEqual(["pin.contract_missing:c-v1"]));
  test("a declared vendored file that is missing is vendor.missing, not a thrown error", async () => {
    const v = await syntheticVendor(twoLocked); await unlink(new URL("contracts/schemas/b.v1.schema.json", v.root));
    expect(await vendoredDriftFailures(v)).toEqual(["vendor.missing:contracts/schemas/b.v1.schema.json"]);
  });
  // same shape, exact arrays: vendor.drift:<path>, pin.contract_unexpected, contract.missing,
  // contract.authority_unvendored, pin.file_orphan, pin.file_undeclared
  ```
  `export-roundtrip.test.ts` :
  ```ts
  test("local export normative files keep their bytes", async () => {
    for (const [path, expected] of Object.entries(LOCAL_EXPORT_NORMATIVE_BYTES))
      expect(sha256(await Bun.file(path).bytes())).toBe(expected);
  });
  ```
- [ ] `bun run check:export` → FAIL.
- [ ] Implémenter `pin.ts`, réécrire `pin.json` en v2 (même `commit`, un seul contrat citant
  les 9 fichiers), `CONSUMED_CONTRACTS = ["signalement-local-export-v1"]`, `PIN_DIGEST` =
  `shasum -a 256 vendor/contracts/pin.json | cut -d' ' -f1` ; ligne de succès :
  `<verified>/<files> vendored files matched <repo>@<commit> (served branch: <b>); <n> contracts (<k> locked): <ids>`.
- [ ] `bun run check:export` → PASS ; `bun run check:contracts` → `9/9 … 1 contracts (1 locked)`.
- [ ] Neutralisations, chacune rétablie : boucle `contract.not_locked` en no-op → test
  candidat rouge ; `pin.contract_missing` en no-op → son test rouge ; un octet changé dans
  `vendor/contracts/tools/quality/signalement-local-export-v1.ts` → invariance et
  `vendor.drift` rouges.
- [ ] `bun run check` vert ; commit des 6 fichiers de la liste, message
  `refactor(contracts): pin several vendored contracts with per-contract lock checks` ;
  PR, fusion sur checks requis verts.

### Task 11: vendorisation des candidats pour L2 (branche non fusionnée)

**ATTENTE :** tâches 9 et 10 fusionnées.

**Files:**
- Modify: `vendor/contracts/pin.json`, `vendor/contracts/contracts/catalog.v1.json`, `vendor/contracts/contracts/signalement-local-export-v1/SEMANTICS.md`
- Create: sous `vendor/contracts/`, les fichiers du tableau
- Modify: `tools/contracts/check-drift.ts` (`CONSUMED_CONTRACTS`, `AUTHORITY_COMMIT`, `PIN_DIGEST`), `package.json`, `bun.lock`
- Create: `tools/contracts/vendored-verifiers.test.ts`

**Interfaces:**
- Produces: branche `feat/v1-l1-vendor-candidates` (jamais fusionnée), base de la branche
  L2 ; chemins vendorisés consommés par L2 à L7 :
  `vendor/contracts/tools/quality/signalement-<nom>-v1.ts` (5),
  `vendor/contracts/contracts/fixtures/signalement-projection-receipt-v1/signature-vectors.v1.json`,
  `vendor/contracts/contracts/fixtures/signalement-policy-receipt-v1/golden-vectors.v1.json`,
  `vendor/contracts/contracts/wit/signalement-policy-receipt-v1/world.wit`,
  `vendor/contracts/contracts/fixtures/signalement-connector-profile-v1/profiles.v1.json`

Chaque contrat cite aussi `contracts/catalog.v1.json`, `contracts/COMPATIBILITY.md`,
`tools/quality/policy-core-raw-inputs.ts`, `tools/quality/authorized-execution.ts`.

| Contrat | Fichiers propres |
| --- | --- |
| `signalement-local-export-v1` | les 9 actuels |
| `signalement-delivery-envelope-v1` | schéma, `contracts/signalement-delivery-envelope-v1/SEMANTICS.md`, `{schema-fixtures,vectors}.json`, vérificateur |
| `signalement-connector-profile-v1` | schéma, `SEMANTICS.md`, `{schema-fixtures,vectors,profiles.v1}.json`, vérificateur |
| `signalement-routing-policy-v1` | schéma, `SEMANTICS.md`, `{schema-fixtures,vectors}.json`, vérificateur |
| `signalement-projection-receipt-v1` | schéma, `SEMANTICS.md`, `{schema-fixtures,vectors,signature-vectors.v1}.json`, vérificateur |
| `signalement-policy-receipt-v1` | `world.wit`, son `SEMANTICS.md`, `golden-vectors.v1.json`, `signature-vectors.v1.json`, son vérificateur et ceux qu'il importe |

DL10 : `@noble/curves` à la version exacte de l'autorité (2.4.0 le 2026-10-24), MIT,
transitive `@noble/hashes` (MIT) épinglée par `bun.lock`, provenance vérifiée le
2026-09-12 (`docs/reviews/build-brief-v2-crypto-dependencies.md` de l'autorité), âge >
3 jours ; licence et date à revérifier par `npm view @noble/curves@<v> license time --json`.

- [ ] `git switch -c feat/v1-l1-vendor-candidates` ; clone de l'autorité sous `mktemp -d` ;
  `COMMIT` = commit de fusion de la tâche 9 ; pour chaque chemin :
  `mkdir -p "vendor/contracts/$(dirname "$p")" && git -C "$AUTH" show "$COMMIT:$p" > "vendor/contracts/$p"`.
- [ ] Pin (6 contrats, `candidate` pour les 5 nouveaux), `CONSUMED_CONTRACTS` (ordre du
  pin), `AUTHORITY_COMMIT`, `PIN_DIGEST` ; `bun add -d --exact @noble/curves@<v>`.
- [ ] Test `tools/contracts/vendored-verifiers.test.ts` :
  ```ts
  for (const [id, verify] of [
    ["signalement-delivery-envelope-v1", rawDeliveryEnvelopeFailures],
    ["signalement-connector-profile-v1", rawConnectorProfileFailures],
    ["signalement-routing-policy-v1", rawRoutingPolicyFailures],
    ["signalement-projection-receipt-v1", rawProjectionReceiptFailures],
  ] as const)
    test(`${id}: vendored vectors keep their verdicts`, async () => {
      const vectors = await Bun.file(`vendor/contracts/contracts/fixtures/${id}/vectors.json`).json();
      for (const v of vectors.valid) expect(verify(bytesOf(v))).toEqual([]);
      for (const v of vectors.invalid) expect(verify(bytesOf(v))).toEqual(v.failures);
    });
  test("vendored signature corpus keeps its verdicts", async () => { /* verifyProjectionReceiptSignature, expected per vector */ });
  test("vendored golden vectors are well formed", async () =>
    expect(rawPolicyReceiptFailures(await Bun.file(GOLDEN).bytes())).toEqual([]));
  ```
- [ ] `bun run check:export` → vert (le test prouve aussi la clôture du jeu vendorisé : un
  import manquant lève). Neutralisation : corps de `rawRoutingPolicyFailures` vendorisé
  remplacé par `return []` → test rouge, et `check:contracts` ajoute
  `vendor.drift:tools/quality/signalement-routing-policy-v1.ts`. Rétablir par
  `git checkout -- vendor/contracts`.
- [ ] `bun run typecheck` → 0 erreur (Review Focus 1) ; `bun run lint` vert.
- [ ] `bun run check:contracts` → **rouge attendu** : exactement 5 lignes
  `contract.not_locked:<id>`, aucune autre ; invariance de l'export verte.
- [ ] Commit : `git add vendor/contracts tools/contracts/check-drift.ts tools/contracts/vendored-verifiers.test.ts package.json bun.lock` ;
  `git commit -s -m "chore(contracts): vendor signalement v1 candidate contracts for L2 conformance (not mergeable until locked)"`.
- [ ] Pousser ; PR **brouillon** `DO NOT MERGE: v1 candidate contracts vendored for L2`.
  Le check requis `Bun quality` de `main` exécute `bun run check:tree`, rouge sur
  `contract.not_locked` : fusion bloquée mécaniquement. Annoncer la branche à L2.
- [ ] À chaque correction de candidat (tâche 12) : re-vendoriser au nouveau commit de
  fusion, même attendu rouge.

## Phase C — revues, verrou, ré-épinglage

### Task 12: revues par rôle des candidats

**ATTENTE :** tâche 9 fusionnée. Tourne pendant que L2 développe.

**Files (autorité, branche `work/signalement-v1-contracts-review`):** `docs/reviews/signalement-v1-contracts-review.md` ; le contrat concerné si un constat est accepté.

**Interfaces:** consomme le commit de fusion de la tâche 9 ; produit un verdict par rôle
requis (DL12) et par contrat.

- [ ] Pour chaque rôle requis, une passe **de revue seule** par un agent neuf, sans
  contexte d'auteur, sur le commit de fusion, selon `AGENT-REVIEW-PROTOCOL.md` de
  `project-governance` ; sortie : constats numérotés `chemin:ligne`, verdict `pass` ou
  `changes-required`.
- [ ] Consigner chaque verdict (rôle, commit, constats, réponse). Un constat accepté se
  corrige par une PR de l'autorité (`bun run check` vert), puis la tâche 11 re-vendorise.
- [ ] Commit `docs(reviews): record role verdicts for signalement v1 contracts` ; PR,
  fusion par le propriétaire.

### Task 13: passage en `locked`

**ATTENTE :** (a) L2 vert sur les vecteurs vendorisés par la tâche 11 (vecteurs de
référence des quatre opérations, `signCases`, corpus de signature, conformité TS ↔ WASM),
preuve citée dans la PR ; (b) verdicts de la tâche 12 à `pass` ; (c) **Q5 tranchée** et
fixture GitLab de `profiles.v1.json` conforme (sinon PR de correction du candidat d'abord,
puis re-vendorisation) ; (d) accord du propriétaire.

**Files (autorité, branche `work/signalement-v1-contracts-lock`):**
- Modify: `contracts/catalog.v1.json`, `contracts/catalog-post-lock-additions.v1.json` (5 lignes et 5 `entry` : `status: "locked"`, `review` supprimé), `tools/quality/specification-lock.ts` (empreinte), `contracts/STATUS.md` (régénéré)
- Modify: ADR (conséquences ; `accepted` seulement sur instruction du propriétaire) ; `SEMANTICS.md` dont l'en-tête dit « candidate »
- Create: `tools/quality/signalement-v1-lock.test.ts` (script `check:signalement-v1-lock` dans `check:contracts`)

- [ ] Test rouge (Review Focus 3) :
  ```ts
  const IDS = ["signalement-routing-policy-v1", "signalement-delivery-envelope-v1",
    "signalement-projection-receipt-v1", "signalement-connector-profile-v1", "signalement-policy-receipt-v1"];
  test("each signalement v1 contract is locked identically in the catalog and the post-lock registry", async () => {
    const catalog = await Bun.file("contracts/catalog.v1.json").json();
    const registry = await Bun.file("contracts/catalog-post-lock-additions.v1.json").json();
    for (const id of IDS) {
      const row = catalog.contracts.find((e: { id: string }) => e.id === id);
      expect(registry.additions.find((a: { entry: { id: string } }) => a.entry.id === id)?.entry).toEqual(row);
      expect(row.status).toBe("locked");
      expect("review" in row).toBeFalse();
    }
  });
  ```
- [ ] `bun run check:signalement-v1-lock` → FAIL ; modifier lignes, entrées, empreinte,
  `STATUS.md` → PASS ; `bun run check:specification-lock` et `bun run check` verts.
- [ ] Neutralisation : `review` laissé sur une ligne et son entrée →
  `locked contract carries pending review` (`check-contracts.ts:379-380`) et le test
  rougissent. Rétablir.
- [ ] Commit `feat(contracts): lock signalement v1 contracts after L2 conformance and role review` ;
  PR avec les preuves (a)-(d) ; **fusion par le propriétaire** ; relever le commit de fusion.

### Task 14: ré-épinglage et critère de sortie L1

**ATTENTE :** tâche 13 fusionnée. Précède toute fusion d'une PR de code L2.

**Files:** `vendor/contracts/pin.json`, fichiers vendorisés modifiés, `tools/contracts/check-drift.ts` (`AUTHORITY_COMMIT`, `PIN_DIGEST`), `tools/contracts/vendored-verifiers.test.ts`, `package.json`, `bun.lock`

**Interfaces:** produit `pin.json` épinglant les 6 contrats `locked` sur la branche servie
de `signalement` ; L2 rebase dessus.

- [ ] `git switch -c feat/v1-l1-repin-locked` ; `COMMIT` = commit de fusion de la tâche 13
  (jamais une tête de PR, Review Focus 4) ; `git -C "$AUTH" merge-base --is-ancestor
  "$COMMIT" "origin/$(gh api repos/libre-ai/schemas-and-contracts --jq .default_branch)"` → 0.
- [ ] Re-vendoriser à ce commit ; 6 contrats `locked` ; constantes ; reprendre le test et la
  devDependency de la tâche 11 (`git checkout feat/v1-l1-vendor-candidates --
  tools/contracts/vendored-verifiers.test.ts package.json bun.lock`).
- [ ] `git diff --stat origin/HEAD -- vendor/contracts` : seuls les fichiers attendus ;
  invariance de l'export verte. Seule différence admise côté export :
  `vendor/contracts/contracts/signalement-local-export-v1/SEMANTICS.md` (lien du protocole
  de revue, commit amont `9d0d58eb07`), sous réserve de Q4.
- [ ] `bun run check:contracts` → `… (served branch: <branche servie>); 6 contracts (6 locked): …`,
  sans `authority.unmerged` ; `bun run check:export` et `bun run check` verts.
- [ ] Neutralisation : `status: "candidate"` pour un contrat du pin (et `PIN_DIGEST`
  recalculé) → `contract.status_mismatch:<id>` rouge. Rétablir.
- [ ] Commit des fichiers de la liste, message `chore(contracts): pin the six locked signalement contracts` ;
  PR, fusion sur checks requis verts ; fermer la PR de la tâche 11 sans fusion ;
  `~/.claude/bin/scratch-clean` sur les clones temporaires.
- [ ] Critère de sortie L1 (feuille de route §2), sur la branche servie :
  `gh api repos/libre-ai/schemas-and-contracts/contents/contracts/catalog.v1.json -H "Accept: application/vnd.github.raw" | jq -r '.contracts[] | select(.id | startswith("signalement-")) | "\(.id) \(.kind) \(.status)"'`
  → 6 lignes `locked` (4 `json-schema` + 1 `wit` nouveaux, et l'export) ; corpus de
  signature et vecteurs de référence présents sur la branche servie de l'autorité ;
  `jq -r '.contracts[] | "\(.id) \(.status)"' vendor/contracts/pin.json` → 6 `locked` ;
  `bun run check:contracts` puis `bun run check` verts.

### Task 15: `packages/domain/delivery-envelope.ts`, seul constructeur d'enveloppe

**ATTENTE :** tâche 14 fusionnée (code consommateur). Consommé par L6 et L7 (registre
§4.1, §4.6).

**Files:**
- Create: `packages/domain/delivery-envelope.ts`, `packages/domain/delivery-envelope.test.ts`

**Interfaces:**
- Consumes (test seulement) : `rawDeliveryEnvelopeFailures`, `EXPORT_MAX_BYTES` de
  `vendor/contracts/tools/quality/signalement-delivery-envelope-v1.ts` ; `canonicalJson` de
  `vendor/contracts/tools/quality/authorized-execution.ts`
- Produces:
  ```ts
  export interface DeliveryEnvelope {
    schemaVersion: "libre-ai.signalement-delivery-envelope.v1";
    deliveryId: string;          // UUID v4, lowercase
    exportSha256: string;        // SHA-256 hex of the exact ZIP bytes
    exportByteLength: number;
    observedOrigin: string | null;
  }
  export const DELIVERY_EXPORT_MAX_BYTES = 269500416;
  export async function buildDeliveryEnvelope(exportBytes: Uint8Array, observedOrigin: string | null): Promise<DeliveryEnvelope>;
  ```

Règles : module exécutable en navigateur (extension, page de réception) — WebCrypto
`crypto.subtle.digest("SHA-256", …)` et `crypto.randomUUID()`, aucun import `node:` ni
usage de `Bun` (le vérificateur vendorisé n'est pas chargeable en navigateur, registre
§4.5). Refus par `Error` à code stable : `envelope.export_size` (longueur 0 ou >
`DELIVERY_EXPORT_MAX_BYTES`), `envelope.origin_non_canonical` (schéma autre que
`http`/`https`, ou `new URL(o).origin !== o`).

- [ ] Test rouge :
  ```ts
  test("the envelope digests the exact bytes and satisfies the vendored contract", async () => {
    const bytes = new TextEncoder().encode("synthetic zip bytes");
    const envelope = await buildDeliveryEnvelope(bytes, "https://app.example.com");
    expect(envelope.exportSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(envelope.exportByteLength).toBe(bytes.length);
    expect(rawDeliveryEnvelopeFailures(new TextEncoder().encode(canonicalJson(envelope)))).toEqual([]);
  });
  test("a removed origin travels as null", async () =>
    expect((await buildDeliveryEnvelope(new Uint8Array([1]), null)).observedOrigin).toBeNull());
  test("two envelopes of the same export carry distinct delivery ids", async () => { /* deliveryId differs, UUID v4 pattern */ });
  test("non-canonical origins and out-of-bound sizes are refused", async () => {
    for (const origin of ["https://app.example.com/", "https://app.example.com:443", "HTTPS://APP.EXAMPLE.COM", "file:///x", "null"])
      await expect(buildDeliveryEnvelope(new Uint8Array([1]), origin)).rejects.toThrow("envelope.origin_non_canonical");
    await expect(buildDeliveryEnvelope(new Uint8Array(), null)).rejects.toThrow("envelope.export_size");
  });
  test("the bound equals the contract's and the module stays browser-safe", async () => {
    expect(DELIVERY_EXPORT_MAX_BYTES).toBe(EXPORT_MAX_BYTES);
    expect(await Bun.file("packages/domain/delivery-envelope.ts").text()).not.toMatch(/from "node:|\bBun\./);
  });
  ```
- [ ] `bun run check:export` → FAIL (module absent) ; implémenter → PASS.
- [ ] Neutralisation : contrôle d'origine remplacé par `true` → le test des origines rougit
  (`:443`, majuscules). Rétablir.
- [ ] `bun run check` vert ; commit : `git add packages/domain/delivery-envelope.ts packages/domain/delivery-envelope.test.ts` ;
  `git commit -s -m "feat(domain): add the single delivery envelope builder"` ; PR, fusion
  sur checks requis verts.
