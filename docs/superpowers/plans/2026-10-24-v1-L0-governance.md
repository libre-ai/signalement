# Signalement v1.0 — L0 gouvernance locale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire porter à la gouvernance locale de `signalement` (design, ADR, fiche, qualification) la v1.0 routée par politique : gel levé et cité, surface de permission d'ADR-0005 amendée, nouvel ADR « policy-routed fan-out and signed receipts », critères et prédicat d'arrêt du design §7 dans `project.v1.yaml`, hypothèses (dont les deux tranchées le 2026-10-24), menaces, risques et profils exacts dans `qualification/*.yaml`, corrections du design §5.2 et §5.6 soumises au propriétaire, artefact de revue prêt pour son arbitrage.
**Architecture:** Aucun code applicatif. Le lot modifie des documents et des données validés par trois gates existants (`check:card`, `check:qualification`, `bun test`) et ajoute deux tests qui verrouillent les identifiants que les lots L2 à L7 citent. Une seule PR, sept à dix commits selon les décisions du propriétaire (tâche 7), un artefact de revue sous `docs/reviews/`.
**Tech Stack:** Markdown, YAML (`Bun.YAML.parse`), Bun 1.4 (`bun:test`), gates de flotte vendorisés par `@libre-ai/governance` (épinglé dans `package.json`), `gh`, `jq`, `shasum`.
**Spec:** docs/superpowers/specs/2026-10-22-v1-policy-routed-ticket-projection-design.md ; feuille de route docs/superpowers/plans/2026-10-24-v1-roadmap.md

## Parties

Le plan est découpé pour rester sous la borne de taille du gate de frontière publique. Une tâche n'est jamais coupée ; la numérotation est continue.

| Partie | Fichier | Tâches |
| --- | --- | --- |
| 1 | `docs/superpowers/plans/2026-10-24-v1-L0-governance-part-1.md` | 0 Préflight · 1 Statut du design · 2 Amendement d'ADR-0005 · 3 Nouvel ADR · 4 Fiche `project.v1.yaml` |
| 2 | `docs/superpowers/plans/2026-10-24-v1-L0-governance-part-2.md` | 5 Catalogue, menaces, risques, verrous · 6 Hypothèses et matrices · 7 Corrections du design soumises au propriétaire · 8 Revue et PR · 9 Critère de sortie et retrait du worktree |

## Global Constraints

