# Signalement v1.0 — L0 gouvernance locale, partie 2 (tâches 5 à 9)

Index, Global Constraints et Review Focus : `docs/superpowers/plans/2026-10-24-v1-L0-governance.md`. Partie précédente : `docs/superpowers/plans/2026-10-24-v1-L0-governance-part-1.md`.

Dans les tableaux ci-dessous, `DESIGN` = `docs/superpowers/specs/2026-10-22-v1-policy-routed-ticket-projection-design.md` et `ADR-NEW` = `docs/adr/<NEXT>-policy-routed-fan-out-and-signed-receipts.md`. Le statut de chaque ligne est donné ; aucune ligne neuve n'est `verified` si elle affirme une propriété non encore prouvée.

---

### Task 5: Qualification — catalogue, menaces, risques, verrous de décision

**Files:**
- Modify : `qualification/acceptance-catalog.yaml:4-14`, `qualification/threat-model.yaml:3-28`, `qualification/risk-register.yaml:3-28`, `qualification/decision-lock.yaml:3-28`.
- Test : `bun run check:qualification` (après `git add`), suite existante `tools/ci/qualification.test.ts`.

**Interfaces:**
- Consumes : `ADR-NEW` (tâche 3), `docs/adr/0005-local-vault-and-reviewed-export.md` (tâche 2), design §5.2-§5.7 et §7.
- Produces : identifiants de qualification `withheld-file-never-sent`, `revision-adds-comment`, `cross-organization-sql-refusal`, `qualified-profiles-only` (catalogue) ; `spoofed-observed-origin`, `wrong-origin-delivery`, `withheld-file-egress`, `denied-destination-disclosure`, `stale-plan-dispatch`, `ambiguous-outcome-duplicate` (menaces) ; `consistent-read-unavailable`, `delivery-memory-bound`, `qualification-accounts-missing`, `self-hosted-version-drift`, `receipt-signing-key-leak` (risques) ; `policy-routed-projection`, `signed-projection-receipt`, `control-plane-cli-client`, `single-organization-deployment`, `policy-receipt-wasm-component`, `gesture-bound-delivery-surface` (verrous).

- [ ] **`acceptance-catalog.yaml`** (forme en flux, comme les lignes existantes). `no-duplicate-resume.statement` devient « On each of the four v1.0 profiles, a cut injected after the request is sent and before the response arrives yields exactly one remote item; a resume never creates a second one. » Ajouter :

  | id | status | statement | source | reopens_on |
  | --- | --- | --- | --- | --- |
  | `withheld-file-never-sent` | unresolved | A file the policy withholds for a destination appears in no outbound request to it, captured first by the fake provider, then against each real qualified instance; a failed visibility read withholds. | `project.v1.yaml#kill_predicates` | policy evaluation, disclosure plan, renderer, or connector change |
  | `revision-adds-comment` | unresolved | A later approved revision of the same Dossier publishes a comment on the existing remote item, never a new item. | `project.v1.yaml#kill_predicates` | delivery state-machine or connector change |
  | `cross-organization-sql-refusal` | unresolved | With two organizations in one test database, a direct SQL read or write across organizations by the application role, which lacks BYPASSRLS, is refused on every table carrying organization data. | `project.v1.yaml#kill_predicates` | schema, RLS policy, or database role change |
  | `qualified-profiles-only` | unresolved | The interface and the API list as available only the profiles marked qualified in the provider matrix; configuring a destination whose discovery matches no qualified profile is refused. | `project.v1.yaml#kill_predicates` | provider matrix, discovery, or profile listing change |

- [ ] **`threat-model.yaml`** (forme en bloc, comme les lignes existantes). Ajouter :

  | id | status | statement | source | reopens_on |
  | --- | --- | --- | --- | --- |
  | `spoofed-observed-origin` | unresolved | A person who controls the browser can forge the observed origin; forging only reroutes to a destination the approved policy already authorizes, because disclosure rules key on destination attributes, never on the origin. | `DESIGN#52-origine-observée-et-remise-de-lextension-au-control-plane` | routing or disclosure rule semantics change |
  | `wrong-origin-delivery` | unresolved | The extension injects nothing without a user gesture, an exact scheme, host, and port match with the configured control-plane origin, and an explicit confirmation; the injected function is fixed, reads nothing from the page, and posts only to the explicit target origin. | `docs/adr/0005-local-vault-and-reviewed-export.md` | manifest permission, injected function, or delivery protocol change |
  | `withheld-file-egress` | unresolved | A withheld file, or a file whose destination visibility could not be read, never reaches that destination. | `project.v1.yaml#kill_predicates` | policy evaluation, renderer, or connector change |
  | `denied-destination-disclosure` | unresolved | The reporting person sees only the count of destinations the matched rule denies, never their names or reasons; the detail is readable only by policy administrators in the audit log. | `DESIGN#54-écran-denvoi` | send screen, plan API, or audit access change |
  | `stale-plan-dispatch` | unresolved | A discovered attribute changed or a policy version retired between approval and dispatch yields to-resolve and a new approval, never a send; a failed attribute read counts as public. | `DESIGN#55-projection-idempotence-et-reçus` | dispatcher, revalidation, or policy lifecycle change |
  | `ambiguous-outcome-duplicate` | unresolved | After a lost response, the connector looks up the remote item by projection marker or external_id through a strongly consistent read; without one, the delivery goes to to-resolve, never to a blind create. | `DESIGN#55-projection-idempotence-et-reçus` | connector lookup or provider API change |

