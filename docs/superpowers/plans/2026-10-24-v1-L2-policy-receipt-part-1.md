# L2 policy-receipt — partie 1 : branche, chaîne Rust, moteur d'évaluation

> Index, Global Constraints, contrat consommé et Review Focus : `2026-10-24-v1-L2-policy-receipt.md`. « Gate de branche » = la séquence des Global Constraints.

### Task 1: Branche de travail et garde des contrats vendorisés

**Files:**
- Create: `tools/contracts/policy-receipt-vendor.ts`, `tools/contracts/policy-receipt-vendor.test.ts`

**Interfaces:**
- Consumes: `vendor/contracts/contracts/catalog.v1.json`, `vendor/contracts/pin.json` (format `signalement.contract-pin.v2`, table `files` unique), état de la branche de vendorisation L1 (L1 Task 11)
- Produces:
  ```ts
  export const VENDOR_ROOT: URL;   // ../../vendor/contracts/
  /** Reads the vendored catalog synchronously; throws `contract <id> is not vendored`. */
  export function vendoredContractEntry(id: string): { kind: string; path: string; vectors: string[]; status: string };
  ```
  Module sans test, réutilisé par Task 13 (importer un `.test.ts` réenregistrerait ses tests).

- [ ] **Step 1: Worktree sur la branche de vendorisation L1**

```bash
cd "$(git rev-parse --show-toplevel)" && git fetch origin
L1_BRANCH="$(grep -oE 'feat/v1-l1-vendor-candidates' docs/superpowers/plans/2026-10-24-v1-L1-contracts-part-3.md | head -1)"
git ls-remote --heads origin "$L1_BRANCH"     # attendu : une ligne (PR brouillon de L1 Task 11) ; sinon BLOCKED
WT="$(mktemp -d)/signalement-l2"
git worktree add -b feat/v1-l2-policy-receipt "$WT" "origin/$L1_BRANCH" && cd "$WT" && bun install --frozen-lockfile
```

À chaque re-vendorisation de L1 (correction de candidat, L1 Task 12), intégrer par `git merge --signoff --no-edit "origin/$L1_BRANCH"`, jamais par rebase.

- [ ] **Step 2: Relever les faits vendorisés**

```bash
jq -r '.contracts[] | select(.id|startswith("signalement-")) | "\(.id) \(.kind) \(.status)"' vendor/contracts/contracts/catalog.v1.json
jq -r '.contracts[] | select(.id=="signalement-policy-receipt-v1") | .vectors[]' vendor/contracts/contracts/catalog.v1.json
grep -E '^(package|world) ' vendor/contracts/contracts/wit/signalement-policy-receipt-v1/world.wit
grep -n 'sign-receipt' vendor/contracts/contracts/wit/signalement-policy-receipt-v1/world.wit
```

Attendu : les cinq contrats en `candidate` ; vecteurs `contracts/fixtures/signalement-policy-receipt-v1/golden-vectors.v1.json` et `contracts/fixtures/signalement-projection-receipt-v1/signature-vectors.v1.json` ; `package libre-ai:signalement-policy-receipt@1.0.0;`, `world signalement-policy-receipt` ; `sign-receipt: func(unsigned: list<u8>, secret-key: list<u8>)` **sans** `key-id` (registre §4.2). Un `key-id` encore présent est un BLOCKED à rapporter à L1.

- [ ] **Step 3: Test qui échoue**

```ts
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { VENDOR_ROOT as root, vendoredContractEntry } from "./policy-receipt-vendor.ts";

const GOLDEN = "contracts/fixtures/signalement-policy-receipt-v1/golden-vectors.v1.json";
const SIGNATURES = "contracts/fixtures/signalement-projection-receipt-v1/signature-vectors.v1.json";

describe("L2 vendored contract prerequisites", () => {
  test("the WIT world lists both corpora", () => {
    const wit = vendoredContractEntry("signalement-policy-receipt-v1");
    expect(wit.kind).toBe("wit");
    expect(wit.path).toBe("contracts/wit/signalement-policy-receipt-v1/world.wit");
    expect(wit.vectors).toEqual(expect.arrayContaining([GOLDEN, SIGNATURES]));
    for (const path of [wit.path, ...wit.vectors]) expect(existsSync(new URL(path, root))).toBe(true);
  });
  test("every consumed vendored file is pinned", async () => {
    const pin = (await Bun.file(new URL("pin.json", root)).json()) as { files: Record<string, string> };
    for (const path of [GOLDEN, SIGNATURES,
      vendoredContractEntry("signalement-routing-policy-v1").path,
      vendoredContractEntry("signalement-projection-receipt-v1").path])
      expect(Object.keys(pin.files)).toContain(path);
  });
});
```

