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
[privé de sécurité de la flotte](https://github.com/libre-ai/project-governance/security/advisories/new),
défini par le `SECURITY.md` canonique de Governance.

Projet de la constellation [Libre AI](https://libre-ai.fr) — couche 1.

## Parcours cible

Observer → capturer → qualifier → transmettre → reproduire → vérifier le correctif →
joindre les résultats aux systèmes choisis.

## État vérifié

Ce dépôt contient la fondation, les garde-fous de publication et une extension locale
expérimentale en cours de validation : capture volontaire, masquage par pixels,
brouillons chiffrés par phrase secrète et export ZIP relu. Le contrat d'export v1
est verrouillé dans Contracts. La qualification complète de Chrome, Firefox et
Safari reste ouverte ; aucune API serveur, synchronisation fournisseur ni worker
de reproduction n'est livré.

Les [recettes de qualification](tools/browser-check/README.md) distinguent le parcours
réellement exécuté dans Chrome des contrôles encore incomplets dans les autres
navigateurs. Un paquet compilé ne suffit pas à qualifier un navigateur.

La publication de la fondation porte sur le commit
`8b02f8e61e1675948caaea5be3c57a898cbd624b`, attesté par la PR 112 du dépôt
`governance`, retiré le 2026-10-07 (ADR-0041) : son lien n'est donc plus donné,
et l'attestation citée ci-dessous a suivi l'autorité par transfert tracé.
La disponibilité publique a été revérifiée le 2026-10-06.
L’[attestation privée historique](https://github.com/libre-ai/project-governance/blob/7c2238d6185e59d446586688ca7db32e6a17d3e0/docs/reviews/signalement-bootstrap/8b02f8e61e1675948caaea5be3c57a898cbd624b/ATTESTATION.md)
décrit les contrôles effectués avant exposition ; elle ne qualifie aucune capacité produit.
Le critère de revue architecture, sécurité, qualité et souveraineté reste en attente :
les preuves disponibles ne démontrent pas ces quatre revues au même commit.

Chrome, Firefox et Safari font partie de la cible, mais restent trois profils de
qualification distincts. Le partage de plusieurs API WebExtension ne constitue pas
une preuve de parité.

<!-- libre-ai:project-status:begin -->
<!-- Section générée depuis project.v1.yaml — ne pas éditer à la main. -->

- Situation actuelle : La fondation est publique. Une implémentation locale de capture relue, brouillons chiffrés et export portable est en validation, contre le contrat v1 verrouillé. La qualification complète des trois navigateurs reste ouverte. Aucun connecteur fournisseur, API serveur ni worker de reproduction n'est livré.
- Maturité : specified
- Exposition : spec-published
- Confiance : medium
- Preuves vérifiées le : 2026-10-07
- Avancement : 18,8 % du périmètre actuellement déclaré

<!-- libre-ai:project-status:end -->

La fiche [`project.v1.yaml`](project.v1.yaml) est l'autorité de l'état présent, des
critères de promotion et des prédicats d'arrêt.

## Documents

Prochaine session : [passation produit et critères du premier lot](docs/runbooks/product-session.md),
[prompt de démarrage de l'addon](docs/runbooks/product-session.prompt.md) et
[prompt de conclusion](docs/runbooks/session-conclusion.prompt.md).
La priorité est le parcours capture → relecture → brouillon → export sur les trois
navigateurs. Ces documents préparent le développement ; ils ne déclarent aucune
nouvelle capacité opérationnelle.

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

Pour le développement après publication, installer les dépendances et indexer uniquement
les fichiers du changement à vérifier, puis exécuter :

```sh
bun install --frozen-lockfile
bun run check
```

`check:tree` inspecte l'arbre indexé et exécute les contrôles de qualité.
`check:development-history`, inclus dans `check`, inspecte le commit `HEAD` et toute
son ascendance dans une copie d'audit isolée. Il ne modifie aucune ref du dépôt source.
Avant commit, ces deux contrôles portent respectivement sur l'index candidat et
l'historique déjà commité ; relancer `check` après commit pour couvrir le nouveau commit.

Le protocole historique de première publication conserve son contrôle distinct :

```sh
bun run check:public-history
```

Ce dernier exige l'inventaire exact des refs autorisées et inspecte tous leurs objets
accessibles ainsi que les métadonnées des commits et tags. Le contrôle de développement
ne remplace pas cette attestation exhaustive de publication. Le
[runbook de première publication](docs/runbooks/private-first-publication.md)
conserve ce protocole et ses preuves immuables.

## Licences

- Code et outillage de première partie : EUPL-1.2.
- Futur contrat d'adoption `packages/connector-sdk/` : Apache-2.0. Aucun fichier de
  ce SDK n'existe encore ; son texte de licence sera ajouté avec ses premiers fichiers.
- Documentation éditoriale : CC-BY-4.0.

L'attribution machine-lisible par chemin dans [`REUSE.toml`](REUSE.toml) fait foi.
