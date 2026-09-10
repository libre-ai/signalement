# Libre AI Signalement

Plateforme ouverte de signalement web, de reproduction exécutable et de validation
des correctifs. Un Dossier rassemble ce que la personne déclare, ce que le navigateur
a réellement observé, les preuves qu'elle autorise, le scénario approuvé et les
résultats de vérification.

Le produit n'est pas un nouveau ticketing. Jira, GitHub, GitLab, Linear, Plane et les
outils internes reçoivent des projections indépendantes du Dossier canonique. Une
destination en échec ne doit ni bloquer ni dupliquer les autres.

Ce parcours ne reçoit jamais les vulnérabilités suspectées, secrets exposés ou détails
d'exploitation. Ils suivent exclusivement le canal
[privé de sécurité de la flotte](https://github.com/libre-ai/governance/security/advisories/new),
défini par le `SECURITY.md` canonique de Governance.

Projet de la constellation [Libre AI](https://libre-ai.fr) — couche 1.

## Parcours cible

Observer → capturer → qualifier → transmettre → reproduire → vérifier le correctif →
joindre les résultats aux systèmes choisis.

## État vérifié

Ce dépôt contient actuellement une spécification de fondation et des garde-fous de
publication développés en TDD. Il ne contient encore aucune extension installable,
API opérationnelle, synchronisation fournisseur ni worker d'exécution qualifié.

Chrome, Firefox et Safari font partie de la cible, mais restent trois profils de
qualification distincts. Le partage de plusieurs API WebExtension ne constitue pas
une preuve de parité.

<!-- libre-ai:project-status:begin -->
<!-- Section générée depuis project.v1.yaml — ne pas éditer à la main. -->

- Situation actuelle : Le nom et l'enrôlement sont signés dans Governance; la fondation locale est acceptée dans ce dépôt. Le dépôt reste scellé avant son attestation privée et sa publication; aucune capture, extension, API, synchronisation, exécution ni intégration fournisseur n'est qualifiée ou opérationnelle.
- Maturité : specified
- Exposition : idea
- Confiance : medium
- Preuves vérifiées le : 2026-09-10
- Avancement : 0 % du périmètre actuellement déclaré

<!-- libre-ai:project-status:end -->

La fiche [`project.v1.yaml`](project.v1.yaml) est l'autorité de l'état présent, des
critères de promotion et des prédicats d'arrêt.

## Documents

| Document | Rôle |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | frontières canoniques pour tout agent |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | DCO, gates et règles de contribution sans données capturées |
| [`project.v1.yaml`](project.v1.yaml) | état produit et critères vérifiables |
| [`docs/specs/2026-09-10-signalement-foundation.md`](docs/specs/2026-09-10-signalement-foundation.md) | architecture cible et limites |
| [`docs/superpowers/plans/2026-09-10-signalement-repository-bootstrap.md`](docs/superpowers/plans/2026-09-10-signalement-repository-bootstrap.md) | plan exécutable du bootstrap |
| [`qualification/README.md`](qualification/README.md) | décisions, hypothèses, risques et matrices non encore qualifiées |
| [`docs/qualification/official-capability-baseline.md`](docs/qualification/official-capability-baseline.md) | capacités navigateur et fournisseur vérifiées dans les documentations officielles |
| [`docs/audits/dependency-licenses.md`](docs/audits/dependency-licenses.md) | audit reproductible des licences et vulnérabilités du graphe verrouillé |
| [`docs/runbooks/agent-delivery.md`](docs/runbooks/agent-delivery.md) | lancement en deux temps : qualification poussée puis livraison autonome |
| [`docs/runbooks/private-first-publication.md`](docs/runbooks/private-first-publication.md) | création privée, miroir exact, attestation puis exposition séparée |
| [`docs/adr/`](docs/adr/) | frontières Dossier/projections, capture, scénarios et contrôle portable |
| [`docs/contracts/`](docs/contracts/) | interfaces internes préparant les futurs contrats publics verrouillés |

## Vérification locale

Avant le commit racine, après avoir indexé l'arbre candidat :

```sh
bun install --frozen-lockfile
git add --all
bun run check:tree
```

Après le commit racine, le gate obligatoire inspecte les refs locales autorisées, tous
leurs objets accessibles et les métadonnées de commits et tags :

```sh
bun run check
```

## Licences

- Code et outillage de première partie : EUPL-1.2.
- Contrat d'adoption `packages/connector-sdk/` : Apache-2.0.
- Documentation éditoriale : CC-BY-4.0.

L'attribution machine-lisible par chemin dans [`REUSE.toml`](REUSE.toml) fait foi.