- [ ] **Step 4: Exécuter** `bun test tools/contracts/policy-receipt-vendor.test.ts` → `2 pass`. Contrôle de discrimination : `git switch --detach origin/main && bun test tools/contracts/policy-receipt-vendor.test.ts; git switch -` → échec `contract signalement-policy-receipt-v1 is not vendored` (les fichiers neufs, non suivis, restent en place).
- [ ] **Step 5: Neutralisation** : `"signalement-policy-receipt-v1"` → `"…-v0"` dans le premier test : rouge. Restaurer.
- [ ] **Step 6: Commit**

```bash
git add tools/contracts/policy-receipt-vendor.ts tools/contracts/policy-receipt-vendor.test.ts
# gate de branche
git commit -s -m "test(contracts): guard the vendored L1 contracts that policy-receipt consumes"
```

---

### Task 2: Chaîne Rust de la flotte et squelette de crate

**Files:**
- Create: `rust-toolchain.toml`, `Cargo.toml`, `Cargo.lock`, `.cargo/config.toml`, `deny.toml`, `crates/policy-receipt/Cargo.toml`, `crates/policy-receipt/src/lib.rs`, `crates/policy-receipt/src/error.rs`
- Modify: `.github/dependabot.yml:1-61` (variante `cargo`), `.github/workflows/ci.yml:16-20` (job `dependency-policy`), `.github/workflows/ci.yml:42-43` (Rust avant `check:tree`), `package.json:27-48` (`check:rust`, `check:tree`)

**Interfaces:**
- Produces:
  ```rust
  pub enum ErrorCode { InputTooLarge, PolicyInvalid, InputInvalid, InputOriginInvalid,
      CanonicalizeTooLarge, CanonicalizeRawJson, CanonicalizeNumber, CanonicalizeLoneSurrogate, CanonicalizeDepth,
      ReceiptInvalid, KeyInvalid, KeysInvalid, InternalError }
  impl ErrorCode { pub fn as_str(self) -> &'static str; pub fn message(self) -> &'static str; }
  pub struct ContractError { pub code: ErrorCode }
  ```
  Script `bun run check:rust`.

- [ ] **Step 1: Fichiers de flotte, octet pour octet**

```bash
GOV_REF="$(jq -r '.devDependencies["@libre-ai/governance"] | split("#")[1]' package.json)"
gh api repos/libre-ai/ai-model-policy/contents/rust-toolchain.toml --jq .content | base64 -d > rust-toolchain.toml
gh api repos/libre-ai/artifact-verification/contents/rust-toolchain.toml --jq .content | base64 -d | cmp - rust-toolchain.toml
mkdir .cargo && gh api repos/libre-ai/ai-model-policy/contents/.cargo/config.toml --jq .content | base64 -d > .cargo/config.toml
gh api "repos/libre-ai/project-governance/contents/deny.toml?ref=$GOV_REF" --jq .content | base64 -d > deny.toml
cp node_modules/@libre-ai/governance/distribution/templates/dependabot/cargo.yml .github/dependabot.yml
```

`deny.toml` reste identique à la gouvernance (même blob dans `ai-model-policy` et `artifact-verification`). La variante Dependabot `cargo` est exigée dès qu'un `Cargo.toml` existe (`ecosystem/check-dependabot-conformance.ts`, `selectVariant`). `.cargo/config.toml` ajoute `+simd128` à la cible WASM, comme le précédent.

- [ ] **Step 2: Workspace et crate**

`Cargo.toml` racine : structure de `ai-model-policy` (`members = ["crates/policy-receipt"]`, `resolver = "2"`, `edition = "2024"`, `rust-version` = canal de `rust-toolchain.toml` sans correctif, `license = "EUPL-1.2"`, `repository = "https://github.com/libre-ai/signalement"`). `[workspace.dependencies]` : les lignes exactes de `ai-model-policy/Cargo.toml` pour `serde`, `serde_json`, `serde_jcs`, `sha2`, `wit-bindgen`, `wasmparser`, `wit-component` ; `ed25519-dalek = { version = "=2.2.0", default-features = false, features = ["fast", "zeroize"] }` ; `curve25519-dalek = { version = "=4.1.3", default-features = false, features = ["zeroize"] }` ; `base64 = { version = "=0.22.1", default-features = false, features = ["alloc"] }`. Crate : `name = "policy-receipt"`, `version = "1.0.0"`, `publish = false`, `crate-type = ["cdylib", "rlib"]`, `[dev-dependencies] wasmparser, wit-component`. Aucune feature `std` ni `rand_core` : un `getrandom` dans le graphe casserait la cible ou ajouterait un import.