- [ ] **`risk-register.yaml`**. Ajouter :

  | id | status | statement | source | reopens_on |
  | --- | --- | --- | --- | --- |
  | `consistent-read-unavailable` | unresolved | Jira Cloud offers no strongly consistent lookup (measured 2026-10-24, assumption jira-consistent-read): every ambiguous Jira create goes to human resolution. GitHub, GitLab, and Plane carry the same risk until their lookup is proven. | `qualification/assumptions.yaml` | per-profile consistent-read qualification |
  | `delivery-memory-bound` | unresolved | Chunked delivery memory near the export size limit is unmeasured on each browser. | `DESIGN#52-origine-observée-et-remise-de-lextension-au-control-plane` | per-browser delivery measurement |
  | `qualification-accounts-missing` | unresolved | Without owner-created GitLab.com and Jira Cloud qualification accounts, two profiles stay unresolved and v1.0 does not ship (D13). | `DESIGN#3-contraintes` | account provisioning through a secrets channel |
  | `self-hosted-version-drift` | unresolved | A self-hosted Plane instance on a version other than the qualified one is refused at destination configuration. | `qualification/provider-matrix.yaml` | Plane version or REST API change |
  | `receipt-signing-key-leak` | unresolved | A leaked deployment signing key lets an attacker forge receipts until rotation; receipts carry a key id and public keys are exported with their retirement. | `ADR-NEW` | key storage, rotation, or receipt format change |

  `qualification/assumptions.yaml` est une source déjà indexée ; ses entrées v1.0 arrivent à la tâche 6.
- [ ] **`decision-lock.yaml`**. Ajouter (ces lignes enregistrent des décisions d'architecture approuvées, d'où `verified` au sens de `qualification/README.md`) :

  | id | status | statement | source | reopens_on |
  | --- | --- | --- | --- | --- |
  | `policy-routed-projection` | verified | Destinations and per-file disclosure come from an approved, versioned organization policy evaluated on the observed origin; no rule matched means no destination, and the reporting person can only withhold more. | `ADR-NEW` | owner change to D6 or D10 |
  | `signed-projection-receipt` | verified | Each successful delivery produces a JCS-canonicalized, Ed25519-signed receipt verifiable offline; the local export contract v1 is unchanged. | `ADR-NEW` | owner change to D7 |
  | `control-plane-cli-client` | verified | The CLI is a control-plane client and an offline verifier; it never projects or signs. | `ADR-NEW` | owner change to D11 |
  | `single-organization-deployment` | verified | Each customer self-hosts one single-organization deployment with one signing key; organization columns and RLS remain as defense in depth. | `ADR-NEW` | owner change to D12 |
  | `policy-receipt-wasm-component` | verified | Policy evaluation, canonicalization, and receipt signature and verification live in one Rust crate compiled to WASM and loaded identically by the control plane and the CLI. | `ADR-NEW` | measured incompatibility of the WASM component on one surface |
  | `gesture-bound-delivery-surface` | verified | The extension permission surface is voluntary active-tab capture, observed origin retention, and gesture-bound delivery to one configured origin; no host permission, content script, or network access. | `docs/adr/0005-local-vault-and-reviewed-export.md` | owner change to D8 or a browser that cannot honour the bound |

  `field-conflict-authority` reste `unresolved` et inchangé : la v1.0 lit l'état distant sans écrire de champ du Dossier.
