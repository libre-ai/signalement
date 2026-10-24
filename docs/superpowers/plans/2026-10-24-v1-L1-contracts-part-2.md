# Signalement v1.0 L1 — partie 2 : autorité, tâches 6 à 9

Index, Global Constraints (dont la PAC), décisions DL1-DL12 et Review Focus :
`2026-10-24-v1-L1-contracts.md`. Même clone et même branche que la partie 1.

## Phase A — autorité (2/2)

### Task 6: vérification de signature du reçu et corpus de vecteurs

**Files:**
- Modify: `tools/quality/signalement-projection-receipt-v1.{ts,test.ts}`, `contracts/signalement-projection-receipt-v1/SEMANTICS.md`
- Create: `tools/quality/signalement-receipt-vectors.ts` (générateur déterministe, `--write` / `--check`)
- Create: `contracts/fixtures/signalement-projection-receipt-v1/signature-vectors.v1.json`
- Modify: `package.json` (`check:signalement-projection-receipt-v1` enchaîne `bun tools/quality/signalement-receipt-vectors.ts --check`)

**Interfaces:**
- Consumes: `ed25519` de `@noble/curves/ed25519.js` (dépendance exacte de l'autorité) ;
  `points` de `contracts/fixtures/build-brief-v2/strict-ed25519-vectors.json` (torsion et
  ordre mixte, produits par l'oracle dalek `--points`) ; tâche 5
- Produces:
  ```ts
  export type ReceiptSignatureOutcome =
    | { kind: "verdict"; signature: "valid" | "invalid" | "unknown-key" | "unreadable";
        keyId: string | null; keyStatus: "active" | "retired" | null; reason: string | null }
    | { kind: "refused"; code: string };      // unreadable key set only
  export function verifyProjectionReceiptSignature(signed: Uint8Array, publicKeys: Uint8Array): ReceiptSignatureOutcome;
  ```
  Champs `signature`, `keyId`, `keyStatus` = ceux de `ReceiptVerification` (registre §4.2) ;
  `reason` est propre à l'autorité. Corpus :
  `contracts/fixtures/signalement-projection-receipt-v1/signature-vectors.v1.json`.

Algorithme (ordre normatif dans `SEMANTICS.md`) :

1. `rawProjectionReceiptFailures(signed)` non vide, ou `signature.value` non canonique en
   base64url → `unreadable`, `keyId: null`, `keyStatus: null`, `reason` = premier code
   (ou `signature.encoding`).
2. `rawSigningKeySetFailures(publicKeys)` non vide → `refused`, premier code.
3. `receipt.organization` ≠ `PublicKeySet.organization` → `invalid`, `keyStatus: null`,
   `key.organization_mismatch` (avant toute recherche de clé : un jeu d'une autre
   organisation ne vérifie rien).
3 bis. `keyId` absent du jeu → `unknown-key`, `keyStatus: null`, `key.unknown`.
4. `issuedAt` hors de [`notBefore`, `notAfter`) de la clé → `invalid`,
   `key.outside_validity` (comparaison lexicale, timestamps sans fraction).
5. A non admissible (décodage canonique, non identité, sans torsion ; contrôle de
   `isBuildBriefPoint` dupliqué pour ne pas vendoriser `build-brief-v2.ts`) → `invalid`,
   `key.not_admissible`.
6. R non admissible → `invalid`, `signature.r_not_admissible`.
7. S ≥ L → `invalid`, `signature.s_non_canonical`.
8. `ed25519.verify(sig, receiptSigningMessage(unsigned), A, { zip215: false })` faux →
   `invalid`, `signature.mismatch` ; sinon `valid`, `reason: null`. Dès l'étape 4,
   `keyStatus` = statut de la clé trouvée.

Forme du corpus :

```json
{
  "schemaVersion": "libre-ai.signalement-projection-receipt-signature-vectors.v1",
  "testMaterialWarning": "Synthetic keys derived from public labels. Never use outside tests.",
  "domain": "libre-ai.signalement-projection-receipt.v1",
  "vectors": [{ "id": "…", "description": "…", "keySet": {}, "signed": "<base64url>",
                "expected": { "signature": "…", "keyStatus": "…", "reason": "…" } | { "refused": "<code>" } }],
  "signCases": [{ "id": "…", "seed": "<base64url 32 octets>", "unsigned": {}, "signed": "<base64url>" }]
}
```

Graine de test n = SHA-256(UTF-8 `libre-ai.signalement-receipt-test-key.<n>`). Vecteurs :

| Id | Construction | Attendu |
| --- | --- | --- |
| `valid-active` | clé 1 `active` | `valid`, `active`, `null` |
| `valid-retired` | clé 2 `retired`, `issuedAt` dans sa fenêtre | `valid`, `retired`, `null` |
| `key-unknown` | clé 3 absente du jeu | `unknown-key`, `null`, `key.unknown` |
| `key-outside-validity` | `issuedAt` ≥ `notAfter` de la clé 2 | `invalid`, `retired`, `key.outside_validity` |
| `key-identity` | A = identité, R = identité, S = 0 | `invalid`, `key.not_admissible` |
| `key-mixed-order-1` … `-7` | A′ = A + Tᵢ (`mixed-order-i`), k = H(R ‖ A′ ‖ M), S = r + k·a | `invalid`, `key.not_admissible` |
| `r-identity`, `r-torsion-1` … `-7` | R = Tᵢ (`torsion-i`), S = k·a mod L | `invalid`, `signature.r_not_admissible` |
| `s-non-canonical` | signature valide, S + L | `invalid`, `signature.s_non_canonical` |
| `body-byte-modified` | un caractère de `remote.url` changé après signature | `invalid`, `signature.mismatch` |
| `transmitted-digest-modified` | `transmitted[0].sha256` changé | `invalid`, `signature.mismatch` |
| `rendered-digest-modified` | `rendered.bodyDigest` changé | `invalid`, `signature.mismatch` |
| `revision-modified` | `revision` incrémentée après signature | `invalid`, `signature.mismatch` |
| `signed-over-non-jcs` | signature sur `JSON.stringify(unsigned, null, 2)` | `invalid`, `signature.mismatch` |
| `document-whitespace`, `document-key-order` | document signé non JCS | `unreadable`, `receipt.non_canonical` |
| `document-duplicate-member` | `signature` répété | `unreadable`, `receipt.raw_json` |
| `signature-encoding` | dernier caractère de `value` décodant aux mêmes octets | `unreadable`, `signature.encoding` |
| `keyset-duplicate-key-id` | deux clés de même `keyId` | `refused`, `keys.duplicate_key_id` |
| `keyset-other-organization` | signature valide, mais `PublicKeySet.organization` ≠ `receipt.organization` | `invalid`, `null`, `key.organization_mismatch` |

`signCases` : au moins `valid-active` et `valid-retired` (Ed25519 déterministe : `signed`
est l'octet exact attendu de `sign-receipt`, L2).

- [ ] Test rouge :
  ```ts
  for (const v of corpus.vectors)
    test(`signature vector ${v.id}`, () => {
      const out = verifyProjectionReceiptSignature(b64u(v.signed), encode(v.keySet));
      if ("refused" in v.expected) expect(out).toEqual({ kind: "refused", code: v.expected.refused });
      else expect(out).toMatchObject({ kind: "verdict", ...v.expected });
    });
  test("the corpus covers every required family", () => {
    // every id of the table above, including key-mixed-order-1..7 and r-torsion-1..7
  });
  test("every point forgery is accepted by a permissive verifier, so it discriminates", () => {
    for (const v of byPrefix(/^(key-identity|key-mixed-order-|r-identity|r-torsion-)/))
      expect(ed25519.verify(sigOf(v), messageOf(v), keyOf(v), { zip215: true })).toBeTrue();
    expect(verifiesStrictlyOnceReduced(byId("s-non-canonical"))).toBeTrue();
  });
  test("the generator reproduces the committed corpus byte for byte", async () =>
    expect(await generateReceiptVectors()).toEqual(await Bun.file(CORPUS_PATH).text()));
  ```
- [ ] `bun run check:signalement-projection-receipt-v1` → FAIL.
- [ ] Implémenter le vérificateur et le générateur. Algorithme non déterminé par la
  signature : reçu synthétique de base (`remote.url` sous `https://tracker.example.com/`),
  graine dérivée, R, k et S calculés avec les opérations de point et de scalaire de
  `@noble/curves` (API exacte de la version épinglée à vérifier à l'exécution) pour les
  familles « point » et « scalaire », signature normale pour les autres ; sortie
  `JSON.stringify(document, null, 2) + "\n"`.
- [ ] `bun tools/quality/signalement-receipt-vectors.ts --write` puis la commande → PASS
  (N = `jq '.vectors | length'` du corpus, 32 avec la table ; couverture ≥ 0.9).
- [ ] Neutralisations, chacune rétablie : retirer `!point.is0()` → `key-identity` et
  `r-identity` rougissent ; retirer `isTorsionFree()` → les 14 vecteurs d'ordre mixte et de
  torsion rougissent ; retirer le contrôle S ≥ L → `s-non-canonical` rougit (raison
  `signature.mismatch`) ; retirer la fenêtre → `key-outside-validity` rougit ; retirer la comparaison
  d'organisation → `keyset-other-organization` rougit (`valid` au lieu de `invalid`) ;
  `zip215: true` à l'étape 8 → au moins un vecteur adverse devient `valid`.
- [ ] `bun run check` vert ; commit des 5 fichiers de la liste, message
  `feat(contracts): strict Ed25519 receipt verification and adversarial signature corpus`.

### Task 7: oracle Rust indépendant du corpus de signature

**Files:**
- Create: `tools/quality/signalement-receipt-crypto-oracle/{Cargo.toml,Cargo.lock,src/main.rs}`
- Modify: `package.json` (`check:signalement-receipt:crypto-oracle` ; manifeste ajouté à `check:dependency-policy`)
- Modify: `contracts/signalement-projection-receipt-v1/SEMANTICS.md` (recette)

**Interfaces:**
- Consumes: octets du corpus seuls (aucun code TS)
- Produces: binaire non publié ; sortie `Signalement receipt oracle: <N> vectors, <M> sign cases verified; ed25519-dalek <v> + curve25519-dalek <v>.` ; sinon code 1 et `signalement-receipt-crypto-oracle.<code>` sur stderr.

- `Cargo.toml` : `name = "signalement-receipt-crypto-oracle"`, `version = "0.0.0"`,
  `edition = "2021"`, `license = "EUPL-1.2"`, `publish = false`, `[workspace]` ;
  `base64`, `curve25519-dalek`, `ed25519-dalek`, `serde_json`, `sha2` aux versions exactes
  de `build-brief-crypto-oracle` (commandes de l'index). Aucune version nouvelle.
- Algorithme : fichier ≤ 1 MiB, `schemaVersion` vérifié, inventaire vide refusé ; pour
  chaque vecteur : base64url canonique ; `serde_json::Value` ; canonique si
  `serde_json::to_vec(&value)` égale `signed` (exact parce que le reçu est ASCII, que son
  seul nombre est l'entier `revision`, sérialisé à l'identique par JCS et `serde_json`, et
  que `Map` sans `preserve_order` trie les clés ; un membre dupliqué rend aussi les octets
  différents) ; jeu de clés : `keyId` uniques ; organisation du jeu égale à celle du reçu ; clé, fenêtre, `admissible(A)`,
  `admissible(R)` et `verify_strict` sur `domain ‖ 0x00 ‖ Sha256(to_vec(unsigned))` ;
  classe `valid` / `invalid` / `unknown-key` / `unreadable` / `refused` comparée à la
  **classe** attendue (pas à la raison). `signCases` : `SigningKey::from_bytes(seed)` signe
  et le document produit égale `signed`.

- [ ] Test Rust rouge :
  ```rust
  #[test]
  fn refuses_an_unknown_version_and_an_empty_inventory() {
      assert_eq!(run_document(br#"{"schemaVersion":"x","vectors":[],"signCases":[]}"#), Err("version"));
      assert_eq!(run_document(br#"{"schemaVersion":"libre-ai.signalement-projection-receipt-signature-vectors.v1","vectors":[],"signCases":[]}"#), Err("empty-inventory"));
  }
  ```
- [ ] `cargo test --locked --manifest-path tools/quality/signalement-receipt-crypto-oracle/Cargo.toml`
  → FAIL, puis implémenter → PASS.
- [ ] `bun run check:signalement-receipt:crypto-oracle` → N et M égaux à
  `jq '.vectors | length, (.signCases | length)'` du corpus.
- [ ] Neutralisation : `is_torsion_free()` remplacé par `true` dans `admissible` → code 1,
  `signalement-receipt-crypto-oracle.signature-verdict`. Rétablir.
- [ ] `cargo clippy --locked --manifest-path … -- -D warnings` sans avertissement ;
  `bun run check:dependency-policy` vert ; `bun run check` vert (il ne prétend pas avoir
  lancé l'oracle : recette séparée dans `SEMANTICS.md`).
- [ ] Commit, message `test(contracts): independent dalek verify_strict oracle for the receipt corpus`.

### Task 8: monde WIT `signalement-policy-receipt-v1`

**Files:**
- Create: `contracts/wit/signalement-policy-receipt-v1/{world.wit,SEMANTICS.md}`
- Create: `contracts/fixtures/signalement-policy-receipt-v1/golden-vectors.v1.json`
- Create: `tools/quality/signalement-policy-receipt-v1.{ts,test.ts,bunfig.toml}`
- Modify: `tools/quality/check-contracts.ts` (chemin ajouté à `specializedVectorPaths`, `check-contracts.ts:696-702`) ; PAC 5, 7, 9 à 11 (ni projection SDK ni fixture de schéma)

**Interfaces:**
- Consumes: `rawRoutingPolicyFailures`, `rawProjectionReceiptFailures`, `canonicalJson`, `parseStrictJson`
- Produces:
  ```ts
  export function rawPolicyReceiptFailures(bytes: Uint8Array): string[];   // golden vector document
  export const REQUIRED_GOLDEN_CASES: readonly string[];
  ```
  ```wit
  package libre-ai:signalement-policy-receipt@1.0.0;

  interface api {
    record contract-error { code: string, message: string }
    evaluate: func(policy: list<u8>, input: list<u8>) -> result<list<u8>, contract-error>;
    canonicalize: func(json: list<u8>) -> result<list<u8>, contract-error>;
    sign-receipt: func(unsigned: list<u8>, secret-key: list<u8>) -> result<list<u8>, contract-error>;
    verify-receipt: func(signed: list<u8>, public-keys: list<u8>) -> result<list<u8>, contract-error>;
  }

  world signalement-policy-receipt {
    export api;
  }
  ```
  Interface adressée `libre-ai:signalement-policy-receipt/api@1.0.0` (registre) ; nom du
  monde imposé par `check-contracts.ts:1269`. Entrée catalogue : `kind: "wit"`,
  `profiles: ["contracts/wit/signalement-policy-receipt-v1/SEMANTICS.md"]`, `vectors:
  ["contracts/fixtures/signalement-policy-receipt-v1/golden-vectors.v1.json",
  "contracts/fixtures/signalement-projection-receipt-v1/signature-vectors.v1.json"]`.

`SEMANTICS.md` (modèle `contracts/wit/policy-core-v2/SEMANTICS.md`) :

- monde pur, zéro import, ni horloge ni aléa ; `message` ne contient aucun octet d'entrée ;
- plafonds : `policy`, `input`, `json` ≤ 1 MiB (profondeur ≤ 64), `unsigned` et `signed`
  ≤ 65536, `public-keys` ≤ 262144, `secret-key` = graine de 32 octets, sortie ≤ 2 MiB ;
  dépassement → erreur sans sortie partielle ;
- `evaluate` : sémantique de la tâche 4 ; `EvaluationInput` et `PolicyVerdict` du
  registre (sans `selectable` de premier niveau ; jamais `attachment-unsupported` ni
  `user-withheld`) ; codes `policy.invalid`, `input.invalid`, `input.origin_invalid`,
  `input.too_large` ; l'appelant n'évalue que des versions `approved` (DL4) ;
- `canonicalize` : RFC 8785 restreinte aux entiers sûrs ; codes `canonicalize.raw_json`
  (dont membre dupliqué), `canonicalize.number`, `canonicalize.lone_surrogate`,
  `canonicalize.depth`, `canonicalize.too_large` ;
- `sign-receipt` : `unsigned` = `UnsignedReceipt` (tâche 5), `keyId` lu dans
  `unsigned.keyId` ; présence d'un membre `signature` → `receipt.invalid` ; graine ≠ 32
  octets → `key.invalid` ; sortie = reçu signé JCS (DL5) ;
- `verify-receipt` : verdict de la tâche 6 ; sortie = JCS de `ReceiptVerification`
  `{ signature, keyId, keyStatus, receipt }`, `receipt` non nul seulement si `valid` ; jeu
  de clés illisible → `contract-error` `keys.invalid`.

Vecteurs de référence (enveloppe `engine-golden-vectors.v1`, validée par
`check-contracts.ts`) : `schemaVersion: "libre-ai.signalement-policy-receipt-golden-vectors.v1"`,
`world: "signalement-policy-receipt-v1"`, `engineVersion: "1.0.0"`, `canonicalization:
"RFC 8785"`, `digestAlgorithm: "SHA-256"`, `contractFiles` (sha256 des schémas de politique
et de reçu et du corpus de signature), `testMaterialWarning`, et `cases: [{ id, operation:
"evaluate" | "canonicalize" | "sign-receipt" | "verify-receipt", args, expected: { ok } |
{ error: { code } }, rationale }]` (forme lue par l'adaptateur de L2 ; conformité de
`cases` à `$defs/vectorList` vérifiée par `check-contracts.ts`). Arguments : valeurs JSON
(`policy`, `input`, `unsigned`, `publicKeys`, `json`) ou base64url quand les octets ne
sont pas du JSON canonique (`secretKey`, `signed`, `jsonBytes`). Attendus dérivés **à la
main de la sémantique**, `rationale` = clause citée ; la conformité se prouve dans L2.

`REQUIRED_GOLDEN_CASES` :

| Id | Attendu |
| --- | --- |
| `exact-origin` | imposées et optionnelles de la règle, fichiers selon divulgation |
| `host-pattern-subdomain` / `-apex` / `-port` | sous-domaine apparié ; apex et port différent non appariés |
| `absent-origin-rule` / `absent-origin-no-rule` | `null` apparie la règle `absent` ; sans elle, `destinations: []` |
| `no-rule-matched` | `destinations: []`, `deniedCount: 0`, `override: "denied"` |
| `denied-dominates` | imposée par une règle, refusée par une autre : absente, comptée une fois |
| `override-most-restrictive` | `allowed` et absent → `"denied"`, aucune `selectable` |
| `selectable-listed-when-allowed` | `override: "allowed"` → destinations `routing: "selectable"` avec `files` et `media` |
| `selectable-excludes-routed` | `selectable` privé des imposées, optionnelles, refusées |
| `default-withhold` | rôle sans règle `transmit` → `default-withhold` |
| `withhold-dominates-transmit` | `withhold` visibilité publique + `transmit always` → `public-destination` |
| `visibility-unknown` | entrée `discovered` absente → tous les fichiers `visibility-unknown` |
| `gitlab-internal-is-public` | `internal` → `public-destination` |
| `residency-withhold` | `non-eu` → `residency` |
| `attachment-upload-ignored` | `attachmentUpload: false` → aucun `attachment-unsupported` ; `media` = `mediaFallback` |
| `file-order-irrelevant` | fichiers permutés → mêmes octets |
| `origin-with-path` / `policy-unknown-destination` | erreurs `input.origin_invalid` / `policy.invalid` |
| `canonicalize-*` | tri ASCII, imbrication, non-ASCII non échappé, `\u001f` minuscule, entier sûr ; erreurs flottant, 2⁵³, doublon, `\ud800` isolé, profondeur 65 |
| `sign-valid-active`, `sign-valid-retired` | octets de `signCases` (tâche 6) |
| `sign-with-signature-member` / `sign-short-seed` | `receipt.invalid` / `key.invalid` |
| `verify-valid`, `verify-unknown-key`, `verify-mismatch`, `verify-unreadable` | `ReceiptVerification` exacte |

`rawPolicyReceiptFailures`, codes : `golden.size_limit` (8 MiB), `golden.raw_json`,
`golden.envelope`, `golden.contract_file:<path>` (sha256 recalculé, chemin résolu par
rapport au fichier du vérificateur, donc valable sous `vendor/contracts/`),
`golden.case_duplicate:<id>`, `golden.case_missing:<id>`, `golden.policy_invalid:<id>`
(politique d'un cas `evaluate` refusée par `rawRoutingPolicyFailures` sans que le cas
attende `policy.invalid`), `golden.verdict_shape:<id>` (attendu `evaluate` sans exactement
les clés de `PolicyVerdict`), `golden.receipt_invalid:<id>` (sortie `sign-receipt` refusée
par `rawProjectionReceiptFailures`). Il n'importe pas le schéma `engine-golden-vectors.v1`.

- [ ] `world.wit`, `SEMANTICS.md`, `golden-vectors.v1.json`.
- [ ] Test rouge :
  ```ts
  test("the committed golden document is well formed and complete", async () =>
    expect(rawPolicyReceiptFailures(await Bun.file(GOLDEN).bytes())).toEqual([]));
  test("a missing required case and a changed contract file are named failures", async () => {
    const doc = JSON.parse(await Bun.file(GOLDEN).text());
    doc.cases = doc.cases.filter((c: { id: string }) => c.id !== "visibility-unknown");
    doc.contractFiles[0].sha256 = "0".repeat(64);
    expect(rawPolicyReceiptFailures(encode(doc))).toEqual([
      `golden.contract_file:${doc.contractFiles[0].path}`, "golden.case_missing:visibility-unknown",
    ]);
  });
  test("every operation has at least one ok and one error case", () => { /* counts per operation */ });
  ```
- [ ] `bun run check:signalement-policy-receipt-v1` → FAIL ; implémenter → PASS.
- [ ] Neutralisation : boucle `golden.case_missing` remplacée par `[]` → le second test
  rougit. Rétablir.
- [ ] PAC 7, 9 à 11 ; chemin ajouté à `specializedVectorPaths` ; `Contracts verified` +1
  entrée, paires inchangées ; message `feat(contracts): add signalement-policy-receipt-v1 world, semantics and golden vectors`.

### Task 9: vérifications de consommateur, PR et fusion des candidats

**Files:** aucun fichier de contrat nouveau ; corrections éventuelles des vérificateurs.

**Interfaces:**
- Produces: PR fusionnée en `candidate` ; son commit de fusion (`mergeCommit`) est l'entrée de la tâche 11.

- [ ] Typecheck sous les options du consommateur (Review Focus 1) : `tsconfig.json` sous
  `mktemp -d`, qui étend celui de l'autorité et ajoute `exactOptionalPropertyTypes`,
  `noUnusedLocals`, `noUnusedParameters`, `allowImportingTsExtensions`, `include` limité
  aux 5 vérificateurs ; `bunx tsc --noEmit -p <tmp>/tsconfig.json` → 0 erreur. Correction
  dans le vérificateur, jamais en relâchant l'option ; commit éventuel
  `fix(contracts): satisfy consumer compiler options in signalement v1 verifiers`.
- [ ] `bun run check` vert (`Contracts verified` : +5 entrées, +4 paires depuis la base) ;
  `bun run check:catalog-status` vert ; oracle Rust vert.
- [ ] `jq -r '.additions[] | select(.entry.id | startswith("signalement-") and . != "signalement-local-export-v1") | "\(.entry.id) \(.ownerArbitration)"' contracts/catalog-post-lock-additions.v1.json`
  → 5 lignes, valeur donnée par le propriétaire (Q2).
- [ ] Pousser, ouvrir la PR en brouillon vers la branche servie, titre
  `feat(contracts): add signalement v1 contracts (routing policy, delivery envelope, projection receipt, connector profile, policy-receipt world)` ;
  corps : DL12, DL4-DL9, lignes `Contracts verified` avant/après, sortie de l'oracle,
  réponses `gate-integrity` §5, fixture GitLab en attente de Q5, « entries stay candidate;
  no implementation admission ».
- [ ] Checks requis verts (`Licensing`, `composition / validate`, `context-hygiene`) par
  `gh pr checks <n> -R libre-ai/schemas-and-contracts` en boucle bornée.
- [ ] **ATTENTE propriétaire** : signature des noms et de la création, fusion. Relever le
  commit de fusion.