- [ ] **Step 3: Résoudre `zeroize`**

```bash
cargo generate-lockfile && cargo tree -p policy-receipt -i zeroize -e normal --depth 0 | head -1
```

Épingler la version affichée (`=X.Y.Z`, `default-features = false`) au workspace et à la crate : crate déjà présente dans le graphe par `ed25519-dalek/zeroize`.

- [ ] **Step 4: Test qui échoue**

```rust
#[test]
fn error_codes_are_stable_and_unique() {
    use super::ErrorCode::*;
    let all = [InputTooLarge, PolicyInvalid, InputInvalid, InputOriginInvalid, CanonicalizeTooLarge,
        CanonicalizeRawJson, CanonicalizeNumber, CanonicalizeLoneSurrogate, CanonicalizeDepth, ReceiptInvalid,
        KeyInvalid, KeysInvalid, InternalError];
    let codes: Vec<&str> = all.iter().map(|c| c.as_str()).collect();
    assert_eq!(codes, ["input.too_large", "policy.invalid", "input.invalid", "input.origin_invalid",
        "canonicalize.too_large", "canonicalize.raw_json", "canonicalize.number", "canonicalize.lone_surrogate",
        "canonicalize.depth", "receipt.invalid", "key.invalid", "keys.invalid", "internal.error"]);
    let mut unique = codes.clone(); unique.sort(); unique.dedup();
    assert_eq!(unique.len(), all.len());
    for code in all { assert!(!code.message().is_empty() && code.message().is_ascii()); }
}
```

Run: `cargo test --locked -p policy-receipt` → échec de compilation.

- [ ] **Step 5: Implémenter** `error.rs`, `lib.rs` (attributs de crate des Global Constraints). Run → `ok`.

- [ ] **Step 6: Scripts et CI**

`package.json`, après `check:core` :

```json
"check:rust": "bun run check:bun:runtime && cargo fmt --all --check && cargo clippy --locked --workspace --all-targets -- -D warnings && cargo clippy --locked -p policy-receipt --target wasm32-unknown-unknown -- -D warnings && cargo test --locked --workspace"
```

`check:tree` : insérer `bun run check:rust` après `bun run check:export`.

`.github/workflows/ci.yml` : job `dependency-policy: uses: libre-ai/project-governance/.github/workflows/reusable-dependency-policy.yml@<sha>`, `<sha>` = celui de la ligne 18 (`grep -oE 'reusable-licensing.yml@[0-9a-f]{40}' .github/workflows/ci.yml`). Avant `- run: bun run check:tree` :

```yaml
      - name: Install pinned Rust toolchain
        run: |
          rustup toolchain install
          test "$(rustc --version | cut -d' ' -f2)" = "$(sed -n 's/^channel = "\(.*\)"$/\1/p' rust-toolchain.toml)"
          rustup target list --installed | grep -qx wasm32-unknown-unknown
```

`rustup toolchain install` sans argument lit `rust-toolchain.toml` (rustup ≥ 1.28) : **à vérifier sur le runner** ; sinon `dtolnay/rust-toolchain` au sha de `validate-composition.yml` de la gouvernance épinglée, `toolchain` lu dans le fichier par une étape précédente.

- [ ] **Step 7: Neutralisation** : `KeysInvalid.as_str()` → `"key.invalid"` : rouge (doublon). Restaurer.
- [ ] **Step 8: Commit**

```bash
git add rust-toolchain.toml Cargo.toml Cargo.lock .cargo/config.toml deny.toml .github/dependabot.yml .github/workflows/ci.yml package.json crates/policy-receipt
# gate de branche
git commit -s -m "build(rust): add the fleet Rust toolchain, dependency policy and policy-receipt skeleton"
```

---

### Task 3: JSON strict et `canonicalize`

**Files:**
- Create: `crates/policy-receipt/src/strict_json.rs`, `crates/policy-receipt/src/jcs.rs`
- Modify: `crates/policy-receipt/src/lib.rs`

**Interfaces:**
- Produces:
  ```rust
  pub(crate) enum JsonDefect { TooLarge, RawJson, Number, LoneSurrogate, Depth }
  pub(crate) fn parse(bytes: &[u8], limit: usize) -> Result<serde_json::Value, JsonDefect>;
  pub(crate) fn to_jcs(value: &serde_json::Value) -> Result<Vec<u8>, ErrorCode>;   // InternalError on failure
  pub(crate) fn sha256_hex(bytes: &[u8]) -> String;
  pub(crate) fn sha256_raw(bytes: &[u8]) -> [u8; 32];
  pub fn canonicalize(json: &[u8]) -> Result<Vec<u8>, ContractError>;   // parse(1 048 576) puis to_jcs ; JsonDefect → canonicalize.*
  ```
  Chaque appelant projette `JsonDefect` sur ses propres codes (`policy.invalid`, `input.invalid`, `keys.invalid`, verdict `unreadable`).