- [ ] **Exécution verte.** `git add qualification/acceptance-catalog.yaml qualification/threat-model.yaml qualification/risk-register.yaml qualification/decision-lock.yaml`, puis `bun run check:qualification` → `Qualification baseline verified: 8 document(s), 0 findings` ; `bun test tools/ci/qualification.test.ts tools/ci/check-qualification.test.ts` → 0 fail.
- [ ] **Neutralisation.** Remplacer, dans l'index, la source de `policy-routed-projection` par `docs/adr/9999-missing.md` (`git add` de la mutation) → `bun run check:qualification` exit 1 avec `qualification/decision-lock.yaml: missing-source (docs/adr/9999-missing.md)`. Restaurer par Edit, `git add`, revert vert.
- [ ] **Commit.** `git add qualification/acceptance-catalog.yaml qualification/threat-model.yaml qualification/risk-register.yaml qualification/decision-lock.yaml && git commit -s -m "docs(qualification): add v1.0 acceptance tests, threats, risks and decision locks"`.

### Task 6: Qualification — hypothèses, matrice fournisseurs, matrice navigateurs

**Files:**
- Create : `tools/ci/qualification-v1.test.ts`.
- Modify : `qualification/assumptions.yaml:3-23`, `qualification/provider-matrix.yaml:4,6,8,24` (lignes `github-issues`, `jira-cloud`, `gitlab-issues`, `plane`), `qualification/browser-matrix.yaml:4-18`.
- Test : `tools/ci/qualification-v1.test.ts`, `bun run check:qualification`.

**Interfaces:**
- Consumes : identifiants de profil de la feuille de route §4.1 ; feuille de route §6 (GitLab confirmée, Jira infirmée) ; `qualification/acceptance-catalog.yaml#withheld-file-never-sent` (tâche 5) ; prédicat `destination-disclosure-leak` (tâche 4) ; champ `profile` que L5 ajoutera (feuille de route §4.5), sans l'écrire.
- Produces : hypothèses `github-consistent-read`, `gitlab-consistent-read`, `jira-consistent-read`, `plane-attachments`, `plane-external-id-read`, `injection-arguments-json`, `gitlab-project-token-tier`, `managed-browser-policy-unavailable` ; lignes de matrice v1.0 liées à leur profil exact.

- [ ] **Test qui échoue.** Créer `tools/ci/qualification-v1.test.ts` :
  ```ts
  import { describe, expect, test } from "bun:test";
  import { join } from "node:path";

  interface Entry {
    readonly id: string;
    readonly status: string;
    readonly statement: string;
    readonly source: string;
    readonly profile?: string;
  }
  interface Document {
    readonly entries: readonly Entry[];
  }

  const ROOT = join(import.meta.dir, "..", "..");

  async function entries(path: string): Promise<readonly Entry[]> {
    const parsed = Bun.YAML.parse(await Bun.file(join(ROOT, path)).text()) as Document;
    return parsed.entries;
  }

  // Roadmap §4.1: exact v1.0 profile identifiers. A matrix row keeps its family id
  // (SAFE_ID forbids "/"). L0 binds the profile through the statement prefix; L5 adds
  // a `profile` field (roadmap §4.5), which then takes precedence.
  const V1_PROFILES = {
    "github-issues": "github-issues/github.com/rest-2022-11-28",
    "gitlab-issues": "gitlab-issues/gitlab.com/rest-v4",
    "jira-cloud": "jira-cloud/cloud/rest-v3",
    plane: "plane/self-hosted/rest-v1",
  } as const;

  describe("v1.0 qualification links", () => {
    test("each v1.0 provider row is bound to its exact registry profile", async () => {
      const rows = await entries("qualification/provider-matrix.yaml");
      for (const [family, profileId] of Object.entries(V1_PROFILES)) {
        const row = rows.find((entry) => entry.id === family);
        const bound = row?.profile ?? row?.statement.split(": ", 1)[0];
        expect(bound).toBe(profileId);
      }
    });

    test("destination-disclosure-leak resolves to a catalog entry bound to the card", async () => {
      const card = Bun.YAML.parse(await Bun.file(join(ROOT, "project.v1.yaml")).text()) as {
        kill_predicates: readonly { id: string; source: string }[];
      };
      const predicate = card.kill_predicates.find((entry) => entry.id === "destination-disclosure-leak");
      expect(predicate?.source).toBe("qualification/acceptance-catalog.yaml");
      const catalog = await entries("qualification/acceptance-catalog.yaml");
      const linked = catalog.find((entry) => entry.id === "withheld-file-never-sent");
      expect(linked?.source).toBe("project.v1.yaml#kill_predicates");
    });
  });
  ```
  Le test ne fige aucun statut : L5 passera ces lignes à `qualified` sans le faire rougir. Il reste vert si L5 retire le préfixe d'un `statement` **et** pose le champ `profile` exact dans le même commit ; il rougit si L5 retire le préfixe sans poser `profile`.
