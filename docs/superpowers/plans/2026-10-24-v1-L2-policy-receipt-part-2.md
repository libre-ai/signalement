# L2 policy-receipt — partie 2 : reçus, WASM, chargeur TS, sortie

> Index, Global Constraints, contrat consommé et Review Focus : `2026-10-24-v1-L2-policy-receipt.md`. Tâches 1 à 7 : `-part-1.md`. « Gate de branche » = la séquence des Global Constraints.

### Task 8: Primitives Ed25519 strictes

**Files:**
- Create: `crates/policy-receipt/src/ed25519.rs`, `crates/policy-receipt/src/encoding.rs`

**Interfaces:**
- Produces:
  ```rust
  pub(crate) fn admissible(point: &[u8]) -> bool;                     // canonique, non identité, sans torsion
  pub(crate) fn s_canonical(signature: &[u8; 64]) -> bool;            // S < L
  pub(crate) fn verify_strict_message(public: &[u8; 32], message: &[u8], signature: &[u8; 64]) -> bool;
  pub(crate) fn sign(seed: &Zeroizing<[u8; 32]>, message: &[u8]) -> [u8; 64];
  pub(crate) fn decode_b64url_canonical(text: &str, expected_len: usize) -> Result<Vec<u8>, ()>;
  pub(crate) fn encode_b64url(bytes: &[u8]) -> String;
  ```

`admissible` reprend l'oracle `schemas-and-contracts/tools/quality/build-brief-crypto-oracle/src/main.rs` : `CompressedEdwardsY::decompress`, recompression égale aux octets, `!is_identity()`, `is_torsion_free()`. `verify_strict_message` = `VerifyingKey::from_bytes` puis `verify_strict`. Aucune arithmétique de courbe écrite à la main. `decode_b64url_canonical` refuse remplissage, alphabet non URL, longueur décodée différente, et tout texte qui ne se réencode pas à l'identique.

- [ ] **Step 1: Tests qui échouent**

```rust
// RFC 8032 §7.1 TEST 1 et TEST 2 — à recouper avec le texte de la RFC avant le commit
const T1: (&str, &str, &str) = ("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
    "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
    "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b");
const T2: (&str, &str, &str) = ("4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
    "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
    "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00");
#[test] fn rfc8032_known_answers() {
    for ((seed, public, signature), message) in [(T1, &b""[..]), (T2, &[0x72u8][..])] {
        assert_eq!(hex(&sign(&seed32(seed), message)), signature);
        assert!(verify_strict_message(&arr32(public), message, &arr64(signature)));
    }
}
#[test] fn identity_and_torsion_points_are_not_admissible() {
    use curve25519_dalek::constants::{ED25519_BASEPOINT_POINT as B, EIGHT_TORSION};
    let mut identity = [0u8; 32]; identity[0] = 1;
    assert!(admissible(&B.compress().to_bytes()) && !admissible(&identity));
    for (i, t) in EIGHT_TORSION.iter().enumerate() {
        assert!(!admissible(&t.compress().to_bytes()), "torsion {i}");
        if i != 0 { assert!(!admissible(&(B + t).compress().to_bytes()), "mixed {i}"); }
    }
    assert!(!admissible(&arr32("edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f")));   // y = p
}
#[test] fn non_canonical_s_is_detected() {
    let mut sig = arr64(T1.2);
    assert!(s_canonical(&sig));
    add_group_order_to_s(&mut sig);   // S + L, L = 2^252 + 27742317777372353535851937790883648493
    assert!(!s_canonical(&sig));
}
#[test] fn base64url_is_canonical_and_unpadded() {
    assert_eq!(decode_b64url_canonical(&encode_b64url(&[0xff; 32]), 32).unwrap(), vec![0xff; 32]);
    for bad in ["AA==", "AA", "+/8", ""] { assert!(decode_b64url_canonical(bad, 32).is_err(), "{bad}"); }
    let mut tweaked = encode_b64url(&[0u8; 32]); tweaked.pop(); tweaked.push('B');   // bits de bourrage non nuls
    assert!(decode_b64url_canonical(&tweaked, 32).is_err());
}
```

Avant le commit, `bun run check:secret-scan` : si les graines RFC 8032 sont signalées, ne pas contourner — garder la seule vérification RFC (clé publique, signature) et remplacer la signature connue par les `signCases` du corpus L1 (Task 9), puis le signaler dans la PR.

- [ ] **Step 2: Implémenter.** `sign` : `SigningKey::from_bytes` (effacée à la destruction, feature `zeroize`). Run `cargo test --locked -p policy-receipt` vert.
- [ ] **Step 3: Neutralisation** : `is_torsion_free()` → `true` : les points d'ordre mixte rougissent ; `!is_identity()` → `true` : l'identité rougit ; `s_canonical` → `true` : rouge. Restaurer.
- [ ] **Step 4: Commit** — gate de branche ; `git commit -s -m "feat(policy-receipt): strict Ed25519 primitives with canonical prime-subgroup points"`.

---

### Task 9: Reçus et corpus de signature L1

**Files:**
- Create: `crates/policy-receipt/src/receipt.rs`, `crates/policy-receipt/tests/signatures.rs`
- Modify: `crates/policy-receipt/src/lib.rs`

