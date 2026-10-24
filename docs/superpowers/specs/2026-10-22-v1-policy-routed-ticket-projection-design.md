# Signalement v1.0 — projection d'un Dossier vers les systèmes de tickets, routée par politique

- Statut : design approuvé par le propriétaire le 2026-10-23 (en chat) ; gel levé par
  ADR-0055, décision D94 du registre de `libre-ai/project-governance`, fusionné par le
  propriétaire le 2026-10-23 (`libre-ai/project-governance` #134)
- Arbitrages : décisions propriétaires des 2026-10-22 et 2026-10-23, prises par questions
  structurées pendant la session de cadrage v1.0 (restituées au §4)
- Base inspectée le 2026-10-22 : `6c1af3c` ; la tête servie se résout par
  `git ls-remote --symref origin HEAD`, jamais par cette valeur
- Prolonge : `docs/specs/2026-09-10-signalement-foundation.md` (architecture cible),
  `2026-10-06-local-capture-export.md` (parcours local), ADR-0001, ADR-0002, ADR-0004,
  ADR-0005, `docs/contracts/connector-boundary.md`
- N'autorise pas à lui seul : la sortie du gel (ADR-0042 §1, voir §8 et annexe A), une
  écriture sur un chemin gardé, la publication d'une capacité non qualifiée

## 1. Intention

Une personne voit un problème dans une application web. Aujourd'hui, elle fait une
capture, l'envoie sur un canal quelconque, et quelqu'un recopie le tout dans l'outil de
tickets d'une équipe : souvent le mauvais, souvent avec plus de données que nécessaire,
parfois deux fois.

La v1.0 fait arriver le signalement **dans le bon système de tickets, avec seulement ce
qui a le droit d'y aller, une seule fois, avec une preuve de ce qui est parti**. Le
« bon » système et le « droit d'y aller » ne sont pas décidés par la personne qui
signale. Ils sont décidés par **l'équipe qui pose les règles** (sécurité, conformité),
qui est l'acheteur de la v1.0.

Ce qui rend le produit vendable à cet acheteur :

- la règle est déclarative, versionnée, approuvée, et elle s'applique sur une donnée
  observée (l'origine de la page capturée), pas sur ce que la personne tape ;
- chaque envoi produit un **reçu signé**, vérifiable hors ligne, qui dit ce qui est parti,
  vers où, sous quelle version de politique ;
- l'extension reste sans réseau : la surface de collecte ne s'élargit que d'une
  permission d'injection liée à un geste, pour gagner la remise.

## 2. Buts, non-buts, anti-buts

### Buts

- **B1 — Routage par politique sur l'origine observée.** Une politique d'organisation
  désigne, pour l'origine de la page capturée, des destinations **imposées** et
  éventuellement **optionnelles**. La personne ne peut ajouter une destination hors de
  cette liste que si la règle déclare `override: allowed`, et seulement parmi les
  destinations que la règle déclare `selectable`. Par défaut : `override: denied`.
- **B2 — Divulgation liée à la cible.** Pour chaque destination, la politique calcule
  quels fichiers de l'export sont transmis ou retenus. La personne voit le résultat
  exact par destination et approuve destination par destination (ADR-0002). Elle peut
  retenir davantage, jamais transmettre davantage.
- **B3 — Quatre profils exacts, tous qualifiés.** GitHub Issues (github.com), GitLab
  Issues (gitlab.com), Jira Cloud, Plane auto-hébergé. Chacun est un `ConnectorProfile`
  exact (§5.6). La v1.0 ne sort que lorsque les quatre sont `qualified` dans
  `qualification/provider-matrix.yaml` contre des instances réelles.
- **B4 — Fan-out idempotent à état indépendant.** Chaque destination a sa projection,
  son état et ses reçus. L'échec de l'une ne masque, n'annule ni ne duplique les autres.
  Une reprise ne crée jamais un second item distant.
- **B5 — Reçu de projection signé.** Le control plane signe (Ed25519) un reçu par
  livraison réussie. La CLI le vérifie hors ligne. Le contrat d'export
  `signalement-local-export-v1` reste **inchangé**.
- **B6 — Control plane auto-hébergé par chaque client, CLI cliente.** Un déploiement
  Bun + PostgreSQL par client, mono-organisation. La CLI envoie un export au control
  plane, suit l'état des projections et vérifie les reçus hors ligne. Elle ne projette
  jamais seule.
- **B7 — Remise de l'extension au control plane par l'onglet actif.** Un geste dans
  l'extension, sur l'onglet du control plane, remet l'export relu et l'origine observée
  à la page. Aucun téléchargement intermédiaire.
- **B8 — Destinations interdites masquées.** La personne voit
  « N destination(s) exclue(s) par la politique », sans nom ni motif. Le détail vit dans
  le journal d'audit, lisible par les administrateurs de la politique.

### Non-buts de la v1.0 (décision D13 : v1.1)

- **Reproduction et verdict** (phase `reproduce-verify` : scénarios, workers, verdicts).
  Conséquence assumée : la fiche ne peut pas atteindre `usable-verifiable`, qui exige un
  worker isolé (`project.v1.yaml`, `promotion_criteria`). La v1.0 le dit publiquement.
- **Customer Edge Bridge** pour un standard maison. Le critère
  `internal-standard-adapter` reste `pending` ; la phase `multi-system-projection` ne se
  clôt donc pas en v1.0. L'interface connecteur est publiée sous Apache-2.0
  (`packages/connector-sdk/`) pour qu'un Bridge l'implémente plus tard sans fork.

### Autres non-buts

- **Linear.** Écarté au profit de Plane auto-hébergé (décision D3).
- **CLI autonome** (projection sans serveur, état local, clé d'opérateur) : écartée par
  D11.
- **Opérateur multi-organisation** (instance hébergée servant plusieurs clients) :
  écarté par D12. Le schéma garde `organization` partout pour ne pas fermer cette porte.
- **Synchronisation bidirectionnelle de champs.** La v1.0 lit l'état distant (statut,
  lien, fermeture) par curseur pour l'afficher dans le Dossier ; elle n'écrit jamais un
  champ du Dossier à partir du texte distant (ADR-0001).
- **Routage par IA.** Aucun modèle ne choisit une destination ni une divulgation.
- **Politique gérée du navigateur** pour configurer l'origine du control plane.
  *Choix de l'agent* : elle exigerait la permission `storage` et n'existe pas de façon
  équivalente sur les trois navigateurs (hypothèse à vérifier) ; l'origine est saisie
  par la personne.
- **Profils OAuth/App** (GitHub App, OAuth 2.0 3LO Atlassian, OAuth GitLab). La v1.0
  qualifie des jetons à portée minimale (§5.6). *Choix de l'agent.*
- **Devenir un outil de tickets** (non-but de la fiche, inchangé).

### Anti-buts (échec même si « ça marche »)

- Un fichier retenu par la politique atteint une destination
  (`destination-disclosure-leak`, nouveau prédicat, §7).
- Une reprise crée un second ticket pour la même livraison (`duplicate-external-item`).
- Une organisation voit, route ou projette une ressource d'une autre
  (`cross-organization-disclosure`).
- Un profil apparaît comme pris en charge sans qualification exacte
  (`capability-overclaim`).
- La personne qui signale apprend le nom d'un système interne que la politique lui
  interdit.
- L'extension obtient un accès réseau, une permission d'hôte ou un content script
  permanent.
- Un reçu affirme une divulgation différente des octets réellement envoyés.

## 3. Contraintes

- **Extension sans réseau (CA-8, ADR-0005).** Les pages de l'extension gardent
  `connect-src 'none'`. Seule évolution du manifest : ajout de `scripting` (D8, §5.2).
  `tools/build/manifest.test.ts:7-8` verrouille aujourd'hui `permissions` à
  `["activeTab"]` et l'absence de `host_permissions` ; il passe à
  `["activeTab", "scripting"]`, l'absence de `host_permissions` et de
  `content_scripts` restant verrouillée.
- **Contrat d'export inchangé.** La remise transporte les octets exacts de l'export
  ZIP `signalement-local-export-v1`, vérifiés à réception par le même vérificateur que
  `verify-export.ts`. L'origine observée voyage dans l'enveloppe de remise, hors de
  l'export.
- **Contrats publics dans `libre-ai/schemas-and-contracts`.** Politique de routage,
  reçu de projection, `ConnectorProfile` et enveloppe de remise y sont rédigés et
  verrouillés ; ce dépôt les vendorise par épinglage, comme le contrat d'export
  (`vendor/contracts/pin.json`). Aucun schéma public concurrent ici.
- **Architecture cible.** La spec de fondation réserve `crates/` aux composants Rust
  sensibles pour la sécurité et la preuve, et `packages/connector-sdk/` à la frontière
  fournisseur sous Apache-2.0 (`docs/specs/2026-09-10-signalement-foundation.md:148-151`,
  `REUSE.toml:19-22`). Le design s'y conforme (§5.1).
- **Identité et isolation (I-09).** OIDC, session cookie `__Host-`, jetons Biscuit
  Ed25519 pour les clients d'API (CLI comprise), `organization` obligatoire sur chaque
  ressource, RLS PostgreSQL sur chaque table qui porte une donnée d'organisation —
  défense en profondeur dans un déploiement mono-organisation (D12).
- **Secrets.** Jetons fournisseurs chiffrés au repos (enveloppe applicative, ADR-0004),
  injectés à l'exécution, jamais journalisés. Aucune réponse brute de fournisseur en
  journal.
- **Contenu non fiable.** Texte du Dossier, pages capturées et réponses fournisseurs
  sont des données, jamais des instructions. Le rendu vers un fournisseur échappe le
  balisage du fournisseur (mentions, liens automatiques, références croisées).
- **Canal sécurité.** Vulnérabilités suspectées, secrets exposés et détails
  d'exploitation restent refusés et redirigés (ADR-0002) ; la projection n'ouvre pas de
  contournement.
- **Souveraineté.** Cible de déploiement de référence : Clever Cloud (Paris), sans
  hyperscaler américain dans la chaîne du control plane. Aucune dépendance AGPL/SSPL.
  Plane (AGPL) est une cible d'API, pas une dépendance : sans effet de licence.
- **Gouvernance.** ADR-0042 §1 gelait `signalement` jusqu'à B′ (texte en annexe A).
  ADR-0055 (D94), fusionné le 2026-10-23, l'a amendé : le gel est levé. Aucune PR de
  code qui consomme un contrat public ne fusionne avant le verrou de ce contrat (§8.3).
  Les chemins gardés (`docs/adr/**`, etc.) exigent un artefact de revue ; l'agent
  n'écrit jamais de ligne `Owner-arbitration:`.
- **Comptes de qualification.** GitLab.com et Jira Cloud exigent des comptes de test
  créés par le propriétaire ; Plane tourne en conteneur local ; GitHub utilise un dépôt
  de test de l'organisation. Sans compte, le profil reste `unresolved` et la v1.0 ne
  sort pas (D13).

## 4. Décisions prises par le propriétaire

| # | Date | Décision | Conséquence directe |
| --- | --- | --- | --- |
| D1 | 2026-10-22 | Lever le gel pour `signalement` | Amendement d'ADR-0042 §1 en `project-governance` (annexe A), fusion propriétaire |
| D2 | 2026-10-22 | `signalement` est le seul dépôt porteur de P15 ; `ai-work-supervision` sort de P15 et reste la fabrique | Correction de catalogue (annexe B) |
| D3 | 2026-10-22 | Cibles v1.0 : GitHub Issues, GitLab Issues, Jira Cloud, Plane auto-hébergé | Quatre profils exacts (§5.6) |
| D4 | 2026-10-22 | Acheteur : l'équipe qui pose les règles (sécurité, conformité) | Politique, audit et reçus sont le cœur produit |
| D5 | 2026-10-22 | Control plane auto-hébergé + CLI au même moteur | Crate et paquets partagés (§5.1) ; précisé par D11 |
| D6 | 2026-10-22 | Routage : destinations par défaut + choix borné si la politique l'autorise | `imposed` / `optional` / `selectable` / `override` (§5.3) |
| D7 | 2026-10-22 | Authenticité : reçu signé par le control plane ; export v1 inchangé | §5.5 |
| D8 | 2026-10-22 | Remise par l'onglet actif, avec ajout borné de `scripting` | §5.2, amendement d'ADR-0005 |
| D9 | 2026-10-22 | Destinations interdites masquées, nombre seul | §5.4 |
| D10 | 2026-10-23 | Le routage s'appuie sur l'origine observée à la capture | Nouvelle donnée collectée, relue, transmise hors export (§5.2) |
| D11 | 2026-10-23 | CLI = cliente du control plane + vérification hors ligne | Une seule source d'état, d'audit et de politique |
| D12 | 2026-10-23 | Chaque client s'héberge, mono-organisation | Une clé de signature par déploiement, rôles issus de l'OIDC du client (§5.7) |
| D13 | 2026-10-23 | Sortie v1.0 = projection seule, quatre profils qualifiés ; reproduction et Bridge en v1.1 | Maturité sous `usable-verifiable`, dite publiquement (§7) |

## 5. Comment, pour les parties décidées

### 5.1 Vue d'ensemble

```
 Navigateur de la personne qui signale                Control plane (un déploiement par client)
 ┌──────────────────────────────┐                    ┌──────────────────────────────────────┐
 │ Extension (connect-src none) │  geste explicite   │ Page « Recevoir un signalement »     │
 │ capture (+ origine observée) ├──────────────────► │  (origine épinglée, §5.2)            │
 │ relecture → préparation      │ activeTab +        │        │ enveloppe : export + origine │
 │ export ZIP v1 (inchangé)     │ scripting, morceaux│        ▼                              │
 └──────────────────────────────┘                    │ vérification de l'export (même code  │
                                                     │ que verify-export) ─► Dossier        │
                                                     │        │                              │
                                                     │        ▼                              │
                                                     │ politique (crate Rust → WASM)        │
                                                     │  → plan par destination              │
                                                     │        │ écran « Envoyer » +          │
                                                     │        │ approbation par destination  │
                                                     │        ▼                              │
                                                     │ PostgreSQL : projection + outbox     │
                                                     │  (même transaction, RLS)             │
                                                     │        │ dispatcher en processus      │
                                                     │        ▼                              │
                                                     │ connecteurs (connector-sdk) ─► reçus │
                                                     │  signés (crate Rust)                 │
                                                     └────────┼─────────────────────────────┘
                                                              │ HTTPS sortant, jeton injecté
                        ┌──────────────┬──────────────┬───────┴──────┐
                        ▼              ▼              ▼              ▼
                  GitHub Issues  GitLab Issues   Jira Cloud    Plane auto-hébergé

 CLI (cliente, jeton Biscuit) : signalement submit <export.zip> --origin … → control plane
                                signalement status <dossier>
                                signalement verify-receipt <reçu> --keys <clés publiques>
                                (vérification hors ligne : même crate, aucune connexion)
```

Découpage en modules (noms indicatifs, le builder les ajuste) :

- `crates/policy-receipt/` — **composant de preuve en Rust** (fondation : `crates/`) :
  évaluation de politique (pure, déterministe), canonicalisation JCS, signature et
  vérification Ed25519 des reçus. Compilé en WASM et consommé à l'identique par le
  control plane et par la CLI. *Choix de l'agent : WASM plutôt que FFI native, pour
  n'avoir qu'un artefact sur les deux surfaces.*
- `packages/connector-sdk/` — interface connecteur, types de reçus et d'échecs typés,
  rapport de capacités. **Apache-2.0** (`REUSE.toml:19-22`).
- `packages/projection-core/` — machine d'état d'une projection, calcul du plan de
  divulgation à partir du verdict de politique, rendu déterministe et versionné du corps
  de ticket par profil. Aucune I/O directe : stockage, horloge, réseau et signature sont
  injectés.
- `connectors/<famille>/` — un module par famille, chaque module déclarant les profils
  exacts qu'il implémente (fondation : `connectors/`).
- `apps/control-plane/` — API versionnée, interface web (réception, envoi, politique,
  audit), persistance PostgreSQL, outbox, dispatcher en processus (ADR-0004 : séparation
  seulement sur preuve).
- `apps/cli/` — client d'API et vérificateur hors ligne.
- `apps/extension-shared/` — conservation de l'origine observée, action « Envoyer au
  control plane », réglage « origine du control plane ».

### 5.2 Origine observée et remise de l'extension au control plane

**Origine observée (D10).** Au moment de la capture, l'extension lit l'URL de l'onglet
cible (accessible grâce à `activeTab` après le geste) et n'en garde que l'origine :
schéma, hôte, port, sans chemin, requête ni fragment. L'origine est stockée dans le
brouillon chiffré, affichée à la relecture comme une observation de capture (distincte
des déclarations de la personne), et retirable. Retirée, elle n'est pas transmise, et
seules les règles qui apparient « origine absente » peuvent router. Elle reste
falsifiable par une personne qui contrôle son navigateur. C'est acceptable parce que les
règles de divulgation portent sur la destination et non sur l'origine : une origine
falsifiée ne peut que rerouter vers une autre destination déjà autorisée par la
politique. Elle n'est pas falsifiable par une faute de frappe.

**Remise (D8).** Séquence :

1. Le control plane affiche la page « Recevoir un signalement » sur son origine
   (HTTPS, session authentifiée).
2. Sur cet onglet, la personne ouvre l'extension et choisit « Envoyer au control
   plane ». L'extension compare l'origine de l'onglet à l'origine configurée
   **exactement** (schéma, hôte, port). Une différence provoque un refus visible, sans
   injection.
3. L'éditeur, qui détient le brouillon déverrouillé, effectue une **nouvelle
   préparation** de l'export : c'est une nouvelle frontière d'approbation (ADR-0005).
   L'extension affiche l'origine de destination, l'origine observée et le contenu, et
   demande confirmation. Cette confirmation est l'approbation de la cible « control
   plane de l'organisation » au sens d'ADR-0002. *Choix de l'agent : la popup délègue à
   l'éditeur, seul détenteur de la clé et des octets ; le service worker ne détient
   rien, puisqu'il peut être suspendu.*
4. L'extension injecte une **fonction fixe** (`scripting.executeScript` avec `func`,
   monde isolé, jamais de code construit à partir de données) qui remet l'enveloppe à la
   page par `postMessage` avec l'origine cible explicite. Les arguments d'injection
   passent en JSON (hypothèse à vérifier par navigateur) : la remise se fait donc **par
   morceaux bornés**, chacun acquitté par la page, avec le digest de l'export annoncé en
   tête et vérifié à la fin. Le total reste borné par les limites du contrat d'export ;
   la mémoire consommée est mesurée en qualification, par navigateur.
5. La page vérifie le **transport** (longueur, SHA-256 annoncé dans l'enveloppe,
   archive lisible, présence de `manifest.json`), puis téléverse l'export avec l'origine
   observée vers le control plane. Le serveur rend le verdict de conformité
   (`verifyExport`, le même vérificateur que `verify-export.ts`) avant de créer ou
   réviser le Dossier ; la page affiche ce verdict. Motif : le vérificateur vendorisé ne
   tourne pas en navigateur sans `unsafe-eval` (`node:crypto`, `Bun.file` au chargement,
   Ajv compilé à l'exécution). Décision du propriétaire du 2026-10-24.

Propriétés exigées :

- l'origine du control plane est un réglage saisi par la personne, jamais déduit de la
  page ;
- aucune injection sans geste, sans correspondance d'origine ou sans confirmation ;
- la fonction injectée ne lit rien de la page ;
- même mécanisme sur Chrome, Firefox et Safari, qualifié séparément par navigateur ;
- amendement d'ADR-0005 : « permission surface is voluntary active-tab capture » devient
  « voluntary active-tab capture, observed origin retention, and gesture-bound delivery
  to one configured origin ».

### 5.3 Politique de routage et de divulgation

La politique est une donnée d'organisation, versionnée, avec un état
`draft → approved → retired`. Seule une version `approved` s'applique. L'approbation
exige par défaut un administrateur de politique distinct de l'auteur du brouillon ;
l'organisation peut assouplir cette séparation, et cet assouplissement est lui-même une
modification approuvée et journalisée (*choix de l'agent*). Chaque évaluation enregistre
au journal d'audit la version et le digest de la politique, les règles appariées et le
plan produit.

Contenu sémantique minimal (la syntaxe est laissée au contrat public) :

- **Destinations** : identifiant stable, profil exact, coordonnées distantes (dépôt,
  projet, espace), attributs déclarés (`residency`, et `visibility` pour les profils qui
  n'en exposent pas) et attributs découverts (`visibility` pour les profils qui
  l'exposent).
- **Règles de routage** : un critère d'appariement sur l'origine observée (égalité
  exacte ou motif d'hôte borné) ou sur son absence → destinations `imposed` ou
  `optional`, liste `selectable` et `override: allowed | denied` (défaut `denied`). Une
  destination ajoutée par override passe par les mêmes règles de divulgation. Aucune
  règle appariée = aucune destination, et l'écran le dit (pas de destination implicite).
- **Destinations refusées** : une règle peut déclarer des destinations `denied`. Elles
  seules alimentent le compteur « N exclue(s) » de l'écran. Les destinations qu'aucune
  règle ne mentionne n'y figurent pas.
- **Règles de divulgation** : classe de fichier de l'export × attributs de la
  destination → `transmit | withhold`, avec retenue par défaut. Les classes sont
  celles du contrat d'export v1 : `document` (Markdown), `screenshot`, `video`. La
  granularité v1.0 est le fichier : retirer un passage du document exige une nouvelle
  préparation locale (ADR-0005).
- **Remise des médias** quand le profil ne sait pas téléverser une pièce jointe :
  `link` (lien vers l'artefact dans le control plane, accessible aux seuls membres
  authentifiés de l'organisation) ou `withhold`. Valeur par défaut : `withhold`.

L'évaluation est une fonction pure : même politique, même export, même origine et mêmes
attributs découverts → même plan, octet pour octet. Elle se teste par tables de cas et
par tests de propriété (aucune entrée ne produit un `transmit` sans règle explicite).

### 5.4 Écran d'envoi

Conforme à la maquette du 2026-10-22, avec D9 :

- destinations imposées : affichées, non décochables ;
- destinations optionnelles : affichées, cochables ;
- override autorisé : un sélecteur limité à la liste `selectable` de la règle ;
- destinations refusées : **un seul compteur** « N destination(s) exclue(s) par la
  politique », sans nom ni motif ;
- tableau « ce que chaque destination recevra » : pour chaque fichier et chaque
  destination, `Transmis` ou `Retenu`, avec le motif de retenue (« dépôt public »,
  « résidence hors UE », « pièce jointe non prise en charge ») ;
- approbation explicite par destination ; un bouton global n'approuve que les
  destinations cochées, et l'approbation lie le plan exact (digests des fichiers transmis
  et version de politique) ;
- après envoi, un état par destination : `créé` ou `mis à jour` avec lien distant et
  reçu, `en attente` avec reprise, `à résoudre` (§5.5), `échec` typé.

Accessibilité : contrôles au clavier, noms accessibles, erreurs annoncées (comme le
parcours local). Les couleurs passent par les variables CSS existantes
(`apps/extension-shared/styles.css`).

### 5.5 Projection, idempotence et reçus

- **Identité.** Une projection est identifiée par (`organization`, Dossier,
  destination). Le Dossier est identifié côté control plane par l'identifiant de Dossier
  du producteur et l'identité de la personne authentifiée qui l'a remis : deux personnes
  ne peuvent pas réviser le Dossier l'une de l'autre. *Choix de l'agent.*
- **Livraisons.** Chaque révision approuvée produit une livraison sur chaque projection.
  La première crée l'item distant. Les suivantes publient un commentaire sur l'item
  existant, jamais un nouvel item. La clé d'idempotence d'une livraison est un hachage
  de (projection, digest de l'export, version de mapping). Le même export remis deux
  fois ne produit aucune nouvelle livraison.
- **Atomicité.** L'approbation crée les livraisons et leurs intentions sortantes dans la
  même transaction (outbox). Le dispatcher est idempotent et reprend par curseur.
- **Plan figé, attributs relus.** Les attributs découverts sont lus au calcul du plan,
  puis relus par le dispatcher juste avant l'envoi. Si un attribut a changé (par exemple
  un dépôt passé de privé à public), ou si la version de politique a été retirée, la
  livraison passe en `à résoudre` et exige une nouvelle approbation. Elle ne part jamais
  sous un plan périmé. Une lecture en échec retient tous les fichiers de cette
  destination (motif `visibility-unknown`), ce qui est plus strict que de la traiter
  comme « public » : échec fermé.
- **Issue ambiguë** (requête partie, réponse perdue) : avant toute nouvelle création, le
  connecteur cherche l'item distant par un **marqueur de projection** inclus dans le
  corps (ou par `external_id` si le profil le prend en charge). La recherche doit passer
  par une lecture **fortement cohérente**. Un index de recherche à cohérence différée
  (comme la recherche GitHub) ne compte pas. Si le profil n'offre pas de lecture
  cohérente, la livraison passe en `à résoudre` (résolution humaine), **jamais** en
  nouvelle tentative de création à l'aveugle.
- **Indépendance.** L'état d'une projection n'est jamais dérivé de celui d'une autre ;
  le Dossier affiche N états, pas un état agrégé « envoyé ».
- **Rendu.** Le corps envoyé est le rendu du document par une fonction pure et versionnée
  par profil (échappement, marqueur de projection, liens de médias éventuels).
- **Reçu.** À chaque livraison réussie, le control plane produit un reçu canonicalisé
  (JCS) et signé Ed25519, qui contient au minimum :
  - version du reçu, `organization`, identifiant de la clé de signature, horodatages ;
  - digest de l'export, identifiant de destination, profil exact ;
  - identifiant et URL distants ;
  - digests des fichiers transmis, identifiants des fichiers retenus et motif de retenue ;
  - version du moteur de rendu et digest de chaque corps de requête réellement envoyé ;
  - version et digest de la politique, référence de l'approbation.
  La vérification hors ligne contrôle la signature et les digests des fichiers contre
  l'export. Elle recalcule les corps rendus quand la même version du moteur de rendu est
  disponible, et elle dit explicitement quand elle ne l'est pas.
- **Clés (D12).** Une clé de signature par déploiement, avec rotation, identifiant de clé
  dans chaque reçu et export des clés publiques. La CLI ne signe rien (D11).
- **Ce qu'un reçu prouve** : que ce control plane a envoyé ces octets à cet identifiant
  distant sous cette politique. Il ne prouve ni l'identité ni l'intention de la personne
  qui a signalé, ni ce que le fournisseur a fait ensuite.

### 5.6 Profils exacts visés

| Famille | Édition | API | Authentification v1.0 | Pièce jointe | Visibilité | Lecture cohérente pour la reprise |
| --- | --- | --- | --- | --- | --- | --- |
| GitHub Issues | github.com | REST, version d'API épinglée | jeton à grain fin, portée dépôt | aucune API de téléversement : `link` ou `withhold` | découverte (public / privé) | liste d'issues du dépôt (pas la recherche) — à prouver |
| GitLab Issues | gitlab.com | REST v4 | jeton personnel de portée `api` d'un compte dédié, membre des seuls projets cibles au rôle minimal (les jetons d'accès de projet exigent Premium ou Ultimate sur gitlab.com, mesuré le 2026-10-24) | téléversement de projet | découverte ; `internal` est traité comme public | liste filtrée du projet — à prouver |
| Jira Cloud | Cloud | REST v3 | jeton d'API d'un compte de service | pièces jointes d'issue | déclarée par l'administrateur | aucune — infirmée le 2026-10-24 (documentation Atlassian, *search and reconcile*) : toute création ambiguë finit en `à résoudre` |
| Plane | auto-hébergé, version épinglée en qualification | API REST v1 | clé d'API d'espace | pièces jointes d'item — à prouver sur la version épinglée | déclarée par l'administrateur | `external_id` / `external_source` — à prouver |

Toutes les cellules « à prouver » sont des hypothèses. Une capacité absente est une
donnée du profil, affichée à l'écran, jamais simulée. Chaque profil passe la même
suite : découverte, validation du mapping, création idempotente, rattachement à un item
existant, pièce jointe ou repli déclaré, publication d'un commentaire, lecture par
curseur, reprise après coupure provoquée à chaque étape, conflit déclaré.

**Instance non conforme.** Le control plane refuse de configurer une destination dont la
découverte ne correspond pas à un profil `qualified` de la matrice (version de Plane,
version d'API, édition). Un mode de qualification, réservé aux administrateurs et
visible comme tel, permet d'exécuter la suite contre une instance réelle sans la publier
comme prise en charge. *Choix de l'agent.*

### 5.7 Exploitation (D12)

- Un déploiement par client, une organisation par déploiement. Le schéma garde
  `organization` sur chaque ressource et la RLS sur chaque table, et la suite
  `cross-organization-disclosure` s'exécute quand même : deux organisations dans une
  base de test, accès croisé refusé par requête SQL directe.
- Les rôles (personne qui signale, administrateur de politique, auditeur) viennent des
  revendications OIDC du fournisseur d'identité du client, avec une table de
  correspondance locale.
- Jetons Biscuit Ed25519 émis par le control plane pour la CLI et les clients d'API,
  atténuables (organisation, rôle, durée) ; la session web reste le cookie `__Host-`.
- Cible de déploiement de référence documentée : Clever Cloud (Paris), PostgreSQL géré,
  stockage d'artefacts compatible S3 ou POSIX (ADR-0004).

## 6. Laissé au builder

- syntaxe du contrat de politique, de l'enveloppe de remise et du reçu (dans le cadre
  des §5.2, §5.3 et §5.5), rédigée dans `schemas-and-contracts` ;
- schéma PostgreSQL, politique RLS par table, migrations ;
- choix du serveur HTTP et du rendu web dans la stack de la flotte (I-06), sans nouvelle
  dépendance lorsqu'une capacité native de Bun suffit ;
- stockage des clés de signature et des jetons (enveloppe applicative ; module matériel
  facultatif) ;
- taille des morceaux de remise, stratégie de reprise (délais, plafond), tant que les
  §5.2 et §5.5 sont respectés ;
- mise en forme du corps de ticket par profil, y compris l'échappement du balisage ;
- découpage en lots et ordre d'implémentation, dans le plan.

## 7. Preuve d'acceptation v1.0

Critère de sortie (D13) : les quatre profils de D3 sont `qualified` contre des instances
réelles, et tous les critères ci-dessous sont verts sur le même commit. La fiche reste
sous `usable-verifiable`, et la page publique du produit le dit.

Critères existants de la fiche, à faire passer :

- `two-real-profiles` — étendu aux quatre profils de D3 ; résultat consigné dans
  `qualification/provider-matrix.yaml` ;
- `fanout-independent-state` ;
- `exact-disclosure-preview` ;
- `browser-matrix-real` — étendu à l'origine observée et à la remise, par navigateur.

Critères nouveaux proposés pour la fiche (ajout soumis à revue, chemin gardé) :

- `policy-routing` — même export, même origine et même politique → même plan ;
  destination refusée jamais nommée à la personne qui signale ; aucun `transmit` sans
  règle explicite ;
- `signed-receipt-offline` — un reçu se vérifie hors ligne avec les seules clés
  publiques ; un octet modifié dans le reçu ou dans un fichier transmis fait échouer la
  vérification ;
- `gesture-bound-delivery` — aucune injection sans geste, sur une origine différente ou
  sans confirmation (tests rouges prouvés par neutralisation) ;
- `stale-plan-refused` — un attribut découvert modifié ou une politique retirée entre
  l'approbation et l'envoi produit `à résoudre`, jamais un envoi.

Prédicats d'arrêt :

- **nouveau** `destination-disclosure-leak` : « un fichier retenu par la politique
  atteint une destination ». Source : la suite de projection. `public-data-leak` garde
  son sens actuel (historique public) et sa source (`tools/ci/check-public-history.ts`).

Tests liés aux prédicats, obligatoires avant toute annonce :

- `destination-disclosure-leak` : un fichier retenu n'apparaît dans aucune requête
  sortante (requêtes capturées par un faux fournisseur en test, puis contre l'instance
  réelle) ; une lecture de visibilité en échec fait retenir ;
- `duplicate-external-item` : coupure injectée après l'envoi et avant la réponse, à
  chaque profil → un seul item distant ; une révision → un commentaire, pas un item ;
- `cross-organization-disclosure` : §5.7 ;
- `capability-overclaim` : l'interface et l'API ne listent comme disponibles que les
  profils `qualified` de la matrice ; une instance non conforme est refusée.

## 8. Préalables de gouvernance, dans l'ordre

1. **Amendement d'ADR-0042 §1** en `project-governance` (annexe A) : PR ouverte par
   l'agent, fusion par le propriétaire. Aucun lot de code avant. Fait : ADR-0055, D94,
   fusionné le 2026-10-23 (`libre-ai/project-governance` #134).
2. **Correction de catalogue P15** (annexe B), dans la même PR ou une PR liée.
3. **Contrats publics** en `schemas-and-contracts` : politique, enveloppe de remise,
   reçu, `ConnectorProfile`. Ils sont verrouillés avant que le code qui les consomme soit
   fusionné.
4. **ADR locaux** : amendement d'ADR-0005 (§5.2) et un nouvel ADR « fan-out routé par
   politique et reçus signés » (numéro dérivé de `docs/adr/` au moment de la PR).
   Artefact de revue requis (chemin gardé).
5. **Fiche `project.v1.yaml`** : `current_situation`, critères et prédicat du §7.
   Revue requise.
6. **Comptes de qualification** créés par le propriétaire (GitLab.com, Jira Cloud) ;
   leurs secrets sont transmis par un canal de secrets, jamais en clair.

## 9. Choix de l'agent à vérifier à la lecture

- règle de résidence portée par l'instance ; visibilité découverte quand le profil
  l'expose, déclarée sinon ; GitLab `internal` traité comme public ; lecture en échec :
  tous les fichiers de la destination retenus (`visibility-unknown`) ;
- remise des médias par lien authentifié quand le profil ne sait pas téléverser, et
  seulement si la politique le dit ;
- profils à jeton plutôt qu'OAuth/App pour la v1.0 ;
- origine du control plane saisie par la personne, sans politique gérée du navigateur ;
- popup qui délègue la préparation à l'éditeur ; remise par morceaux ;
- révision d'un Dossier → commentaire sur l'item existant ; Dossier lié à la personne
  qui l'a remis ;
- compteur « N exclue(s) » limité aux refus explicites de la règle appariée ;
- séparation auteur / approbateur de politique par défaut, assouplissable sous audit ;
- crate Rust compilée en WASM pour la politique et les reçus ;
- refus des instances non conformes, mode de qualification réservé aux administrateurs ;
- nouveau prédicat `destination-disclosure-leak` plutôt qu'un changement de sens de
  `public-data-leak`.

## Annexe A — Brouillon d'amendement d'ADR-0042 §1

Texte actuel (ADR-0042 §1, « Rattachements ») :

> Capture & Relay (`signalement`) est une capacité de **P15**. Sa qualification en
> cours est terminée et publiée, puis il est gelé : aucun nouveau lot avant le
> jalon B′.

Texte proposé :

> Capture & Relay (`signalement`) est le dépôt porteur de **P15** (projets, tickets et
> support). Il sort du gel : ses lots reprennent pour livrer la v1.0 décrite dans
> `libre-ai/signalement`, `docs/superpowers/specs/2026-10-22-v1-policy-routed-ticket-projection-design.md`.
> Le moratoire de création de dépôt ne s'applique pas : le dépôt existe.
> `ai-work-supervision` relève de la fabrique (produit zéro, I-13) et ne porte aucune
> application du catalogue, P15 comprise.

Ajout au préambule « Autorise » : « la sortie du gel de `signalement` ».

Texte adopté (ADR-0055, D1) :

> Capture & Relay (`signalement`) est le dépôt porteur de **P15** (projets,
> tickets et support). Il sort du gel : ses lots reprennent pour livrer la v1.0
> décrite dans son dépôt. Le moratoire de création de dépôt ne s'applique pas :
> le dépôt existe.

Forme : un ADR d'amendement dans `project-governance`. Fusionné le 2026-10-23 comme
ADR-0055, entrée D94 du registre (`libre-ai/project-governance` #134). La ligne
d'arbitrage est écrite par le propriétaire, jamais par l'agent.

## Annexe B — Correction de catalogue P15

- `inventaire/catalogue-p-xx.json` (dossier d'analyse `libre-ai-specs-2026-10-14`, hors
  dépôt), entrée P15 : `depot_porteur: "libre-ai/signalement"`, `statut: "partiel"`,
  note remplacée par la décision D2.
- `libre-ai/ai-work-supervision`, `docs/prd.md` et `docs/cahier-des-charges.md` : les
  passages qui associent P15 à ce dépôt (relevés le 2026-10-22 par
  `gh search code --owner libre-ai P15`) sont corrigés pour dire que P15 est porté
  par `signalement`.
- Registre des décisions de `project-governance` : nouvelle ligne qui cite
  l'amendement et D2.