- [ ] **Exécution rouge.** `bun test tools/ci/qualification-v1.test.ts` → `each v1.0 provider row is bound to its exact registry profile` échoue ; l'autre passe déjà (tâches 4 et 5).
- [ ] **`assumptions.yaml`**. Ajouter :

  | id | status | statement | source | reopens_on |
  | --- | --- | --- | --- | --- |
  | `github-consistent-read` | assumed | The repository issue list endpoint, not search, is a strongly consistent read that finds a projection marker after an ambiguous create on github-issues/github.com/rest-2022-11-28. | `DESIGN#56-profils-exacts-visés` | first live ambiguous-outcome qualification on the GitHub profile |
  | `gitlab-consistent-read` | assumed | The project-filtered issue list is a strongly consistent read that finds a projection marker on gitlab-issues/gitlab.com/rest-v4. | `DESIGN#56-profils-exacts-visés` | first live ambiguous-outcome qualification on the GitLab profile |
  | `jira-consistent-read` | rejected | Measured 2026-10-24 from the Atlassian documentation (search and reconcile): Jira Cloud search is not a strongly consistent read, so jira-cloud/cloud/rest-v3 declares its lookup unsupported and every ambiguous Jira create ends in to-resolve, never in a retried create. | `DESIGN#56-profils-exacts-visés` | Atlassian documentation of a strongly consistent issue lookup |
  | `plane-attachments` | assumed | Work-item attachments are available through REST v1 on the pinned self-hosted Plane version; otherwise the profile declares link or withhold. | `DESIGN#56-profils-exacts-visés` | Plane qualification on the pinned version |
  | `plane-external-id-read` | assumed | external_id and external_source give a strongly consistent lookup on the pinned self-hosted Plane version. | `DESIGN#56-profils-exacts-visés` | Plane qualification on the pinned version |
  | `injection-arguments-json` | assumed | scripting.executeScript passes func arguments as JSON on Chrome, Firefox, and Safari, so the export travels as bounded base64 chunks. | `DESIGN#52-origine-observée-et-remise-de-lextension-au-control-plane` | first per-browser delivery qualification |
  | `gitlab-project-token-tier` | unresolved | Measured 2026-10-24 from the GitLab documentation: "On GitLab.com, project access tokens require a Premium or Ultimate subscription." The open item is the owner's choice between a dedicated-account personal access token with api scope and a paid subscription (Task 7). | `DESIGN#56-profils-exacts-visés` | owner choice of the GitLab credential, or a GitLab.com pricing change |
  | `managed-browser-policy-unavailable` | assumed | A managed browser policy cannot set the control-plane origin equivalently on Chrome, Firefox, and Safari without the storage permission. | `DESIGN#2-buts-non-buts-anti-buts` | official managed-storage review per browser |

  Statuts : `jira-consistent-read` est `rejected` parce que l'hypothèse est infirmée et que s'appuyer sur cette lecture est exclu ; `gitlab-project-token-tier` est `unresolved` parce que le fait est mesuré mais que la décision qui en découle est ouverte, et passe à `verified` à la tâche 7 une fois le choix consigné. `provider-idempotency` reste en place : les hypothèses de lecture cohérente la précisent par profil sans la remplacer.