- [ ] **Step 1: Tests qui échouent**

```rust
#[test] fn jcs_sorts_keys_and_escapes_like_rfc8785() {
    let input = br#"{"b":"€$\u000F\u000aA'B"\\\\"\/","a":[null,true,false,9007199254740991,-9007199254740991]}"#;
    let expected = r#"{"a":[null,true,false,9007199254740991,-9007199254740991],"b":"€$\u000f\nA'B\"\\\\\"/"}"#;
    assert_eq!(canonicalize(input).unwrap(), expected.as_bytes());
}
#[test] fn numbers_outside_safe_integers_are_refused() {
    for input in ["1.5", "1E30", "4.50", "2e-3", "9007199254740992", "-9007199254740992", "18446744073709551616"] {
        assert_eq!(canonicalize(input.as_bytes()).unwrap_err().code, ErrorCode::CanonicalizeNumber, "{input}");
    }
}
#[test] fn duplicate_member_is_refused() {
    for input in [&br#"{"a":1,"a":2}"#[..], br#"{"x":{"a":1,"b":2,"a":1}}"#] {
        assert_eq!(canonicalize(input).unwrap_err().code, ErrorCode::CanonicalizeRawJson);
    }
}
#[test] fn malformed_inputs_map_to_their_codes() {
    for input in [&b"\xEF\xBB\xBF{}"[..], b"{} x", b"\xff", b"", b"NaN"] {
        assert_eq!(canonicalize(input).unwrap_err().code, ErrorCode::CanonicalizeRawJson);
    }
    for input in [&br#""\ud800""#[..], br#""\udc00x""#, br#""\ud800A""#] {
        assert_eq!(canonicalize(input).unwrap_err().code, ErrorCode::CanonicalizeLoneSurrogate);
    }
    assert_eq!(canonicalize(br#""😀""#).unwrap(), "\"😀\"".as_bytes());
    let nest = |n: usize| format!("{}{}", "[".repeat(n), "]".repeat(n));
    assert_eq!(canonicalize(nest(65).as_bytes()).unwrap_err().code, ErrorCode::CanonicalizeDepth);
    assert!(canonicalize(nest(64).as_bytes()).is_ok());
    assert_eq!(canonicalize(&vec![b' '; 1_048_577]).unwrap_err().code, ErrorCode::CanonicalizeTooLarge);
}
#[test] fn sha256_hex_is_lowercase() {
    assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
}
```

- [ ] **Step 2: Implémenter `parse`** (algorithme non déterminé par la signature) :
  1. longueur > `limit` → `TooLarge` ; préfixe `EF BB BF` → `RawJson` ;
  2. pré-balayage linéaire des échappements `\u` dans les chaînes : un `\uD800`–`\uDBFF` non suivi immédiatement d'un `\uDC00`–`\uDFFF`, ou un bas isolé → `LoneSurrogate` ;
  3. `serde_json::Deserializer::from_slice` ; un `DeserializeSeed` porte la profondeur (> 64 → `Depth`) ; `visit_map` refuse une clé déjà présente (→ `RawJson`) ; `visit_f64` → `Number` ; `visit_u64`/`visit_i64` hors ±(2⁵³ − 1) → `Number` ;
  4. `deserializer.end()` refuse les octets en trop ; toute autre erreur serde → `RawJson`, message serde jamais conservé.
- [ ] **Step 3: Implémenter** `to_jcs` (délègue à `serde_jcs::to_vec`, erreur → `InternalError`), `sha256_hex`, `sha256_raw`. Run vert.
- [ ] **Step 4: Neutralisation** : (a) `visit_map` écrase au lieu de refuser → `duplicate_member_is_refused` rouge ; (b) `visit_f64` accepte → `numbers_outside_safe_integers_are_refused` rouge ; (c) pré-balayage remplacé par `Ok(())` → la ligne `\ud800A` rougit (serde la classe `RawJson`). Restaurer.
- [ ] **Step 5: Commit** — `git add crates/policy-receipt/src` ; gate de branche ; `git commit -s -m "feat(policy-receipt): strict safe-integer JSON and RFC 8785 canonicalization"`.

---

