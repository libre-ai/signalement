# Signalement v1.0 — L0 gouvernance locale, partie 1 (tâches 0 à 4)

Index, Global Constraints et Review Focus : `docs/superpowers/plans/2026-10-24-v1-L0-governance.md`. Suite : `docs/superpowers/plans/2026-10-24-v1-L0-governance-part-2.md`.

---

### Task 0: Préflight, branche et worktree

**Files:** aucun.

**Interfaces:**
- Consumes : ADR-0055 / D94 fusionné dans `libre-ai/project-governance`.
- Produces : variables de session `WT`, `BASE`, `NEXT`, `DATE`.

- [ ] **Gel levé, mesuré.** `gh api repos/libre-ai/project-governance/contents/docs/adr --jq '.[].name' | grep 0055` → `0055-amend-adr-0042-signalement-unfrozen-p15-carrier.md`. `gh pr view 134 -R libre-ai/project-governance --json state,mergedAt --jq '"\(.state) \(.mergedAt)"'` → `MERGED 2026-10-23T…`. Toute autre sortie : statut `BLOCKED`, rien d'autre à faire.
- [ ] **Base.** `git fetch origin && git ls-remote --symref origin HEAD` → `ref: refs/heads/main HEAD`. `BASE=$(git rev-parse origin/main)`.
- [ ] **Worktree.** `WT="$(mktemp -d)/signalement-l0"`, `git worktree add -b v1/l0-governance "$WT" "$BASE"`, puis dans `$WT` : `bun install --frozen-lockfile`.
- [ ] **Dérivations.** Dans `$WT` : `LAST=$(ls docs/adr | tail -1); NEXT=$(printf '%04d' $((10#${LAST%%-*} + 1))); DATE=$(date +%F)`. Noter les trois valeurs dans le journal de session. `ls docs/adr/${NEXT}-* 2>/dev/null` → aucune sortie.
- [ ] **Identité.** `git config user.name` et `git config user.email` doivent égaler l'entrée de `APPROVED_PUBLIC_IDENTITIES` de `tools/ci/public-policy.ts` (adresse `noreply` reconstruite par le `join`). Différence : arrêt, sinon `check:development-history` rougit sur le premier commit.
- [ ] **Base verte.** `bun run check` → exit 0, et `bun run check:toolchain` → exit 0. Rouge sur la base : le signaler comme défaut antérieur (agent-behavior §8), ne rien corriger dans ce lot.
- [ ] **Décisions en attente.** Relever si le propriétaire a déjà tranché les deux choix de la tâche 7 (identifiant GitLab ; verdict `verifyExport` page ou serveur). Sinon, poser les deux questions maintenant, en un lot (elles sont indépendantes), pour que la réponse arrive avant la tâche 7.

### Task 1: Statut du design — gel levé, ADR-0055 / D94

**Files:**
- Modify : `docs/superpowers/specs/2026-10-22-v1-policy-routed-ticket-projection-design.md:3-5` (en-tête), `:152-155` (§3 « Gouvernance »), `:489-490` (§8.1), `:522-543` (annexe A) — numéros de la base, à reprendre dans cet ordre.
- Test : commandes `grep` ci-dessous.

**Interfaces:**
- Consumes : ADR-0055 §« Décision » D1 (texte adopté), lu par `gh api`.
- Produces : aucune.