- [ ] **`provider-matrix.yaml`**, quatre lignes réécrites (`status: unresolved` gardé, `source` = `DESIGN#56-profils-exacts-visés`, `reopens_on` gardé, aucun champ `profile` : c'est L5) :
  - `github-issues` : « github-issues/github.com/rest-2022-11-28: GitHub Issues on github.com, REST API version 2022-11-28, fine-grained token scoped to one repository; no attachment upload API (link or withhold); v1.0 target (design D3). »
  - `gitlab-issues` : « gitlab-issues/gitlab.com/rest-v4: GitLab Issues on gitlab.com, REST v4; credential pending the owner's choice (assumption gitlab-project-token-tier: project access tokens require Premium or Ultimate); internal visibility treated as public; v1.0 target (design D3). »
  - `jira-cloud` : « jira-cloud/cloud/rest-v3: Jira Cloud, REST v3, API token of a service account; visibility declared by the administrator; no strongly consistent lookup, so ambiguous creates go to to-resolve (assumption jira-consistent-read); v1.0 target (design D3). »
  - `plane` : « plane/self-hosted/rest-v1: Plane self-hosted, REST API v1, workspace API key; exact Plane version pinned at qualification; visibility declared by the administrator; v1.0 target (design D3). »
  Les 22 autres lignes restent inchangées (hors v1.0, non rejetées).
- [ ] **`browser-matrix.yaml`.** Chrome et Firefox : insérer « observed-origin retention, gesture-bound delivery to the configured control-plane origin, » avant « and scenario export ». Safari : le `statement` devient « Safari stable Web Extension capture, observed-origin retention, gesture-bound delivery to the configured control-plane origin, and safaridriver execution pass on pinned macOS and Apple hardware. » Ajouter « or delivery protocol change » à chaque `reopens_on`. Statuts inchangés : `unresolved`.
- [ ] **Exécution verte.** `git add qualification/assumptions.yaml qualification/provider-matrix.yaml qualification/browser-matrix.yaml tools/ci/qualification-v1.test.ts`, puis `bun test tools/ci/qualification-v1.test.ts` → 2 pass ; `bun run check:qualification` → `Qualification baseline verified: 8 document(s), 0 findings` ; `grep -cE '^  - \{ id: (github-issues|gitlab-issues|jira-cloud|plane), status: unresolved' qualification/provider-matrix.yaml` → `4`.
- [ ] **Neutralisation.** Dans `provider-matrix.yaml`, remplacer `rest-v4` par `rest-v3` dans la ligne `gitlab-issues` → `each v1.0 provider row is bound to its exact registry profile` rouge. Dans `acceptance-catalog.yaml`, renommer `withheld-file-never-sent` en `withheld-file-not-sent` → le second test rouge. `git restore` de chaque fichier entre les deux.
- [ ] **Commit.** `git add qualification/assumptions.yaml qualification/provider-matrix.yaml qualification/browser-matrix.yaml tools/ci/qualification-v1.test.ts && git commit -s -m "docs(qualification): bind v1.0 provider rows to exact profiles and record design assumptions"`.

### Task 7: Corrections du design §5.6 et §5.2 — faits mesurés et choix du propriétaire

**Files:**
- Modify : `DESIGN`, cellule « Lecture cohérente » de la ligne Jira du §5.6 (`grep -n '^| Jira Cloud' DESIGN`) ; cellule « Authentification v1.0 » de la ligne GitLab du §5.6 (`grep -n '^| GitLab Issues' DESIGN`) ; point 5 de la séquence de remise du §5.2 (`grep -n "La page vérifie l'export (inventaire" DESIGN`) ; `qualification/assumptions.yaml` (`gitlab-project-token-tier`) ; `qualification/provider-matrix.yaml:8` (`gitlab-issues`).
- Test : commandes `grep`, `bun run check:qualification`, `bun test tools/ci/qualification-v1.test.ts`.

**Interfaces:**
- Consumes : feuille de route §6 (GitLab confirmée, Jira infirmée) et §4.5 (vérification de l'export : transport côté page, verdict `verifyExport` côté serveur) ; décisions du propriétaire posées à la tâche 0.
- Produces : la cellule d'authentification GitLab du design, que la fixture `contracts/fixtures/signalement-connector-profile-v1/profiles.v1.json` de L1 reprend **avant son verrou** (feuille de route §6), et le texte du §5.2 que L6 implémente.

Trois sous-étapes indépendantes, un commit chacune. A est inconditionnelle ; B et C n'appliquent que l'option retenue par le propriétaire. Sans réponse au moment de la tâche, B ou C est sautée, rien n'est modifié, et la PR la liste comme « en attente du propriétaire ».

- [ ] **A — Jira, rouge.** `grep -n '^| Jira Cloud' DESIGN | grep -c "à prouver"` → `1`.
- [ ] **A — Jira, correction.** La cellule « JQL ou propriété d'entité — à prouver, sinon `à résoudre` » devient « aucune — infirmée le 2026-10-24 (documentation Atlassian, *search and reconcile*) : toute création ambiguë finit en `à résoudre` ». Les autres cellules de la ligne restent.
- [ ] **A — Jira, vert et commit.** Même commande → `0`. `git add DESIGN && git commit -s -m "docs(spec): record that Jira Cloud has no strongly consistent lookup"`.
- [ ] **B — GitLab, question au propriétaire** (si non tranchée), contexte restitué : la doc GitLab dit « On GitLab.com, project access tokens require a Premium or Ultimate subscription » (mesuré le 2026-10-24). Options :
  1. *Jeton personnel de portée `api` d'un compte dédié.* Coût nul. Le jeton agit avec tous les droits du compte : le compte n'est membre que des projets cibles, au rôle minimal qui permet de créer une issue et de commenter. Portée plus large qu'un jeton de projet, bornée par l'appartenance.
  2. *Abonnement Premium ou Ultimate.* Garde le jeton d'accès de projet, limité à un projet. Coût récurrent pour chaque client qui qualifie gitlab.com, et pour le compte de qualification.
- [ ] **B — GitLab, rouge.** `grep -n '^| GitLab Issues' DESIGN | grep -c "jeton d'accès de projet |"` → `1`.
- [ ] **B — GitLab, correction selon l'option.** Option 1 : la cellule devient « jeton personnel de portée `api` d'un compte dédié, membre des seuls projets cibles au rôle minimal (les jetons d'accès de projet exigent Premium ou Ultimate sur gitlab.com, mesuré le 2026-10-24) ». Option 2 : « jeton d'accès de projet (abonnement Premium ou Ultimate requis sur gitlab.com, mesuré le 2026-10-24) ». Dans `assumptions.yaml`, `gitlab-project-token-tier` passe à `verified`, son `statement` garde la citation et ajoute « Owner decision <DATE>: <option retenue, en anglais>. », `reopens_on` devient « GitLab.com pricing or token model change ». Dans `provider-matrix.yaml`, le `statement` de `gitlab-issues` remplace « credential pending the owner's choice (…) » par l'identifiant retenu (« personal access token with api scope of a dedicated account » ou « project access token on a Premium or Ultimate subscription »), en gardant le préfixe `gitlab-issues/gitlab.com/rest-v4: `.
- [ ] **B — GitLab, vert et commit.** Même `grep` qu'au rouge → `0` ; `git add DESIGN qualification/assumptions.yaml qualification/provider-matrix.yaml` ; `bun run check:qualification` → 0 findings ; `bun test tools/ci/qualification-v1.test.ts` → 2 pass. `git commit -s -m "docs(spec): set the GitLab.com credential after the project-token tier finding"`. Signaler à L1 que la fixture des profils doit reprendre cette cellule avant son verrou.
- [ ] **C — §5.2 point 5, question au propriétaire** (si non tranchée), contexte restitué (feuille de route §4.5) : le vérificateur vendorisé ne tourne pas en navigateur (`node:crypto`, `Bun.file` au chargement, Ajv compilé à l'exécution qui exigerait `unsafe-eval`). Options :
  1. *Transport côté page, verdict côté serveur.* La page vérifie longueur, SHA-256 annoncé, lisibilité de l'archive par `readZip` et présence de `manifest.json` ; le serveur rend le verdict `verifyExport`, que la page affiche. La CSP reste sans `unsafe-eval`. Le verdict de conformité dépend du serveur.
  2. *Verdict complet côté page, comme le dit le design.* Exige un vérificateur navigateur (validateur précompilé, WebCrypto) à construire en L6 ; même verdict avant téléversement, au prix d'un second vérificateur à tenir identique au premier.
- [ ] **C — rouge** (option 1 seulement). `grep -c "La page vérifie l'export (inventaire, longueurs, digests, contrat)" DESIGN` → `1`.
- [ ] **C — correction** (option 1). Le point 5 devient : « 5. La page vérifie le **transport** (longueur, SHA-256 annoncé dans l'enveloppe, archive lisible, présence de `manifest.json`), puis téléverse l'export avec l'origine observée vers le control plane. Le serveur rend le verdict de conformité (`verifyExport`, le même vérificateur que `verify-export.ts`) avant de créer ou réviser le Dossier ; la page affiche ce verdict. Motif : le vérificateur vendorisé ne tourne pas en navigateur sans `unsafe-eval`. Décision du propriétaire du <DATE>. » Option 2 : aucune modification du design ; noter dans la PR que L6 doit fournir un vérificateur navigateur.
- [ ] **C — vert et commit** (option 1). Même `grep` → `0` ; `grep -c 'verdict de conformité' DESIGN` → au moins `1`. `git add DESIGN && git commit -s -m "docs(spec): move the export conformance verdict to the control plane"`.

### Task 8: Chemin de revue, artefact et PR

**Files:**
- Create : `docs/reviews/v1-governance-<DATE sans tirets>/README.md`, `docs/reviews/v1-governance-<DATE sans tirets>/governance-review.json`.
- Test : `jq`, `shasum -a 256 -c`, `bun run check`.

**Interfaces:**
- Consumes : les fichiers modifiés par les tâches 1 à 7.
- Produces : artefact de revue cité par la PR ; PR ouverte vers `main`.

**Ce qui garde ces chemins, mesuré le 2026-10-24 (à rejouer avant de s'en servir) :**
- Checks requis sur `main` : `gh api repos/libre-ai/signalement/branches/main --jq '.protection.required_status_checks.contexts'` → `["Bun quality","licensing / Licensing and contribution governance"]`. `gh api repos/libre-ai/signalement/rulesets` → `[]`. « Bun quality » exécute `bun run check:tree` (`.github/workflows/ci.yml`), donc `check:card`, `check:qualification` et `bun test` ; « licensing » vérifie DCO et REUSE (`reusable-licensing.yml`, épinglé dans `ci.yml`).
- Le gate de revue de la flotte, `tools/quality/check-review-evidence.ts` de `project-governance`, n'est appelé que par le `ci.yml` de `project-governance` (`node_modules/@libre-ai/governance/.github/workflows/ci.yml:218`). Aucun workflow de `signalement` ne l'appelle (`grep -rn review-evidence .github/` → aucune sortie). L'exigence d'artefact sur `docs/adr/**`, `project.v1.yaml` et `qualification/**` (feuille de route §1) tient donc par la PR et la fusion propriétaire, sans mécanisme qui la bloque.
- **Défaut connu, non corrigé ici.** À la révision épinglée (`package.json`, `@libre-ai/governance#…`), `check-review-evidence.ts:96` cherche le marqueur d'arbitrage dans tout le texte du diff, lignes de contexte comprises (`findEvidenceSignals("diff", diffText)`, `:118`). Un vert de ce gate ne prouve pas qu'un marqueur a été ajouté par la PR : il peut venir d'une ligne voisine déjà fusionnée. La tête servie de `project-governance` documente une correction datée du 2026-10-23 (lignes ajoutées seulement, artefact cité devant exister dans l'arbre) : `gh api repos/libre-ai/project-governance/contents/tools/quality/check-review-evidence.ts --jq .content | base64 -d | sed -n '55,73p'`. `signalement` n'en bénéficie pas tant que son épinglage n'a pas bougé, et de toute façon ne l'exécute pas.
- Précédent d'artefact : `docs/reviews/local-capture-20261007/` — un `README.md` qui situe les rapports et leurs limites, et un JSON par passe, lié aux SHA-256 des fichiers relus.

- [ ] **Hachages.** `git diff --name-only "$BASE"...HEAD` → la liste des fichiers des tâches 1 à 7 ; `shasum -a 256 $(git diff --name-only "$BASE"...HEAD)` → table des hachages, entrée du relecteur.
- [ ] **Passe de revue indépendante.** Lancer un relecteur en lecture seule, distinct de l'auteur, avec un mandat aux sept rubriques (rôle ; périmètre = `$WT`, fichiers de la liste, design et feuille de route, dépôts frères hors scope ; contraintes = lecture seule, rendu en texte, aucun fichier écrit ; faits volatils = `git rev-parse HEAD` et la commande de hachage ci-dessus ; format = JSON aux clés du précédent `docs/reviews/local-capture-20261007/export-review.json` : `reviewPassId`, `reviewer` (nom de rôle, aucun chemin machine), `provider`, `model` (« exact identifier unavailable » si inconnu), `scope`, `sourceHashes`, `authorityCommit` (commit de fusion d'ADR-0055, par `gh pr view 134 …`), `findings`, `resolvedFindings`, `checks` (commande + `exitCode`), `limitations`, `verdict`, `sourceFilesModifiedByReviewer: false` ; critère de fin ; délégation 0). Lui donner le code, pas les conclusions de l'auteur. Questions imposées :
  1. chaque décision D4-D13 du design §4 apparaît dans le nouvel ADR avec une conséquence fidèle ;
  2. la phrase de surface de permission d'ADR-0005 est celle du design §5.2, mot pour mot ;
  3. les identifiants de la fiche égalent ceux du design §7 et de la feuille de route §5, casse comprise ; aucun critère neuf n'est `accepted` ; `maturity` et `exposure` sont inchangés ;
  4. aucune ligne de qualification neuve n'est `verified` sur une propriété non prouvée (`capability-overclaim`) ; les quatre lignes v1.0 de la matrice sont `unresolved` et liées au profil exact ;
  5. le statut du design est exact au regard d'ADR-0055 fusionné ; les corrections de la tâche 7 n'appliquent que des options effectivement retenues par le propriétaire ;
  6. aucun marqueur d'arbitrage daté n'est ajouté par la branche.
- [ ] **Écrire l'artefact.** L'orchestrateur écrit le JSON rendu, octets inchangés, dans `governance-review.json` ; puis `README.md` (portée, liste des fichiers, ce que la revue ne prouve pas : ni qualification fournisseur ou navigateur, ni consentement, ni arbitrage ; mention du défaut connu de `check-review-evidence.ts:96`). Vérifier : `jq -e '.verdict and .sourceHashes and (.sourceFilesModifiedByReviewer == false)' governance-review.json` → `true` ; `jq -r '.sourceHashes | to_entries[] | "\(.value)  \(.key)"' governance-review.json | shasum -a 256 -c` → chaque ligne `OK`.
- [ ] **Constats.** Un constat ouvert : corriger dans la tâche propriétaire, nouveau commit, nouvelle passe sur les nouveaux hachages, constat déplacé dans `resolvedFindings`. Ne jamais éditer le JSON du relecteur à la main.
- [ ] **Gate complet.** `git add docs/reviews/v1-governance-*/`, puis `bun run check` → exit 0.
- [ ] **Commit.** `git add docs/reviews/v1-governance-*/README.md docs/reviews/v1-governance-*/governance-review.json && git commit -s -m "docs(reviews): add the v1.0 governance review record"`.
- [ ] **Aucun marqueur écrit par l'agent.** `git diff "$BASE"...HEAD | grep -iE '^\+.*owner-arbitration:[[:space:]]*[0-9]{4}-[0-9]{2}-[0-9]{2}'` → aucune sortie, exit 1. `git log --format=%B "$BASE"..HEAD | grep -icE 'owner-arbitration:[[:space:]]*[0-9]{4}'` → `0`.
- [ ] **PR.** `git push -u origin v1/l0-governance`. Corps écrit par l'outil Write dans un fichier de `mktemp -d` : résumé par tâche ; sous-étapes de la tâche 7 appliquées ou en attente ; chemin `docs/reviews/v1-governance-<DATE sans tirets>/README.md` ; les sorties de neutralisation des tâches 4 à 6 et la réponse à la question 2 de gate-integrity §5 ; le constat « aucun mécanisme ne garde ces chemins dans `signalement` » et le défaut connu de `check-review-evidence.ts:96` ; la phrase « La ligne d'arbitrage daté est écrite par le propriétaire. » `gh pr create --base main --head v1/l0-governance --title "docs: v1.0 local governance (ADR-0005 amendment, ADR-<NEXT>, card criteria, qualification)" --body-file <fichier>`. Puis `gh pr view --json body --jq .body | grep -icE 'owner-arbitration:[[:space:]]*[0-9]{4}'` → `0`.
- [ ] **Checks requis.** Interroger `gh pr checks <n> --required` toutes les 60 s jusqu'à état terminal ; « Bun quality » et « licensing / Licensing and contribution governance » → `pass`. Un `fail` se diagnostique, ne se relance pas à l'aveugle.
- [ ] **Remise au propriétaire.** Le propriétaire relit, écrit sa ligne d'arbitrage daté (corps de PR ou message de fusion), puis la PR est fusionnée en squash avec sign-off DCO dans le message de fusion. L'agent ne fusionne pas cette PR tant que la ligne n'existe pas.

### Task 9: Critère de sortie de L0 sur `main`, retrait du worktree

**Files:** aucun.

**Interfaces:**
- Consumes : la PR de la tâche 8, fusionnée.
- Produces : critère de sortie L0 de la feuille de route §2, vérifié.

- [ ] **Fusion constatée.** `gh pr view <n> --json state,mergeCommit --jq '"\(.state) \(.mergeCommit.oid)"'` → `MERGED <sha>`. `git fetch origin`, `git -C "$WT" switch --detach origin/main`.
- [ ] **Gate sur `main`.** Dans `$WT` : `bun install --frozen-lockfile && bun run check` → exit 0.
- [ ] **Critère de sortie, élément par élément** (feuille de route §2, L0) :
  - ADR-0005 amendé : `grep -c "observed origin retention, and gesture-bound delivery to one configured origin" docs/adr/0005-local-vault-and-reviewed-export.md` → `1` ;
  - nouvel ADR fusionné : `ls docs/adr/<NEXT>-policy-routed-fan-out-and-signed-receipts.md` → présent ;
  - fiche : `bun test tools/ci/project-card.test.ts tools/ci/qualification-v1.test.ts` → 10 pass, 0 fail ; `bun run check:card` et `bun run check:qualification` → verts ;
  - statut du design : `grep -c "attend la fusion de l'amendement" DESIGN` → `0` ;
  - revue passée : `git log -1 --format=%B origin/main | grep -icE 'owner-arbitration:[[:space:]]*[0-9]{4}'` ou corps de PR → au moins `1`, écrit par le propriétaire.
  Un élément non vert = statut `fail` de L0, rapporté tel quel. Les sous-étapes B et C de la tâche 7 restées en attente sont rapportées à part : elles ne bloquent pas la sortie de L0, mais B bloque le verrou de la fixture des profils de L1.
- [ ] **Retrait du worktree.** `git worktree remove "$WT"` puis `~/.claude/bin/scratch-clean "$(dirname "$WT")"`. La branche locale `v1/l0-governance` reste : après une fusion squash, `git branch -d` la refuse, et `-D` est hors politique.