### Task 4: Politique, origine et entrée d'évaluation

**Files:**
- Create: `crates/policy-receipt/src/origin.rs`, `crates/policy-receipt/src/policy.rs`, `crates/policy-receipt/src/input.rs`

**Interfaces:**
- Consumes: `parse` (Task 3) ; schéma et `vectors.json` vendorisés de `signalement-routing-policy-v1`
- Produces:
  ```rust
  pub(crate) struct Origin { scheme: Scheme, host: String, port: Option<u16> }
  pub(crate) fn parse_origin(text: &str) -> Result<Origin, ()>;
  pub(crate) struct RoutingPolicy { /* serde, deny_unknown_fields, camelCase ; champs du contrat consommé */ }
  pub(crate) fn load_policy(bytes: &[u8]) -> Result<(RoutingPolicy, serde_json::Value), ErrorCode>; // policy.invalid | input.too_large
  pub(crate) struct EvaluationInput { observed_origin: Option<Origin>, files: Vec<InputFile>, discovered: BTreeMap<String, DiscoveredAttributes> }
  pub(crate) fn load_input(bytes: &[u8], policy: &RoutingPolicy) -> Result<EvaluationInput, ErrorCode>; // input.invalid | input.origin_invalid | input.too_large
  ```

Grammaire d'origine (forme de `new URL(x).origin`) : `^(https|http)://<host>(:<port>)?$` ; `<host>` = nom DNS minuscule (labels `[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?`, 253 octets au plus, sans point final) ou IPv4 décimal sans zéro de tête ; `<port>` 1..65535 sans zéro de tête, jamais 443 en `https` ni 80 en `http`. IPv6 refusé — `shortcut: IPv6 origins refused, upgrade trigger: a policy must route an IPv6 origin`. `load_policy` reproduit l'acceptation de `rawRoutingPolicyFailures` (schéma, `duplicate_id`, `unknown_destination`, `routing_overlap`, `target_profile_mismatch`) ; chaque refus → `policy.invalid`. Une origine exacte de règle hors grammaire, ou un `hostPattern` hors du motif du contrat, → `policy.invalid`. `load_input` : 1..33 fichiers, `path` 1..80 octets et unique, `sha256` hexadécimal minuscule de 64 caractères, `role` ∈ rôles, clé de `discovered` qui n'est pas une destination → `input.invalid` ; `observedOrigin` non `null` hors grammaire → `input.origin_invalid`.

- [ ] **Step 1: Tests qui échouent**

```rust
#[test] fn observed_origin_must_be_serialized_form() {
    for ok in ["https://example.test", "http://localhost:8080", "https://a.b.example.test:8443", "http://192.0.2.10"] {
        assert!(parse_origin(ok).is_ok(), "{ok}");
    }
    for bad in ["https://Example.test", "https://example.test:443", "http://example.test:80", "https://example.test.",
        "https://example.test/", "https://example.test/p", "https://example.test#x", "ftp://example.test", "https://",
        "https://exa_mple.test", "https://example.test:0", "https://example.test:065", "https://example.test:65536",
        "https://[::1]", "https://-a.example.test", "https://010.0.0.1", " https://example.test"] {
        assert!(parse_origin(bad).is_err(), "{bad}");
    }
}
#[test] fn l1_policy_vectors_agree() {
    // vectors.json de signalement-routing-policy-v1, chemin résolu par vendored_file("signalement-routing-policy-v1", "vectors.json")
    for v in policy_vectors() {
        assert_eq!(load_policy(&v.bytes).is_ok(), v.failures.is_empty(), "{}", v.id);
    }
}
#[test] fn evaluation_input_table() { /* lignes ci-dessous */ }
```

| Entrée (politique `base_policy()` valide) | Attendu |
| --- | --- |
| `files: []` ; 34 fichiers ; deux `README.md` ; `sha256` en majuscules ; `role: "audio"` ; `discovered: { "ghost": … }` | `input.invalid` |
| `observedOrigin: "https://app.example.test/"` | `input.origin_invalid` |
| `observedOrigin: null` | accepté |

`policy_vectors` et `vendored_file` vivent dans `tests/support/mod.rs` (Task 7) et en `#[cfg(test)]` d'un module `test_support` pour les tests unitaires ; ils lisent le catalogue depuis `env!("CARGO_MANIFEST_DIR")/../../vendor/contracts/` et paniquent (test rouge) si l'entrée ou le fichier manque. Un vecteur invalide L1 accepté par `load_policy` signale un contrôle manquant : l'ajouter, ne pas filtrer le vecteur.