- [ ] **Rouge.** `grep -c "attend la fusion de l'amendement\|Proposé le 2026-10-23 comme\|Aucun lot de code ne démarre avant la fusion" docs/superpowers/specs/2026-10-22-v1-policy-routed-ticket-projection-design.md` → `3`.
- [ ] **Texte adopté, mesuré.** `D=$(mktemp -d)`, `gh api repos/libre-ai/project-governance/contents/docs/adr/0055-amend-adr-0042-signalement-unfrozen-p15-carrier.md --jq .content | base64 -d > "$D/adr-0055.md"`, puis `sed -n '/^### D1/,/^### D2/p' "$D/adr-0055.md"`. Garder la citation (bloc `>`) telle quelle pour l'étape suivante. Le 2026-10-24, elle diffère du texte proposé en annexe A : « la v1.0 décrite dans son dépôt » au lieu du chemin du design. Effacer ensuite `"$D"` par `scratch-clean`.
- [ ] **En-tête, lignes 3-5**, remplacées par :
  ```
  - Statut : design approuvé par le propriétaire le 2026-10-23 (en chat) ; gel levé par
    ADR-0055, décision D94 du registre de `libre-ai/project-governance`, fusionné par le
    propriétaire le 2026-10-23 (`libre-ai/project-governance` #134)
  ```
  La ligne 13 (« N'autorise pas à lui seul : la sortie du gel ») reste : le design n'a pas levé le gel, ADR-0055 l'a fait.
- [ ] **§3, puce « Gouvernance » (lignes 152-155)**, remplacée par :
  ```
  - **Gouvernance.** ADR-0042 §1 gelait `signalement` jusqu'à B′ (texte en annexe A).
    ADR-0055 (D94), fusionné le 2026-10-23, l'a amendé : le gel est levé. Aucune PR de
    code qui consomme un contrat public ne fusionne avant le verrou de ce contrat (§8.3).
    Les chemins gardés (`docs/adr/**`, etc.) exigent un artefact de revue ; l'agent
    n'écrit jamais de ligne `Owner-arbitration:`.
  ```
- [ ] **§8.1** : ajouter en fin d'item « Fait : ADR-0055, D94, fusionné le 2026-10-23 (`libre-ai/project-governance` #134). »
- [ ] **Annexe A.** Garder le « Texte actuel » et le « Texte proposé » comme histoire. Insérer après le texte proposé un paragraphe « Texte adopté (ADR-0055, D1) : » suivi de la citation mesurée. Remplacer le paragraphe « Forme : … Proposé le 2026-10-23 comme ADR-0055 … » par : « Forme : un ADR d'amendement dans `project-governance`. Fusionné le 2026-10-23 comme ADR-0055, entrée D94 du registre (`libre-ai/project-governance` #134). La ligne d'arbitrage est écrite par le propriétaire, jamais par l'agent. »
- [ ] **Vert.** Même `grep -c` qu'au rouge → `0`. `grep -c "ADR-0055" <design>` → au moins `4` (en-tête, §3, §8.1, annexe A).
- [ ] **Commit.** `git add docs/superpowers/specs/2026-10-22-v1-policy-routed-ticket-projection-design.md && git commit -s -m "docs(spec): record the lifted freeze (ADR-0055, D94) in the v1.0 design"`.

### Task 2: Amendement d'ADR-0005 — surface de permission

**Files:**
- Modify : `docs/adr/0005-local-vault-and-reviewed-export.md:3` (statut) ; ajout d'une section en fin de fichier (après `:55`).
- Test : commandes `grep`.

**Interfaces:**
- Consumes : design §5.2, D8, D10 ; feuille de route §4.1 (forme de l'origine observée) et §4.6 (protocole de remise).
- Produces : la phrase de surface de permission que L6 cite.

**Forme retenue : section d'amendement dans ADR-0005, pas un ADR séparé.** Motifs : la surface de permission reste lisible à un seul endroit, la puce d'origine (`:45-46`) est conservée telle quelle comme histoire, et la feuille de route (§2, critère de sortie de L0) prévoit « ADR-0005 amendé » plus un seul ADR neuf. Un ADR d'amendement séparé décalerait le numéro du nouvel ADR sans rien ajouter.

- [ ] **Rouge.** `grep -c "observed origin retention, and gesture-bound delivery to one configured origin" docs/adr/0005-local-vault-and-reviewed-export.md` → `0`.
- [ ] **Statut, ligne 3**, devient : `- Status: accepted implementation choice; browser qualification is separate; amended <DATE> for v1.0 delivery (see "Amendment")`.
- [ ] **Section ajoutée**, en anglais, titre `## Amendment — <DATE>, v1.0 gesture-bound delivery`, avec exactement ces points :
  - origine : décisions propriétaire D8 et D10 du design v1.0 ; gel levé par `libre-ai/project-governance` ADR-0055 (D94) ;
  - la conséquence « Permission surface is voluntary active-tab capture, with no host permissions or content-script collection. » se lit désormais, mot pour mot : « Permission surface is voluntary active-tab capture, observed origin retention, and gesture-bound delivery to one configured origin, with no host permissions or content-script collection. » ;
  - `permissions` deviennent `["activeTab", "scripting"]` ; `host_permissions`, `content_scripts` et `externally_connectable` restent absents ; la CSP `connect-src 'none'` des pages de l'extension est inchangée. L'amendement autorise ; le manifest et `tools/build/manifest.test.ts:7` changent avec l'implémentation de la remise (L6), pas avant ;
  - origine observée : seule l'origine de l'onglet capturé est gardée (schéma, hôte, port, sérialisés par `new URL(x).origin`, schémas `https` et `http`), dans l'enveloppe chiffrée du brouillon ; affichée à la relecture comme observation de capture, distincte des déclarations ; retirable, et alors `null` et non transmise ; elle voyage dans l'enveloppe de remise, jamais dans l'export ; `signalement-local-export-v1` est inchangé ;
  - remise : geste explicite sur l'onglet du control plane ; égalité exacte (schéma, hôte, port) avec l'origine saisie par la personne, jamais déduite de la page ; différence = refus visible sans injection ; nouvelle préparation par l'éditeur, donc nouvelle frontière d'approbation au sens de ce même ADR ; confirmation montrant origine de destination, origine observée et contenu ; fonction fixe par `scripting.executeScript` avec `func`, monde isolé, jamais de code construit à partir de données, qui ne lit rien de la page et poste par `postMessage` vers l'origine cible explicite ; morceaux bornés acquittés, digest de l'export annoncé en tête et vérifié à la fin ;
  - le service worker ne détient ni clé ni octets ;
  - frontière inchangée : aucun accès réseau depuis l'éditeur, aucun navigateur promu, aucune remise qualifiée tant que la matrice navigateur ne l'a pas prouvée par navigateur.
- [ ] **Vert.** Même `grep -c` qu'au rouge → `1`. `grep -c '"activeTab", "scripting"' docs/adr/0005-local-vault-and-reviewed-export.md` → `1`. `grep -c "Permission surface is voluntary active-tab capture, with no host permissions" docs/adr/0005-local-vault-and-reviewed-export.md` → `1` (la puce d'origine est conservée).
- [ ] **Commit.** `git add docs/adr/0005-local-vault-and-reviewed-export.md && git commit -s -m "docs(adr): amend ADR-0005 permission surface for gesture-bound delivery"`.

### Task 3: Nouvel ADR — policy-routed fan-out and signed receipts

**Files:**
- Create : `docs/adr/<NEXT>-policy-routed-fan-out-and-signed-receipts.md`.
- Test : commandes `grep`.

**Interfaces:**
- Consumes : design §4 (D4-D13), §5.1, §5.3, §5.5, §5.7 ; feuille de route §4.1 (identifiants de catalogue, profils, valeurs fixées) et §4.2 (monde WIT).
- Produces : le chemin `docs/adr/<NEXT>-policy-routed-fan-out-and-signed-receipts.md`, cité comme `source:` par `qualification/decision-lock.yaml` et `qualification/risk-register.yaml` (tâche 5).

- [ ] **Rouge.** `ls docs/adr/<NEXT>-* 2>/dev/null | wc -l` → `0`.
- [ ] **Rédiger l'ADR**, en anglais, au format des ADR 0001-0005 :
  - titre `# ADR-<NEXT> — Policy-routed fan-out and signed receipts` ;
  - en-tête : `Status: accepted for the v1.0 scope; provider, browser and deployment qualification is separate` ; `Decision owner:` décisions propriétaire D4 à D13 des 2026-10-22/23 (design §4), gel levé par `libre-ai/project-governance` ADR-0055 (D94) ; `Reopens when:` un contrat de politique, de reçu ou de profil change de façon incompatible, ou une frontière de confiance mesurée exige un second déployable ; `Prolongs:` ADR-0001, ADR-0002, ADR-0004, ADR-0005 (amendé le `<DATE>`) ;
  - `## Context` : acheteur, problème (mauvais outil, trop de données, doublons), et ce que les ADR existants fixent déjà ;
  - `## Decision`, une sous-section par décision, titres exacts `### D4 — …` à `### D13 — …` (les numéros sont ceux du design, pas ceux du registre de la flotte). Contenu minimal :
    - D4 : l'acheteur est l'équipe qui pose les règles ; politique, audit et reçus sont le cœur produit ;
    - D5 : control plane auto-hébergé et CLI sur le même moteur (précisé par D11) ;
    - D6 : vocabulaire `imposed`, `optional`, `selectable`, `denied` ; `override: allowed | denied`, défaut `denied` ; une destination ajoutée par override passe par les mêmes règles de divulgation ; aucune règle appariée = aucune destination ; politique versionnée `draft → approved → retired`, seule `approved` s'applique, séparation auteur / approbateur par défaut, assouplissable sous audit ; évaluation pure, même entrée → même plan octet pour octet ; divulgation par fichier, classes `document`, `screenshot`, `video`, `transmit | withhold` avec retenue par défaut ; remise des médias `link | withhold`, défaut `withhold` ;
    - D7 : reçu par livraison réussie, canonicalisé JCS (RFC 8785), signé Ed25519 avec vérification stricte (feuille de route §4.1) ; contenu minimal du design §5.5 ; export v1 inchangé ; ce qu'un reçu prouve (ce control plane a envoyé ces octets à cet identifiant distant sous cette politique) et ce qu'il ne prouve pas (identité ou intention de la personne, suite donnée par le fournisseur) ;
    - D8 : remise par l'onglet actif avec ajout borné de `scripting`, renvoi à l'amendement d'ADR-0005 ;
    - D9 : destinations refusées masquées, compteur seul, limité aux refus explicites de la règle appariée ; le détail vit au journal d'audit, lisible par les administrateurs de politique ;
    - D10 : routage sur l'origine observée ; falsifiable par qui contrôle son navigateur, acceptable parce que la divulgation dépend de la destination et non de l'origine ;
    - D11 : la CLI est cliente du control plane et vérificatrice hors ligne ; elle ne projette ni ne signe jamais ; une seule source d'état, d'audit et de politique ;
    - D12 : un déploiement par client, une organisation par déploiement ; `organization` sur chaque ressource et RLS sur chaque table gardés en défense en profondeur ; une clé de signature par déploiement, rotation, identifiant de clé dans chaque reçu, export des clés publiques ; rôles issus des revendications OIDC du client ; Biscuit Ed25519 pour la CLI, cookie `__Host-` pour le web ;
    - D13 : sortie v1.0 = projection seule, quatre profils `qualified` contre des instances réelles ; reproduction et Customer Edge Bridge en v1.1 ; la fiche reste sous `usable-verifiable` et le dit ;
  - `### Proof component` : `crates/policy-receipt/` (Rust, `crates/` réservé aux composants de preuve) compilé en WASM, monde WIT `libre-ai:signalement-policy-receipt/api@1.0.0`, chargé à l'identique par le control plane et la CLI ; FFI native écartée (deux artefacts) ; la clé secrète ne sort jamais du control plane ;
  - `### Fan-out and idempotency` : projection identifiée par (`organization`, Dossier, destination) ; première livraison = création, suivantes = commentaire ; clé d'idempotence = hachage de (projection, digest de l'export, version de mapping) ; outbox dans la transaction d'approbation ; attributs découverts relus avant envoi, changement ou politique retirée → `to-resolve`, lecture en échec = public ; issue ambiguë → recherche par marqueur via lecture fortement cohérente, sinon `to-resolve`, jamais de création à l'aveugle (cas mesuré : Jira Cloud n'offre pas de telle lecture, tâche 6) ; états indépendants par destination ;
  - `## Contracts` : les cinq identifiants de catalogue de la feuille de route §4.1, verbatim, avec leur rôle d'une ligne, et la règle « aucun schéma public redéfini ici » ;
  - `## Consequences and acceptance boundary` : critères de fiche ajoutés (`policy-routing`, `signed-receipt-offline`, `gesture-bound-delivery`, `stale-plan-refused`) et prédicat `destination-disclosure-leak` ; l'ADR ne qualifie aucun profil, n'active aucun connecteur, n'autorise aucune publication ;
  - `## Alternatives rejected` : Linear (D3), CLI autonome (D11), opérateur multi-organisation (D12), profils OAuth/App en v1.0, FFI native, routage par IA, politique gérée du navigateur, changement de sens de `public-data-leak`.
- [ ] **Vert.** `grep -cE '^### D(4|5|6|7|8|9|10|11|12|13) — ' docs/adr/<NEXT>-policy-routed-fan-out-and-signed-receipts.md` → `10`. `grep -cE 'signalement-(routing-policy|delivery-envelope|projection-receipt|connector-profile|policy-receipt)-v1' <ADR>` → au moins `5`. `grep -c 'libre-ai:signalement-policy-receipt/api@1.0.0' <ADR>` → `1`. `bun run check:public-boundary` après `git add` → exit 0.
- [ ] **Commit.** `git add docs/adr/<NEXT>-policy-routed-fan-out-and-signed-receipts.md && git commit -s -m "docs(adr): record policy-routed fan-out and signed receipts (ADR-<NEXT>)"`.

### Task 4: Fiche `project.v1.yaml` — critères v1.0 et prédicat d'arrêt

**Files:**
- Create : `tools/ci/project-card.test.ts`.
- Modify : `project.v1.yaml:24-28` (`current_situation`), `:76-91` (`kill_predicates`), `:123-137` (`capture-qualification`), `:138-152` (`multi-system-projection`), `:153-155` (`reproduce-verify`, ajout de `note`) ; `README.md:51-61` (régénéré, jamais à la main).
- Test : `tools/ci/project-card.test.ts`, `bun run check:card`, `heal-card-status.ts --check`.

**Interfaces:**
- Consumes : `validateCard(value: unknown): string[]` et `checkStatusSection(readme: string, card: unknown): string[]` de `@libre-ai/governance/ecosystem/project-cards` (précédent d'import profond : `tools/ci/public-boundary.ts:1-5`).
- Produces (identifiants exacts, cités par L2-L7) : critères `policy-routing`, `signed-receipt-offline`, `gesture-bound-delivery`, `stale-plan-refused` ; critères étendus `two-real-profiles`, `browser-matrix-real` ; prédicat `destination-disclosure-leak`.

- [ ] **Test qui échoue.** Créer `tools/ci/project-card.test.ts` :
  ```ts
  import { describe, expect, test } from "bun:test";
  import { existsSync } from "node:fs";
  import { join } from "node:path";

  import { checkStatusSection, validateCard } from "@libre-ai/governance/ecosystem/project-cards";

  interface Criterion {
    readonly id: string;
    readonly text: string;
  }
  interface Phase {
    readonly id: string;
    readonly exit_criteria: readonly Criterion[];
  }
  interface KillPredicate {
    readonly id: string;
    readonly source: string;
  }
  interface Card {
    readonly phases: readonly Phase[];
    readonly kill_predicates: readonly KillPredicate[];
  }

  const ROOT = join(import.meta.dir, "..", "..");
  const rawCard: unknown = Bun.YAML.parse(await Bun.file(join(ROOT, "project.v1.yaml")).text());
  const card = rawCard as Card;

  // Design §7 and roadmap §5: the identifiers lots L2 to L7 cite, with their phase.
  const V1_CRITERIA = [
    { phase: "capture-qualification", id: "browser-matrix-real" },
    { phase: "capture-qualification", id: "exact-disclosure-preview" },
    { phase: "capture-qualification", id: "gesture-bound-delivery" },
    { phase: "multi-system-projection", id: "two-real-profiles" },
    { phase: "multi-system-projection", id: "fanout-independent-state" },
    { phase: "multi-system-projection", id: "policy-routing" },
    { phase: "multi-system-projection", id: "signed-receipt-offline" },
    { phase: "multi-system-projection", id: "stale-plan-refused" },
  ] as const;

  const V1_KILL_PREDICATES = [
    "destination-disclosure-leak",
    "duplicate-external-item",
    "cross-organization-disclosure",
    "capability-overclaim",
  ] as const;

  function criterion(id: string): Criterion | undefined {
    return card.phases.flatMap((phase) => phase.exit_criteria).find((entry) => entry.id === id);
  }

  describe("project.v1.yaml", () => {
    test("passes the fleet card schema", () => {
      expect(validateCard(rawCard)).toEqual([]);
    });

    test("carries every v1.0 criterion in its declared phase", () => {
      for (const { phase, id } of V1_CRITERIA) {
        const owner = card.phases.find((entry) => entry.id === phase);
        expect(owner?.exit_criteria.map((entry) => entry.id)).toContain(id);
      }
    });

    test("criterion ids are unique across phases", () => {
      const ids = card.phases.flatMap((phase) => phase.exit_criteria.map((entry) => entry.id));
      expect(new Set(ids).size).toBe(ids.length);
    });

    test("two-real-profiles names the four D3 profiles", () => {
      const text = criterion("two-real-profiles")?.text ?? "";
      for (const family of ["GitHub Issues", "GitLab Issues", "Jira Cloud", "Plane"]) {
        expect(text).toContain(family);
      }
    });

    test("browser-matrix-real covers observed origin and delivery", () => {
      const text = criterion("browser-matrix-real")?.text ?? "";
      expect(text).toContain("origine observée");
      expect(text).toContain("remise");
    });

    test("declares the v1.0 kill predicates", () => {
      const ids = card.kill_predicates.map((entry) => entry.id);
      for (const id of V1_KILL_PREDICATES) expect(ids).toContain(id);
    });

    test("every kill predicate source resolves", () => {
      for (const { source } of card.kill_predicates) {
        expect(existsSync(join(ROOT, source.split("#", 1)[0] ?? ""))).toBe(true);
      }
    });

    test("README status section matches a fresh render of the card", async () => {
      const readme = await Bun.file(join(ROOT, "README.md")).text();
      expect(checkStatusSection(readme, rawCard)).toEqual([]);
    });
  });
  ```
- [ ] **Exécution rouge.** `bun test tools/ci/project-card.test.ts` → exit 1 ; échouent exactement `carries every v1.0 criterion in its declared phase`, `two-real-profiles names the four D3 profiles`, `browser-matrix-real covers observed origin and delivery`, `declares the v1.0 kill predicates`. Les quatre autres passent déjà : ce sont des gardes, leur rouge se prouve par neutralisation plus bas. `bun run typecheck` → exit 0. S'il échoue sur la résolution de `ajv/dist/2020` depuis `project-cards.ts`, ne pas affaiblir le test : remplacer l'import de `validateCard` par un appel à `bun run check:card` en processus fils (`Bun.spawn`, environnement purgé), garder `checkStatusSection` si lui se résout, et consigner l'écart dans la PR.
- [ ] **`current_situation` (lignes 24-28)**, remplacée par ce texte (présent honnête, aucune capacité planifiée au présent) :
  ```yaml
  current_situation: >-
    La fondation est publique. Une implémentation locale de capture relue, brouillons
    chiffrés et export portable est en validation, contre le contrat v1 verrouillé.
    La qualification complète des trois navigateurs reste ouverte. La v1.0 est
    spécifiée : projection d'un Dossier, routée par une politique d'organisation, vers
    GitHub Issues, GitLab Issues, Jira Cloud et Plane auto-hébergé, avec reçus signés ;
    le gel qui la bloquait est levé (ADR-0055 de project-governance). Aucun connecteur
    fournisseur, API serveur, control plane ni worker de reproduction n'est livré. La
    v1.0 exclut la reproduction : la fiche restera sous usable-verifiable à sa sortie.
  ```
- [ ] **Prédicat ajouté** à `kill_predicates`, après `capability-overclaim` :
  ```yaml
    - id: destination-disclosure-leak
      predicate: "un fichier retenu par la politique atteint une destination"
      source: qualification/acceptance-catalog.yaml
  ```
  Choix de source : même convention que `duplicate-external-item` ; l'entrée de catalogue `withheld-file-never-sent` (tâche 5) nomme la suite de projection (faux fournisseur de L3, `findLeaks`, puis instances réelles). `public-data-leak` garde son texte et sa source.
- [ ] **Phase `capture-qualification`.** `browser-matrix-real.text` devient « Chrome, Firefox et Safari passent chacun leur matrice réelle avec limites affichées, y compris la conservation de l'origine observée et la remise liée au geste vers l'origine configurée du control plane. » Ajouter, après `exact-disclosure-preview` :
  ```yaml
        - id: gesture-bound-delivery
          text: "Aucune injection de l'extension sans geste, sur une origine différente de l'origine configurée du control plane ou sans confirmation ; tests rouges prouvés par neutralisation."
          weight: 5
          status: pending
  ```
- [ ] **Phase `multi-system-projection`.** Ajouter `note: "v1.0 (D13 du design du 2026-10-22) : projection seule ; internal-standard-adapter reste pending, la phase ne se clôt donc pas en v1.0."` entre `title` et `exit_criteria`. `two-real-profiles.text` devient « GitHub Issues (github.com), GitLab Issues (gitlab.com), Jira Cloud et Plane auto-hébergé passent chacun, contre une instance réelle, découverte, création, ajout, pièce jointe ou repli déclaré, reprise et conflit ; résultat consigné dans qualification/provider-matrix.yaml. » (l'identifiant reste `two-real-profiles`, comme le fixe le design §7). Ajouter, après `fanout-independent-state` :
  ```yaml
        - id: policy-routing
          text: "Même export, même origine observée et même politique produisent le même plan ; une destination refusée n'est jamais nommée à la personne qui signale ; aucun transmit sans règle explicite."
          weight: 5
          status: pending
        - id: signed-receipt-offline
          text: "Un reçu de projection se vérifie hors ligne avec les seules clés publiques ; un octet modifié dans le reçu ou dans un fichier transmis fait échouer la vérification."
          weight: 5
          status: pending
        - id: stale-plan-refused
          text: "Un attribut découvert modifié ou une politique retirée entre l'approbation et l'envoi produit à résoudre, jamais un envoi."
          weight: 5
          status: pending
  ```
  Poids 5 : chacun garde un anti-but du design §2, comme les critères existants de poids 5.
- [ ] **Phase `reproduce-verify`.** Ajouter `note: "Hors v1.0 (D13 du design du 2026-10-22) : reportée en v1.1. Conséquence assumée : la fiche ne peut pas atteindre usable-verifiable à la sortie de la v1.0, qui exige un worker isolé."` entre `title` et `exit_criteria`. `maturity`, `exposure`, `confidence`, `promotion_criteria` et `freshness` restent inchangés : aucune preuve n'est re-vérifiée par ce lot.
- [ ] **README régénéré.** `bun node_modules/@libre-ai/governance/tools/presentation/heal-card-status.ts .` → la section est remplacée, puis `… heal-card-status.ts . --check` → `./README.md: status section already matches the card`, exit 0. La nouvelle ligne « Avancement » est celle que l'outil imprime ; ne pas la retoucher.
- [ ] **Exécution verte.** `git add project.v1.yaml README.md tools/ci/project-card.test.ts`, puis `bun test tools/ci/project-card.test.ts` → 8 pass, 0 fail ; `bun run check:card` → `Project cards verified: 1 assertion(s) hold` ; `grep -A3 -E 'id: (policy-routing|signed-receipt-offline|gesture-bound-delivery|stale-plan-refused)$' project.v1.yaml | grep -c 'status: pending'` → `4`.
- [ ] **Neutralisation** (fichiers indexés, chaque mutation annulée par `git restore <fichier>` avant la suivante) :
  - dans `project.v1.yaml`, recopier le bloc `policy-routing` dans `reproduce-verify` → `criterion ids are unique across phases` rouge ;
  - remplacer la `source` de `destination-disclosure-leak` par `qualification/missing.yaml` → `every kill predicate source resolves` rouge ;
  - dans `README.md:59`, remplacer la valeur d'« Avancement » par `0,1 %` → `README status section matches a fresh render of the card` rouge ;
  - passer `stale-plan-refused` à `status: accepted` sans `evidence` → `passes the fleet card schema` rouge (prouve que `validateCard` est bien branché).
  Consigner les quatre sorties rouges dans la description de PR, avec la réponse à la question 2 de gate-integrity §5 : un refactor de la fiche qui garde identifiants, phases et liens ne fait rougir aucun de ces tests ; seul un changement de contrat entre lots le fait.
- [ ] **Commit.** `git add project.v1.yaml README.md tools/ci/project-card.test.ts && git commit -s -m "feat(card): declare v1.0 criteria and the destination-disclosure-leak predicate"`.