**Interfaces:**
- Consumes: Tasks 3 et 8 ; `vendored_file` (Task 7) ; `signature-vectors.v1.json`, `vectors.json` du reçu
- Produces:
  ```rust
  pub fn sign_receipt(unsigned: &[u8], secret_key: &[u8]) -> Result<Vec<u8>, ContractError>;   // JCS(SignedReceipt)
  pub fn verify_receipt(signed: &[u8], public_keys: &[u8]) -> Result<Vec<u8>, ContractError>;  // JCS(ReceiptVerification)
  pub(crate) fn receipt_failures(value: &serde_json::Value, signed: bool) -> bool;   // miroir de rawProjectionReceiptFailures
  pub(crate) fn load_key_set(bytes: &[u8]) -> Result<PublicKeySet, ErrorCode>;      // KeysInvalid
  pub(crate) fn signing_message(unsigned: &serde_json::Value) -> Result<Vec<u8>, ErrorCode>;
  ```

Valeurs fixées : domaine `libre-ai.signalement-projection-receipt.v1` ; message = domaine ‖ `0x00` ‖ `sha256_raw(to_jcs(unsigned))` ; `signature = { algorithm: "ed25519", value: encode_b64url(sig) }`. `receipt_failures` reproduit les refus de `rawProjectionReceiptFailures` : 65 536 octets, JSON strict, document JCS exact (signé seulement), schéma (struct `deny_unknown_fields` miroir du schéma vendorisé, `revision` et motif de `rendered.rendererVersion` compris, horodatages de l'export v1, aucun nombre JSON), `duplicate_path`, `file_overlap`, `media_link_untransmitted`, `timestamp_order` (`deliveredAt ≤ issuedAt`).

`sign_receipt` : graine ≠ 32 octets → `key.invalid` ; `unsigned` refusé par `receipt_failures(…, false)` ou portant un membre `signature` → `receipt.invalid` ; `keyId` lu dans `unsigned.keyId` ; sortie `to_jcs(unsigned + signature)`. `verify_receipt` suit l'ordre normatif de l'index (« Vérification ») ; sortie `{ signature, keyId, keyStatus, receipt }`, `receipt` = document signé vérifié si `valid`, sinon `null` ; `unreadable` → `keyId: null`, `keyStatus: null`.

- [ ] **Step 1: Tests unitaires qui échouent**

```rust
#[test] fn sign_then_verify_roundtrip() {
    let signed = sign_receipt(UNSIGNED_K1.as_bytes(), &seed_n(1)).unwrap();
    assert_eq!(signed, canonicalize(&signed).unwrap());
    let v = json(&verify_receipt(&signed, &keyset(&[k(1, "active", "2026-01-01T00:00:00Z", None)])).unwrap());
    assert_eq!((v["signature"].as_str(), v["keyId"].as_str(), v["keyStatus"].as_str()), (Some("valid"), Some("k-1"), Some("active")));
    assert_eq!(v["receipt"], json(&signed));
}
#[test] fn wrong_key_for_key_id_is_invalid() {
    let signed = sign_receipt(UNSIGNED_K1.as_bytes(), &seed_n(1)).unwrap();
    let v = json(&verify_receipt(&signed, &keyset(&[k_with_public_of(1, 2, "active")])).unwrap());
    assert_eq!(v, json!({"signature":"invalid","keyId":"k-1","keyStatus":"active","receipt":null}));
}
#[test] fn key_window_is_half_open() {
    // UNSIGNED_K1.issuedAt = 2026-10-24T10:00:00Z
    for (not_before, not_after, expected) in [
        ("2026-10-24T10:00:00Z", Some("2026-10-24T10:00:01Z"), "valid"),
        ("2026-10-24T10:00:01Z", None, "invalid"),
        ("2026-01-01T00:00:00Z", Some("2026-10-24T10:00:00Z"), "invalid"),
    ] {
        let signed = sign_receipt(UNSIGNED_K1.as_bytes(), &seed_n(1)).unwrap();
        let ks = keyset(&[k(1, if not_after.is_some() { "retired" } else { "active" }, not_before, not_after)]);
        assert_eq!(json(&verify_receipt(&signed, &ks).unwrap())["signature"], expected, "{not_before} {not_after:?}");
    }
}
#[test] fn organization_mismatch_is_invalid() {
    // UNSIGNED_K1.organization = "org-a" ; jeu de clés de "org-b" portant la bonne clé k-1
    let signed = sign_receipt(UNSIGNED_K1.as_bytes(), &seed_n(1)).unwrap();
    let ks = keyset_of("org-b", &[k(1, "active", "2026-01-01T00:00:00Z", None)]);
    assert_eq!(json(&verify_receipt(&signed, &ks).unwrap()),
               json!({"signature":"invalid","keyId":"k-1","keyStatus":null,"receipt":null}));   // contrôle avant la recherche de clé
    let unknown_elsewhere = keyset_of("org-b", &[k(2, "active", "2026-01-01T00:00:00Z", None)]);
    assert_eq!(json(&verify_receipt(&signed, &unknown_elsewhere).unwrap())["signature"], "invalid");   // jamais unknown-key
}
#[test] fn unknown_key_and_unreadable_have_null_status() {
    let signed = sign_receipt(UNSIGNED_K1.as_bytes(), &seed_n(1)).unwrap();
    assert_eq!(json(&verify_receipt(&signed, &keyset(&[k(2, "active", "2026-01-01T00:00:00Z", None)])).unwrap()),
               json!({"signature":"unknown-key","keyId":"k-1","keyStatus":null,"receipt":null}));
    let spaced = String::from_utf8(signed).unwrap().replacen(',', ", ", 1);
    assert_eq!(json(&verify_receipt(spaced.as_bytes(), &keyset(&[k(1, "active", "2026-01-01T00:00:00Z", None)])).unwrap()),
               json!({"signature":"unreadable","keyId":null,"keyStatus":null,"receipt":null}));
}
#[test] fn duplicate_member_in_signed_receipt_is_unreadable() { /* `remote` répété → unreadable, jamais valid */ }
#[test] fn duplicate_key_id_is_keys_invalid() {
    let ks = keyset(&[k(1, "active", "2026-01-01T00:00:00Z", None), k(1, "retired", "2025-01-01T00:00:00Z", Some("2026-01-01T00:00:00Z"))]);
    assert_eq!(verify_receipt(SIGNED_ANY, &ks).unwrap_err().code, ErrorCode::KeysInvalid);
}
#[test] fn sign_refuses_short_seed_and_signature_member() {
    for len in [0usize, 31, 33] { assert_eq!(sign_receipt(UNSIGNED_K1.as_bytes(), &vec![7; len]).unwrap_err().code, ErrorCode::KeyInvalid); }
    assert_eq!(sign_receipt(SIGNED_ANY, &seed_n(1)).unwrap_err().code, ErrorCode::ReceiptInvalid);
}
#[test] fn any_single_byte_flip_never_verifies() {
    let signed = sign_receipt(UNSIGNED_K1.as_bytes(), &seed_n(1)).unwrap();
    let ks = keyset(&[k(1, "active", "2026-01-01T00:00:00Z", None)]);
    let mut examined = 0;
    for i in 0..signed.len() {
        let mut m = signed.clone(); m[i] ^= 0x01; examined += 1;
        if let Ok(out) = verify_receipt(&m, &ks) { assert_ne!(json(&out)["signature"], "valid", "byte {i}"); }
    }
    println!("byte flips examined: {examined}"); assert_eq!(examined, signed.len());
}
```

`seed_n(n)` = SHA-256(UTF-8 `libre-ai.signalement-receipt-test-key.<n>`), la dérivation du corpus L1 ; `UNSIGNED_K1` part de la fixture `valid[0]` du reçu (`vectors.json`), privée de `signature`, `keyId` `"k-1"`.

- [ ] **Step 2: Test du corpus L1** (`tests/signatures.rs`)

```rust
#[test] fn l1_signature_corpus() {
    let corpus = read_json(vendored_file("signalement-projection-receipt-v1", "signature-vectors.v1.json"));
    assert_eq!(corpus["domain"], "libre-ai.signalement-projection-receipt.v1");
    let (mut vectors, mut signs) = (0, 0);
    for v in corpus["vectors"].as_array().unwrap() {
        let got = verify_receipt(&b64u(&v["signed"]), &bytes(&v["keySet"]));
        match (v["expected"].get("refused"), got) {
            (Some(_), Err(e)) => assert_eq!(e.code, ErrorCode::KeysInvalid, "{}", v["id"]),
            (None, Ok(out)) => {
                let out = json(&out);
                assert_eq!(out["signature"], v["expected"]["signature"], "{}", v["id"]);
                assert_eq!(out["keyStatus"], v["expected"]["keyStatus"], "{}", v["id"]);
            }
            (want, got) => panic!("{}: expected {want:?}, got {got:?}", v["id"]),
        }
        vectors += 1;
    }
    for c in corpus["signCases"].as_array().unwrap() {
        assert_eq!(sign_receipt(&bytes(&c["unsigned"]), &b64u(&c["seed"])).unwrap(), b64u(&c["signed"]), "{}", c["id"]);
        signs += 1;
    }
    println!("L1 signature corpus: {vectors} vectors, {signs} sign cases");
    assert_eq!(vectors, EXPECTED_VECTORS);
    assert_eq!(signs, EXPECTED_SIGN_CASES);
}
```

`EXPECTED_VECTORS` et `EXPECTED_SIGN_CASES` sont écrits à l'exécution d'après `jq '.vectors | length, (.signCases | length)'` sur le fichier vendorisé (32 vecteurs selon la table L1), et réécrits à chaque re-vendorisation : un vecteur ajouté ou retiré sans mise à jour fait rougir le test. Le champ `reason` est propre à l'autorité, non comparé.

- [ ] **Step 3: Implémenter. Run** `cargo test --locked -p policy-receipt -- --nocapture` → vert, `byte flips examined: <longueur>`, `L1 signature corpus: <EXPECTED_VECTORS> vectors, <EXPECTED_SIGN_CASES> sign cases`.
- [ ] **Step 4: Neutralisation** : (a) contrôle JCS du document signé → `Ok(())` : `document-whitespace` et `document-key-order` rougissent ; (b) borne `notAfter` incluse (`>` au lieu de `>=`) : `key_window_is_half_open` et `key-outside-validity` rougissent ; (c) message sans le `0x00` : les `signCases` rougissent ; (d) contrôle d'organisation → `Ok(())` : `organization_mismatch_is_invalid` et le vecteur L1 `keyset-other-organization` rougissent ; (e) contrôle déplacé après la recherche de clé : `keyStatus` devient non nul et le second cas du test rend `unknown-key`, rouge. Restaurer.
- [ ] **Step 5: Commit** — gate de branche ; `git commit -s -m "feat(policy-receipt): sign and strictly verify projection receipts against the L1 corpus"`.

---

### Task 10: Vecteurs de référence natifs (quatre opérations)

**Files:**
- Create: `crates/policy-receipt/tests/golden.rs`

**Interfaces:**
- Consumes: `golden-vectors.v1.json` (`vendored_file`) ; les quatre fonctions publiques

- [ ] **Step 1: Test**

```rust
#[test] fn golden_vectors_byte_exact() {
    let doc = read_json(vendored_file("signalement-policy-receipt-v1", "golden-vectors.v1.json"));
    assert_eq!(doc["schemaVersion"], "libre-ai.signalement-policy-receipt-golden-vectors.v1");
    let (mut counts, mut failed) = (BTreeMap::<String, usize>::new(), Vec::<String>::new());
    for c in doc["cases"].as_array().unwrap() {
        let a = &c["args"];
        let got = match c["operation"].as_str().unwrap() {
            "evaluate" => evaluate(&bytes(&a["policy"]), &bytes(&a["input"])),
            "canonicalize" => canonicalize(&a.get("jsonBytes").map(b64u).unwrap_or_else(|| bytes(&a["json"]))),
            "sign-receipt" => sign_receipt(&bytes(&a["unsigned"]), &b64u(&a["secretKey"])),
            "verify-receipt" => verify_receipt(&b64u(&a["signed"]), &bytes(&a["publicKeys"])),
            other => panic!("unknown operation {other}"),
        };
        let ok = match (&c["expected"].get("ok"), got) {
            (Some(want), Ok(out)) => out == canonicalize(&bytes(want)).unwrap(),
            (None, Err(e)) => c["expected"]["error"]["code"] == e.code.as_str(),
            _ => false,
        };
        if !ok { failed.push(c["id"].as_str().unwrap().to_owned()); }
        *counts.entry(c["operation"].as_str().unwrap().to_owned()).or_default() += 1;
    }
    println!("golden vectors: {counts:?}; failed: {failed:?}");
    for op in ["evaluate", "canonicalize", "sign-receipt", "verify-receipt"] { assert!(counts.get(op).copied().unwrap_or(0) > 0, "{op}"); }
    assert!(failed.is_empty(), "failed cases: {failed:?}");
}
```

`bytes(v)` = octets de `serde_json::to_vec(v)` ; `canonicalize` admet ces octets parce que les arguments JSON du document ne portent que des entiers sûrs.

- [ ] **Step 2: Exécuter** `cargo test --locked -p policy-receipt --test golden -- --nocapture`. Attendu : chaque opération > 0, `failed: []`, `denied-dominates` et `override-most-restrictive` compris (union, Review Focus 1). Un cas en échec : corriger le code si le vecteur suit la `SEMANTICS.md`, sinon le signaler à L1 (L1 Task 13 attend L2 vert).
- [ ] **Step 3: Neutralisation** : `deniedCount` forcé à `0` → au moins `denied-dominates` et `exact-origin` rougissent ; sinon les vecteurs ne discriminent pas ce champ, le signaler à L1. Restaurer.
- [ ] **Step 4: Commit** — gate de branche ; `git commit -s -m "test(policy-receipt): replay the L1 golden vectors natively for all four operations"`.

---

### Task 11: Composant WIT, contrôle des imports, construction reproductible

**Files:**
- Create: `crates/policy-receipt/src/component.rs`, `crates/policy-receipt/examples/check_wasm_imports.rs`, `tools/build/machine-paths.ts`, `tools/build/machine-paths.test.ts`, `tools/build/policy-receipt-wasm.ts`, `tools/build/policy-receipt-reproducible.ts`
- Modify: `crates/policy-receipt/src/lib.rs` (`#[cfg(target_arch = "wasm32")] #[allow(unsafe_code)] mod component;`), `package.json:19-26` (devDependency), `package.json:27-48` (scripts, `check:tree`), `bun.lock`

**Interfaces:**
- Produces: `target/policy-receipt-wasm/{component.wasm,manifest.json}`, `target/policy-receipt-wasm/generated/{policy-receipt.js,policy-receipt.core.wasm,*.d.ts}` ; manifeste `schemaVersion: "libre-ai.signalement-policy-receipt-wasm-build.v1"` avec `component`, `coreModule`, `generated`, `pathRemap`, `transpiler` ; scripts `build:policy-receipt`, `check:policy-receipt`, `check:policy-receipt:reproducible`

- [ ] **Step 1: `component.rs`** sur le modèle de `ai-model-policy/crates/policy-core/src/component.rs` :

```rust
wit_bindgen::generate!({ world: "signalement-policy-receipt", path: "../../vendor/contracts/contracts/wit/signalement-policy-receipt-v1" });
```

`Guest` délègue aux quatre fonctions et projette `ContractError` sur `{ code: as_str(), message: message() }`. `sign_receipt(unsigned, mut secret_key)` appelle `crate::sign_receipt` puis `secret_key.zeroize()` avant de rendre.

- [ ] **Step 2: `examples/check_wasm_imports.rs`** : copie de `ai-model-policy/crates/policy-core/examples/check_wasm_imports.rs` (`gh api … --jq .content | base64 -d`), `EXPECTED_EXPORT = "libre-ai:signalement-policy-receipt/api@1.0.0"`, messages renommés ; contrôles inchangés.
- [ ] **Step 3: Chemins machine** : copier `ai-model-policy/tools/quality/machine-paths.ts` et `.test.ts` vers `tools/build/` par `gh api`, sans modification (duplication voulue par l'en-tête du précédent) ; `bun test tools/build/machine-paths.test.ts` vert ; après `git add`, `bun run check:public-boundary` et `bun run check:personal-data` verts (les aiguilles du fichier sont des préfixes génériques de répertoire personnel, sans nom d'utilisateur).
- [ ] **Step 4: Dépendance** : `bun add -d --exact @bytecodealliance/jco-transpile@0.4.2` ; relever nom, version et licence de chaque paquet de la Tech Stack par `jq -r '"\(.name) \(.version) \(.license)"'` sur son `package.json` sous `node_modules/.bun` ; AGPL/SSPL ou licence absente → BLOCKED.
- [ ] **Step 5: `tools/build/policy-receipt-wasm.ts`** : reprise de `ai-model-policy/tools/quality/build-policy-core-wasm.ts`. Valeurs : même refus des variables de contrôle de construction ; `cargo build --locked -p policy-receipt --release --target wasm32-unknown-unknown --config <remapConfigArgument(…)>` ; `componentWit` contient `export libre-ai:signalement-policy-receipt/api@1.0.0;` et aucun `import ` ; `transpileBytes(component, { emitTypescriptDeclarations: true, instantiation: "async", name: "policy-receipt", nodejsCompat: false, strict: true, wasiShim: false })`, `imports.length === 0`, exports exactement `{"api:instance", "libre-ai:signalement-policy-receipt/api@1.0.0:instance"}` ; écriture par `safeOutputPath` plus `component.wasm` ; `WebAssembly.Module.imports(core).length === 0` ; `assertNoMachinePaths` sur le module cargo, le composant et chaque fichier généré ; manifeste trié, `transpiler` lu dans `package.json`. Écart au précédent : exécuté sous **Bun** (la CI de ce dépôt n'installe pas Node ; le précédent signale sous Bun un avertissement `tcp_wrap` non fatal, **à vérifier**). Si `transpileBytes` échoue sous Bun : Node de `toolchains/notebook-qualification.json` de la gouvernance épinglée (archive et digest vérifiés), signalé dans la PR.
- [ ] **Step 6: `tools/build/policy-receipt-reproducible.ts`** : deux fois `cargo clean --release --target wasm32-unknown-unknown -p policy-receipt` puis construction, copie de `manifest.json` sous `mktemp -d` ; compare octet pour octet, imprime les deux sha256 du composant, sort en non nul sur toute différence.
- [ ] **Step 7: Scripts**

```json
"build:policy-receipt": "bun run check:bun:runtime && bun tools/build/policy-receipt-wasm.ts",
"check:policy-receipt": "bun run check:bun:runtime && cargo run --locked -p policy-receipt --example check_wasm_imports -- target/wasm32-unknown-unknown/release/policy_receipt.wasm target/policy-receipt-wasm/component.wasm",
"check:policy-receipt:reproducible": "bun run check:bun:runtime && bun tools/build/policy-receipt-reproducible.ts"
```

`check:tree` : après `bun run check:rust`, insérer `bun run build:policy-receipt && bun run check:policy-receipt`.

- [ ] **Step 8: Exécuter**

```bash
bun run build:policy-receipt                # "machine-path scan: … 0 needle hit(s)" puis "policy-receipt WASM built: component=<sha> core=<sha>"
bun run check:policy-receipt                # "0 module imports, 0 component imports, exactly `libre-ai:signalement-policy-receipt/api@1.0.0` exported"
bun run check:policy-receipt:reproducible   # deux sha identiques, sortie 0
git check-ignore -q target/policy-receipt-wasm/component.wasm && git status --porcelain target   # aucune sortie de status
```

- [ ] **Step 9: Neutralisation** : (a) import d'hôte temporaire dans `component.rs` (`#[link(wasm_import_module = "env")] unsafe extern "C" { fn host_probe() -> u32; }`, appelé dans `canonicalize`) → la construction échoue sur la surface WIT ou « transpiled core module has imports », `check_wasm_imports` sur « forbidden WebAssembly imports » ; (b) liste de remappage vide → `assertNoMachinePaths` échoue sur une machine dont `CARGO_HOME` est sous le répertoire personnel. Restaurer, reconstruire.
- [ ] **Step 10: Commit** — `git add crates/policy-receipt tools/build package.json bun.lock` ; gate de branche ; `git commit -s -m "build(policy-receipt): capability-free reproducible WASM component with jco glue"`.

---

### Task 12: Paquet `packages/policy-receipt-wasm`

**Files:**
- Create: `packages/policy-receipt-wasm/{types.ts,component.ts,index.ts,index.test.ts,test-fixtures.ts,compile-probe.ts,compile.test.ts,README.md}`

**Interfaces:**
- Consumes: `target/policy-receipt-wasm/generated/policy-receipt.js` (glue) et `policy-receipt.core.wasm`, embarqués par import statique (registre §4.2 : le chargeur fonctionne dans un exécutable `bun build --compile`, la CLI L7 en dépend)
- Produces (registre §4.2, noms exacts) :

```ts
export type Role = "document" | "screenshot" | "video";
export type WithholdReason = "default-withhold" | "public-destination" | "residency"
  | "attachment-unsupported" | "visibility-unknown" | "user-withheld";
export interface DiscoveredAttributes { visibility: "public" | "internal" | "private" | "unknown"; attachmentUpload: boolean; }
export interface EvaluationInput { observedOrigin: string | null; files: { path: string; role: Role; sha256: string }[]; discovered: Record<string, DiscoveredAttributes>; }
export interface VerdictDestination { destinationId: string; profileId: string; routing: "imposed" | "optional" | "selectable";
  files: { path: string; decision: "transmit" | "withhold"; reason: WithholdReason | null }[]; media: "link" | "withhold"; }
export interface PolicyVerdict { policyVersion: string; policyDigest: string; matchedRuleIds: string[];
  destinations: VerdictDestination[]; override: "allowed" | "denied"; deniedCount: number; }
export interface RoutingPolicy { /* recopie du schéma signalement-routing-policy-v1 */ }
export interface UnsignedReceipt { /* recopie du schéma signalement-projection-receipt-v1 sans signature, dont keyId et rendered */ }
export interface SignedReceipt extends UnsignedReceipt { signature: { algorithm: "ed25519"; value: string }; }
export type ProjectionReceipt = SignedReceipt;   // contenu d'un SignedReceipt dont la signature a été vérifiée
export interface PublicKeySet { organization: string; keys: { keyId: string; algorithm: "ed25519"; publicKey: string;
  status: "active" | "retired"; notBefore: string; notAfter: string | null }[]; }
export interface ReceiptVerification { signature: "valid" | "invalid" | "unknown-key" | "unreadable";
  keyId: string | null; keyStatus: "active" | "retired" | null; receipt: ProjectionReceipt | null; }
export interface PolicyReceiptApi {
  evaluate(policy: RoutingPolicy, input: EvaluationInput): PolicyVerdict;
  canonicalize(value: unknown): Uint8Array;
  signReceipt(unsigned: UnsignedReceipt, secretKey: Uint8Array): SignedReceipt;
  verifyReceipt(signed: Uint8Array, publicKeys: PublicKeySet): ReceiptVerification;
}
export class PolicyReceiptError extends Error { readonly code: string; }
export function loadPolicyReceipt(): Promise<PolicyReceiptApi>;
// component.ts, non réexporté :
export interface RawPolicyReceipt { evaluate(p: Uint8Array, i: Uint8Array): Uint8Array; canonicalize(j: Uint8Array): Uint8Array;
  signReceipt(u: Uint8Array, k: Uint8Array): Uint8Array; verifyReceipt(s: Uint8Array, k: Uint8Array): Uint8Array; }
export function instantiateRaw(): Promise<RawPolicyReceipt>;
export function wrapRaw(raw: RawPolicyReceipt): PolicyReceiptApi;
export const EMBEDDED_CORE_PATH: string;   // chemin rendu par l'import de fichier (diagnostic du binaire de contrôle)
```

Règles : `index.ts` est le seul point d'entrée des consommateurs (L3 importe `../policy-receipt-wasm/index.ts`) et réexporte tous les types plus `loadPolicyReceipt`, `PolicyReceiptError`. `component.ts` embarque par import statique, jamais par `import()` d'un chemin calculé :

```ts
import corePath from "../../target/policy-receipt-wasm/generated/policy-receipt.core.wasm" with { type: "file" };
import { instantiate } from "../../target/policy-receipt-wasm/generated/policy-receipt.js";
```

`instantiateRaw` reprend `createPolicyCoreEvaluator` (`ai-model-policy/apps/model-policy/src/evaluation/policy-core-evaluator.ts`) : `instantiate(getCoreModule, {}, instantiateCore)`, où `getCoreModule` compile `await Bun.file(corePath).bytes()` et refuse tout module dont `WebAssembly.Module.imports(…).length !== 0`. Le type de l'import `*.wasm` vient de `@types/bun` s'il le déclare, sinon d'un `packages/policy-receipt-wasm/wasm-file.d.ts` (`declare module "*.wasm" { const path: string; export default path; }`). Conséquence de l'import statique : sans `bun run build:policy-receipt`, `tsc` et `bun test` échouent sur « Cannot find module » (échec nommé, jamais un saut) ; `check:tree` construit avant `typecheck` et `test` (Task 11 Step 7). Exception jco avec `payload` → `PolicyReceiptError(payload.code, payload.message)` ; autre exception (trap) relancée. `wrapRaw` : `TextEncoder` + `JSON.stringify` à l'entrée, `TextDecoder("utf-8", { fatal: true })` + `JSON.parse` à la sortie ; `JSON.stringify(value) === undefined` → `PolicyReceiptError("canonicalize.raw_json")` sans appel au WASM.

- [ ] **Step 1: Tests qui échouent**

```ts
test("canonicalize sorts keys inside the component", async () => {
  const api = await loadPolicyReceipt();
  expect(new TextDecoder().decode(api.canonicalize({ b: [2, 1], a: "€" }))).toBe('{"a":"€","b":[2,1]}');
});
test("contract errors carry the WIT code", async () => {
  const api = await loadPolicyReceipt();
  expect(() => api.canonicalize({ n: 1.5 })).toThrow(expect.objectContaining({ code: "canonicalize.number" }));
  expect(() => api.canonicalize({ n: 2 ** 53 })).toThrow(expect.objectContaining({ code: "canonicalize.number" }));
  expect(() => api.canonicalize(undefined)).toThrow(PolicyReceiptError);
});
test("evaluate returns a typed verdict with no implicit destination", async () => {
  const api = await loadPolicyReceipt();
  expect(api.evaluate(POLICY_A, { observedOrigin: "https://unknown.test", files: FILES, discovered: {} })).toEqual({
    policyVersion: "1", policyDigest: expect.stringMatching(/^[0-9a-f]{64}$/), matchedRuleIds: [], destinations: [],
    override: "denied", deniedCount: 0 });
});
test("verifyReceipt returns the receipt only when valid", async () => { /* reçu altéré d'un octet → receipt null */ });
```

`test-fixtures.ts` (nom choisi pour ne pas être ramassé par `bun test`) porte `POLICY_A`, `FILES` (Task 6) et `UNSIGNED_K1`, `SEED_1` (Task 9).

Binaire de contrôle : `compile-probe.ts` importe `loadPolicyReceipt` et `EMBEDDED_CORE_PATH`, puis écrit sur stdout `JSON.stringify({ core: EMBEDDED_CORE_PATH, canonical: new TextDecoder().decode(api.canonicalize({ b: 1, a: 2 })) })`. `compile.test.ts` :

```ts
test("the loader works inside a bun build --compile executable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "policy-receipt-probe-"));
  try {
    const outfile = join(dir, "probe");
    const build = Bun.spawnSync(["bun", "build", "--compile", "packages/policy-receipt-wasm/compile-probe.ts", "--outfile", outfile]);
    expect(build.exitCode).toBe(0);
    const run = Bun.spawnSync([outfile], { cwd: dir, env: {} });   // cwd hors dépôt, environnement vide
    expect(run.exitCode).toBe(0);
    const out = JSON.parse(new TextDecoder().decode(run.stdout));
    expect(out.canonical).toBe('{"a":2,"b":1}');
    expect(out.core.startsWith("/$bunfs/")).toBe(true);   // préfixe du système de fichiers embarqué de Bun : à vérifier sur la version épinglée
  } finally { await rm(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Exécuter** `bun run build:policy-receipt && bun test packages/policy-receipt-wasm` → rouge. **Step 3: Implémenter.** Run vert, puis `bun run typecheck && bun run lint`. Si la glue jco ne s'embarque pas (le binaire échoue ou le chemin du module n'est pas embarqué), ne pas repasser à `import()` : rapporter l'écart dans la PR et à la coordination, avec la sortie exacte de `bun build --compile` et du binaire, et la révision Bun (`bun --revision`). Mesure non faite à la rédaction du plan.
- [ ] **Step 4: Neutralisation** : (a) projection du `payload` supprimée → « contract errors » rouge ; (b) dans `component.ts`, remplacer l'import de fichier par un chemin calculé (`join(import.meta.dir, "../../target/…core.wasm")`) → le test du binaire rougit (préfixe `/$bunfs/` absent, ou échec de lecture si le dépôt est déplacé). Le refus d'imports de l'hôte remplacé par `< 0` ne fait rougir aucun test ici : sa discrimination est Task 11 Step 9(a), le noter dans le commit. Restaurer.
- [ ] **Step 5: README** : rôle, frontière (aucune capacité ni réseau), construction préalable, un exemple par fonction, rappel que la clé secrète ne quitte pas le control plane et que la CLI ne signe rien.
- [ ] **Step 6: Commit** — gate de branche ; `git commit -s -m "feat(policy-receipt-wasm): typed Bun loader for the capability-free component"`.

---

### Task 13: Conformité TS ↔ WASM

**Files:**
- Create: `packages/policy-receipt-wasm/conformance.test.ts`

**Interfaces:**
- Consumes: `instantiateRaw` (Task 12), `VENDOR_ROOT`, `vendoredContractEntry` (Task 1), schéma du reçu, `ajv`

- [ ] **Step 1: Test**

```ts
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { VENDOR_ROOT as root, vendoredContractEntry } from "../../tools/contracts/policy-receipt-vendor.ts";
import { instantiateRaw } from "./component.ts";

const raw = await instantiateRaw();
test("golden vectors through WASM, byte-exact", async () => {
  const doc = await Bun.file(new URL("contracts/fixtures/signalement-policy-receipt-v1/golden-vectors.v1.json", root)).json();
  const counts: Record<string, number> = {}; const failed: string[] = [];
  for (const c of doc.cases) {
    try {
      const out = dispatch(raw, c);   // même lecture des args que Task 10
      if (!("ok" in c.expected) || !bytesEqual(out, raw.canonicalize(encode(c.expected.ok)))) failed.push(c.id);
    } catch (e) { if (!("error" in c.expected) || codeOf(e) !== c.expected.error.code) failed.push(c.id); }
    counts[c.operation] = (counts[c.operation] ?? 0) + 1;
  }
  console.log(`TS ↔ WASM golden vectors: ${JSON.stringify(counts)}; failed: ${JSON.stringify(failed)}`);
  for (const op of ["evaluate", "canonicalize", "sign-receipt", "verify-receipt"]) expect(counts[op] ?? 0).toBeGreaterThan(0);
  expect(failed).toEqual([]);
});
test("L1 signature corpus through WASM", async () => { /* parcours de Task 9 Step 2 ; 30 vecteurs ; signCases octet pour octet */ });
test("signed receipts validate against the vendored schema", async () => {
  const schema = await Bun.file(new URL(vendoredContractEntry("signalement-projection-receipt-v1").path, root)).json();
  const validate = addFormats(new Ajv2020({ strict: true, allErrors: true })).compile(schema);
  expect(validate(JSON.parse(new TextDecoder().decode(raw.signReceipt(encode(UNSIGNED_K1), SEED_1))))).toBe(true);
});
```

`Ajv2020` ou `Ajv` selon le `$schema` vendorisé (même choix que `tools/contracts/generate-validator.ts`).

- [ ] **Step 2: Exécuter** `bun run build:policy-receipt && bun test packages/policy-receipt-wasm/conformance.test.ts`. Attendu : compteurs identiques à Task 10, `failed: []`.
- [ ] **Step 3: Neutralisation** : `wrapRaw`/`dispatch` passe `input` à la place de `policy` → rouge. Restaurer.
- [ ] **Step 4: Commit** — gate de branche ; `git commit -s -m "test(policy-receipt-wasm): TS to WASM conformance on the L1 golden vectors and signature corpus"`.

---

### Task 14: CI, licences, documentation

**Files:**
- Modify: `.github/workflows/ci.yml:43` ; Create: `crates/policy-receipt/README.md` ; Modify si `reuse lint` l'exige : `REUSE.toml`

- [ ] **Step 1:** après `- run: bun run check:tree`, ajouter l'étape `Verify the policy-receipt WASM build is reproducible` (`run: bun run check:policy-receipt:reproducible`).
- [ ] **Step 2:** `uvx --from 'reuse==6.2.0' reuse lint` après `git add` → conforme. Les fichiers neufs relèvent de `path = ["**"]` (EUPL-1.2) ; `packages/policy-receipt-wasm` n'est pas Apache-2.0 (seul `packages/connector-sdk/**`, `REUSE.toml:19-22`).
- [ ] **Step 3:** `crates/policy-receipt/README.md` : rôle (design §5.1), fonctions et codes, grammaire d'origine et de motif, `select_rules` (union par défaut, alternative « la plus spécifique » en attente du propriétaire), profil Ed25519 strict, bornes, commandes, ce qu'un reçu prouve et ne prouve pas (design §5.5).
- [ ] **Step 4: Commit** — gate de branche ; `git commit -s -m "ci(policy-receipt): check reproducibility in CI and document the crate"`.

---

### Task 15: Verrou L1, ré-épinglage, critère de sortie

**Interfaces:** consomme `main` portant le `pin.json` ré-épinglé des six contrats `locked` (L1 Task 14).

- [ ] **Step 1: Préalables** : si le propriétaire a retenu « la plus spécifique » (Review Focus 1), `select_rules`, sa table et les vecteurs L1 sont changés et re-vendorisés ; Task 10 et Task 13 vertes ; preuve transmise à L1 (L1 Task 13 attend L2 vert).
- [ ] **Step 2: Verrou à la source et sur `main`**

```bash
gh api repos/libre-ai/schemas-and-contracts/contents/contracts/catalog.v1.json -H "Accept: application/vnd.github.raw" \
  | jq -r '.contracts[] | select(.id|startswith("signalement-")) | "\(.id) \(.status) \(has("review"))"'
git fetch origin && git show origin/main:vendor/contracts/contracts/catalog.v1.json \
  | jq -r '.contracts[] | select(.id|startswith("signalement-")) | "\(.id) \(.status)"'
```

Attendu : six contrats `locked`, `has("review") = false`, aux deux endroits ; sinon arrêt, la PR reste en brouillon.

- [ ] **Step 3: Intégrer** `git merge --signoff --no-edit origin/main` (ni rebase ni push forcé ; un conflit sous `vendor/contracts/**` se résout en prenant `main`).
- [ ] **Step 4: Critère de sortie (feuille de route §2, ligne L2)**

```bash
bun run check:contracts                         # 6 contracts (6 locked), pin sur la ligne servie
cargo test --locked --workspace -- --nocapture  # tables, propriétés (> 2500), corpus (égalité jq), golden (4 opérations, failed: [])
bun run check:policy-receipt:reproducible       # deux sha identiques
bun run check:policy-receipt                    # 0 import, export exact
bun test packages/policy-receipt-wasm           # conformité TS ↔ WASM, mêmes compteurs
bun run check                                   # gate complet, vert
```

Chaque sortie est rapportée telle quelle dans la PR, en quatre états : pass, fail, unavailable, blocked.

- [ ] **Step 5: PR** : brief durable (avant, après), dépendances nouvelles avec version et licence, réponse écrite de chaque neutralisation (quelle erreur fait rougir le test ; un refactor équivalent le ferait-il rougir), écarts au contrat L1 constatés, statut du scan de secrets. Sortie du brouillon une fois Step 4 vert ; squash avec DCO.
- [ ] **Step 6: Nettoyage** : `git worktree remove "$WT"` depuis le clone principal, y compris en cas d'abandon.