- [ ] **Step 2: Implémenter** (structs serde `deny_unknown_fields`, `rename_all = "camelCase"`, enums kebab). Run vert.
- [ ] **Step 3: Neutralisation** : (a) refus du port par défaut → `false` : `https://example.test:443` passe, rouge ; (b) contrôle `routing_overlap` → `Ok(())` : le vecteur L1 `r-overlap` rougit. Restaurer.
- [ ] **Step 4: Commit** — gate de branche ; `git commit -s -m "feat(policy-receipt): validate routing policies, observed origins and evaluation inputs"`.

---

### Task 5: Sélection des règles et routage

**Files:**
- Create: `crates/policy-receipt/src/routing.rs`

**Interfaces:**
- Consumes: `RoutingPolicy`, `Origin` (Task 4)
- Produces:
  ```rust
  pub(crate) fn rule_matches(rule: &RoutingRule, origin: Option<&Origin>) -> bool;
  /// The single precedence decision (Review Focus 1). Returns the retained rules in document order.
  pub(crate) fn select_rules<'a>(policy: &'a RoutingPolicy, origin: Option<&Origin>) -> Vec<&'a RoutingRule>;
  pub(crate) struct Routing { pub matched_rule_ids: Vec<String>, pub imposed: BTreeSet<String>, pub optional: BTreeSet<String>,
      pub selectable: BTreeSet<String>, pub denied: BTreeSet<String>, pub override_allowed: bool }
  pub(crate) fn combine(rules: &[&RoutingRule]) -> Routing;   // arithmétique d'union du contrat consommé
  ```

`rule_matches` : `origin` égale octet pour octet ; `{scheme, hostPattern, port}` : même schéma, même port (`null` ↔ absent), `host` se termine par `.` + suffixe du motif et le préfixe est non vide ; `absent` ↔ origine `null`. `select_rules` (défaut provisoire, décision propriétaire attendue) : **toutes** les règles appariées, dans l'ordre du document (union, DL8 de L1). Alternative « règle la plus spécifique » : seul ce corps et sa table changeraient (exacte, sinon motif au suffixe le plus long), avec les vecteurs L1 `denied-dominates` et `override-most-restrictive` avant le verrou. `combine` applique l'union du contrat à l'ensemble retenu ; `matched_rule_ids` = ids retenus. Aucune règle : tout vide, `override_allowed = false`.

- [ ] **Step 1: Tests qui échouent**

```rust
#[test] fn host_pattern_matches_subdomains_same_scheme_and_port() {
    let rule = pattern_rule("https", "*.example.test", None);
    for o in ["https://a.example.test", "https://a.b.example.test"] { assert!(rule_matches(&rule, Some(&origin(o))), "{o}"); }
    for o in ["https://example.test", "https://evilexample.test", "https://a.example.test.evil.test",
              "http://a.example.test", "https://a.example.test:8443"] { assert!(!rule_matches(&rule, Some(&origin(o))), "{o}"); }
    assert!(rule_matches(&pattern_rule("https", "*.example.test", Some(8443)), Some(&origin("https://a.example.test:8443"))));
}
#[test] fn select_rules_table() {
    // politique : r-wide *.example.test, r-exact https://app.example.test, r-eu *.eu.example.test, r-wide-2 *.example.test, r-none absent
    for (observed, retained) in [
        (Some("https://app.example.test"), vec!["r-wide", "r-exact", "r-wide-2"]),   // ordre du document
        (Some("https://x.example.test"), vec!["r-wide", "r-wide-2"]),
        (Some("https://x.eu.example.test"), vec!["r-wide", "r-eu", "r-wide-2"]),
        (None, vec!["r-none"]),
        (Some("https://other.test"), vec![]),
    ] { assert_eq!(ids(select_rules(&POLICY_SEL, observed.map(origin).as_ref())), retained, "{observed:?}"); }
}
#[test] fn union_lets_a_denial_dominate_and_the_strictest_override_apply() {
    // POLICY_UNION : r-a imposed [d1] override allowed ; r-b (même origine) denied [d1] override absent
    let r = combine(&select_rules(&POLICY_UNION, Some(&origin("https://app.example.test"))));
    assert!(r.imposed.is_empty() && set(&r.denied) == vec!["d1"] && !r.override_allowed);
}
#[test] fn combine_is_the_contract_union() {
    // r1 imposed [a, b] optional [c] selectable [d, a] denied [] override allowed ; r2 imposed [] denied [b] override allowed ; r3 override absent
    let r = combine(&[&R1, &R2]);
    assert_eq!((set(&r.imposed), set(&r.optional), set(&r.selectable), set(&r.denied), r.override_allowed),
               (vec!["a"], vec!["c"], vec!["d"], vec!["b"], true));
    assert!(!combine(&[&R1, &R3]).override_allowed);
    assert!(!combine(&[]).override_allowed);
}
```