- **Faits volatils résolus, jamais écrits.** Base : `git rev-parse origin/main`. Branche servie : `git ls-remote --symref origin HEAD`. Numéro du nouvel ADR : `LAST=$(ls docs/adr | tail -1); NEXT=$(printf '%04d' $((10#${LAST%%-*} + 1)))`. Le plan écrit `<NEXT>` partout où ce numéro apparaît. Date d'exécution : `date +%F`, notée `<DATE>`. Commit de fusion d'ADR-0055 : `gh pr view 134 -R libre-ai/project-governance --json mergeCommit --jq .mergeCommit.oid`. Une ligne du design se localise par `grep -n`, jamais par un numéro de la base : la tâche 1 décale les lignes suivantes.
- **Le gate de qualification lit l'index, pas l'arbre de travail.** `tools/ci/check-qualification.ts` passe par `readIndexFiles` (`tools/ci/check-public-boundary.ts:121-128`, `git ls-files --stage`). Toute modification de `qualification/*.yaml`, et tout fichier cité comme `source:` (le nouvel ADR), doit être `git add` avant `bun run check:qualification`. Un vert pris avant le `git add` ne dit rien du contenu modifié.
- **Schéma de fiche fermé.** `node_modules/@libre-ai/governance/ecosystem/schemas/project.v1.schema.json` pose `additionalProperties: false` à la racine, sur chaque phase et sur chaque critère. Un critère = `id` (`^[a-z0-9][a-z0-9-]*$`), `text` (≥ 5 car.), `weight` (entier 1-100), `status` (`pending | accepted`), `evidence` optionnel et **obligatoire** si `accepted`. Un prédicat = `id`, `predicate`, `source` (+ `window` optionnel). Une phase admet un champ `note` optionnel : c'est là, et dans `current_situation`, que vit la conséquence « la v1.0 reste sous `usable-verifiable` ». Aucun autre champ n'est admis.
- **Identifiants de qualification.** `SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/` (`tools/ci/qualification.ts:15`) : un identifiant de profil (`github-issues/github.com/rest-2022-11-28`) contient `/` et ne peut pas être un `id` de ligne. Les lignes de `provider-matrix.yaml` gardent leur `id` de famille ; l'identifiant de profil exact ouvre leur `statement`, suivi de `: `. L5 étend `tools/ci/qualification.ts` au statut `qualified` et à un champ `profile` (feuille de route §4.5) : L0 **n'ajoute pas** ce champ, et son test accepte l'une ou l'autre forme de liaison (tâche 6). Statuts admis par L0 : `verified | assumed | rejected | unresolved` (`tools/ci/qualification.ts:13`). Chaque `source` doit désigner un chemin présent dans l'index (l'ancre `#…` n'est pas vérifiée).
- **Section statut du README dérivée.** `README.md:51-61` est générée depuis la fiche (`renderStatusSection`, `node_modules/@libre-ai/governance/ecosystem/project-cards.ts:194-213`). Après toute modification de la fiche : `bun node_modules/@libre-ai/governance/tools/presentation/heal-card-status.ts .`, puis `--check`. Ne jamais recopier ni recalculer la ligne « Avancement » à la main.
- **Prose sans test durable.** Le design et les ADR se vérifient par des commandes `grep` rouges avant, vertes après. Un test durable sur une formulation verrouillerait la rédaction et non le comportement (gate-integrity §5, question 2). Les deux tests ajoutés portent sur des identifiants et des liens, c'est-à-dire sur le contrat entre lots.
- **Décisions du propriétaire.** La tâche 7 dépend de deux choix que le design ne tranche pas (identifiant GitLab, lieu du verdict `verifyExport`). L'exécutant les pose par question structurée (2 options + conséquences, contexte restitué) s'ils ne sont pas déjà consignés, et n'applique que l'option retenue. Sans réponse, rien n'est modifié et la PR le dit.
- **Langue.** Le design et la fiche sont en français ; les ADR et les fichiers de qualification restent en anglais (`docs/adr/0001-*` à `0005-*`, `qualification/*.yaml`). Commits en anglais, `git commit -s` (identité de la config git, sign-off en dernière ligne, aucun trailer `Co-Authored-By`).
- **Arbitrage.** L'agent n'écrit jamais `Owner-arbitration:` suivi d'une date, ni dans un fichier, ni dans un message de commit, ni dans le corps de PR. Le propriétaire l'écrit. La fusion attend cette ligne. Mesure du 2026-10-24 (feuille de route §1) : aucun gate de `signalement` ne l'impose.
- **Aucune dépendance nouvelle.** `Bun.YAML`, `bun:test`, `node:fs` et les modules de `@libre-ai/governance` déjà installés suffisent.
- **Worktree.** L0 tourne en parallèle de L1 (feuille de route §2) : worktree créé sous `mktemp -d` à la tâche 0 et retiré à la tâche 9, y compris en cas d'abandon (après `git push` de la branche, pour ne rien perdre).
- **Outils.** Édition par l'outil Edit (Write pour un fichier neuf) ; jamais `sed -i`, `awk -i`, `perl -i`, `tee` ni heredoc `python3`. JSON par `jq`. Répertoire temporaire par `mktemp -d`, effacé par `~/.claude/bin/scratch-clean <dir>`.

## Review Focus

Cinq modes d'échec que le design et les gates existants laissent sans test, chacun suivi du test qui le couvre :

1. **Identifiant de critère dupliqué entre deux phases.** Le schéma ne l'interdit pas ; L2-L7 citeraient un identifiant ambigu. → `criterion ids are unique across phases`, `tools/ci/project-card.test.ts`, tâche 4.
2. **Source de prédicat d'arrêt pendante.** `validate-cards.ts:37` ne résout que les `evidence.reference` (`collectPathReferences`, `project-cards.ts:284-294`), jamais `kill_predicates[].source`. → `every kill predicate source resolves`, tâche 4.
3. **Section statut du README divergente.** Aucun gate local ne la compare ; seul le gate de présentation de la flotte, côté `project-governance`, le fait après coup. → `README status section matches a fresh render of the card`, tâche 4.
4. **Ligne v1.0 de la matrice fournisseurs liée à un autre profil que celui du registre** (germe de `capability-overclaim` : L5 passerait `qualified` une ligne dont l'édition ou la version d'API diffère). → `each v1.0 provider row is bound to its exact registry profile`, `tools/ci/qualification-v1.test.ts`, tâche 6.
5. **Prédicat `destination-disclosure-leak` sans entrée de catalogue qui le porte.** La fiche citerait une source qui ne nomme pas le test lié. → `destination-disclosure-leak resolves to a catalog entry bound to the card`, tâche 6.

Hors test, contrôlé par commande à la tâche 8 : absence de tout marqueur d'arbitrage daté ajouté par l'agent.