Si le propriétaire choisit « la plus spécifique », seuls `select_rules_table` et `union_lets_…` changent : `app.example.test` → `["r-exact"]`, `x.example.test` → `["r-wide"]`, `x.eu.example.test` → `["r-eu"]`.

- [ ] **Step 2: Implémenter. Run vert.**
- [ ] **Step 3: Neutralisation** : (a) `rule_matches` motif → `host.ends_with(suffix)` sans `.` ni schéma ni port : `evilexample.test` et `http://` passent, rouge ; (b) `select_rules` → « premier apparié seulement » : `select_rules_table` et `union_lets_…` rougissent ; (c) `combine` sans soustraction de `denied` : rouge. Restaurer.
- [ ] **Step 4: Commit** — gate de branche ; `git commit -s -m "feat(policy-receipt): isolate rule precedence and apply the contract union"`.

---

### Task 6: Divulgation et `evaluate`

**Files:**
- Create: `crates/policy-receipt/src/disclosure.rs`, `crates/policy-receipt/src/evaluate.rs`
- Modify: `crates/policy-receipt/src/lib.rs` (`pub fn evaluate`)

**Interfaces:**
- Produces:
  ```rust
  pub fn evaluate(policy: &[u8], input: &[u8]) -> Result<Vec<u8>, ContractError>;   // JCS(PolicyVerdict)
  pub(crate) enum EffectiveVisibility { Public, Private, Unknown }
  pub(crate) fn effective_visibility(d: &Destination, discovered: Option<&DiscoveredAttributes>) -> EffectiveVisibility;
  pub(crate) fn decide(rules: &[DisclosureRule], role: Role, vis: EffectiveVisibility, residency: Residency) -> (Decision, Option<WithholdReason>);
  ```
  Sortie : `PolicyVerdict` du registre §4.2 `{ policyVersion, policyDigest, matchedRuleIds, destinations, override, deniedCount }` ; `VerdictDestination.routing` ∈ `imposed | optional | selectable` ; champ Rust `override_` renommé `override`. Algorithme : contrat consommé (index), `select_rules` puis `combine`, `attachmentUpload` jamais lu.

- [ ] **Step 1: Tests qui échouent**

```rust
#[test] fn unknown_visibility_withholds_every_file() {
    // destination d-gh visibilitySource discovered ; règles : document/screenshot transmit always
    for discovered in [None, Some(r#"{"visibility":"unknown","attachmentUpload":true}"#)] {
        let v = verdict(POLICY_D, input_with(discovered));
        assert!(files_of(&v, "d-gh").iter().all(|f| f == &("withhold", Some("visibility-unknown"))));
    }
}
#[test] fn internal_counts_as_public() {
    let v = verdict(POLICY_D, input_with(Some(r#"{"visibility":"internal","attachmentUpload":true}"#)));
    assert_eq!(file(&v, "d-gh", "README.md"), ("withhold", Some("public-destination")));   // règle withhold when visibility public
}
#[test] fn selectable_destinations_appear_only_when_override_is_allowed() {
    assert!(routings(&verdict(POLICY_A, at("https://app.example.test"))).iter().all(|r| r != "selectable"));
    let v = verdict(POLICY_B_OVERRIDE, at("https://app.example.test"));
    assert_eq!(dest_ids_with(&v, "selectable"), ["gitlab-x", "plane"]);
    assert!(files_of(&v, "plane").iter().all(|(d, _)| *d == "withhold" || *d == "transmit"));   // divulgation calculée
}
#[test] fn no_retained_rule_yields_no_destination() {
    assert_eq!(verdict(POLICY_A, at("https://unknown.test")), json!({"policyVersion":"1","policyDigest":digest_of(POLICY_A),
        "matchedRuleIds":[],"destinations":[],"override":"denied","deniedCount":0}));
}
#[test] fn output_is_canonical_sorted_and_order_independent() {
    let a = evaluate(POLICY_A.as_bytes(), at("https://app.example.test").as_bytes()).unwrap();
    assert_eq!(a, canonicalize(&a).unwrap());
    assert_eq!(a, evaluate(POLICY_A.as_bytes(), at_shuffled("https://app.example.test").as_bytes()).unwrap());
}
#[test] fn attachment_upload_never_changes_the_verdict() { /* attachmentUpload true puis false : mêmes octets */ }
```

Table `decide` (destination `eu`) :

| Règles (ordre du document) | Rôle | Visibilité | Attendu |
| --- | --- | --- | --- |
| aucune | document | private | `withhold`, `default-withhold` |
| `[document] always → transmit` | document | private | `transmit`, `null` |
| idem | screenshot | private | `withhold`, `default-withhold` |
| `[document] visibility public → withhold` ; `[document] always → transmit` | document | public | `withhold`, `public-destination` |
| `[video] residency non-eu → withhold` ; `[video] always → transmit`, destination `non-eu` | video | private | `withhold`, `residency` |
| `[document] always → withhold` ; `[document] visibility public → withhold` | document | public | `withhold`, `default-withhold` (première) |
| tout `transmit` | screenshot | unknown | `withhold`, `visibility-unknown` |

- [ ] **Step 2: Implémenter. Run vert.**
- [ ] **Step 3: Neutralisation** : (a) `Unknown` traité comme `Public` → `unknown_visibility_withholds_every_file` rouge ; (b) défaut `transmit` → première ligne de la table rouge ; (c) `selectable` émis sans condition → test `selectable…` rouge. Restaurer.
- [ ] **Step 4: Commit** — gate de branche ; `git commit -s -m "feat(policy-receipt): evaluate disclosure per destination with withhold-by-default"`.

---

### Task 7: Propriétés bornées de `evaluate`

**Files:**
- Create: `crates/policy-receipt/tests/support/mod.rs`, `crates/policy-receipt/tests/properties.rs`

**Interfaces:**
- Consumes: API publique seule
- Produces (test) :
  ```rust
  pub struct SplitMix64(u64);   // new(seed), next_u64(), below(n) sans biais de modulo
  pub fn gen_policy(rng: &mut SplitMix64) -> serde_json::Value;
  pub fn gen_input(rng: &mut SplitMix64, policy: &serde_json::Value) -> serde_json::Value;
  pub fn vendored_file(contract_id: &str, name: &str) -> std::path::PathBuf;
  ```

Pas de crate de propriété : graines `0..5000`, rejouables, la graine en échec est imprimée. Univers : 1 à 6 destinations (`residency`, `visibilitySource`, `mediaFallback` tirés), 0 à 4 règles de routage sur {`https://a.example.test`, `https://b.example.test`, `http://localhost:8080`, `*.example.test`, `*.eu.example.test`, absent}, 0 à 8 règles de divulgation ; origines de l'univers ∪ {`null`, `https://x.eu.example.test`, `https://unmatched.test`} ; fichiers parmi `README.md`/document, `media/shot-1.png`/screenshot, `media/clip-1.webm`/video ; `discovered` aléatoire, entrées parfois absentes.

- [ ] **Step 1: Tests**

```rust
const CASES: u64 = 5000;
#[test] fn no_transmit_without_explicit_rule() {
    let (mut evaluated, mut refused) = (0, 0);
    for seed in 0..CASES {
        let mut rng = SplitMix64::new(seed);
        let mut policy = gen_policy(&mut rng);
        let input = gen_input(&mut rng, &policy);
        policy["disclosureRules"].as_array_mut().unwrap().retain(|r| r["decision"] != "transmit");
        match evaluate(&bytes(&policy), &bytes(&input)) {
            Ok(out) => { evaluated += 1; assert!(!decisions(&out).iter().any(|d| d == "transmit"), "seed {seed}"); }
            Err(_) => refused += 1,
        }
    }
    println!("no_transmit_without_explicit_rule: {evaluated} evaluated, {refused} refused of {CASES}");
    assert!(evaluated * 2 > CASES);
}
```

Mêmes compteurs et même plancher (plus de la moitié évaluée) pour : `every_transmit_has_a_transmit_rule_for_its_role` ; `evaluation_is_deterministic_byte_for_byte` (deux appels ; politique ré-sérialisée en pretty-print ; `files` permutés) ; `no_retained_rule_means_no_destination` ; `denied_destinations_never_appear` ; `unknown_visibility_never_transmits` ; `removing_the_origin_only_retains_absent_rules`.

- [ ] **Step 2: Run** `cargo test --locked -p policy-receipt --test properties -- --nocapture` → 7 `ok`, chaque `evaluated` > 2500.
- [ ] **Step 3: Neutralisation** : défaut `transmit` dans `decide` → `no_transmit…` rouge avec graine ; tri des `files` retiré → déterminisme rouge ; `Unknown` → `Public` → `unknown_visibility_never_transmits` rouge. Restaurer.
- [ ] **Step 4: Commit** — gate de branche ; `git commit -s -m "test(policy-receipt): bounded deterministic property tests for evaluation"`.
