# L4 control plane — partie 1 : phase A, données et isolation

Index, Global Constraints et Review Focus : `2026-10-24-v1-L4-control-plane.md`.

Sortie de phase : schéma migré, RLS forcée et prouvée par `cross-organization-disclosure`,
rôle applicatif sans `BYPASSRLS`, chiffrement par enveloppe, clés Ed25519, stockage
d'artefacts POSIX et S3, journal d'audit chaîné. Aucune route HTTP.

### Task 1: Infrastructure de test PostgreSQL (local et CI)

**Files:**
- Create: `tools/ci/with-postgres.ts`, `tools/ci/with-postgres.test.ts`,
  `tools/ci/postgres-image.txt`, `apps/control-plane/test/db.ts`,
  `apps/control-plane/test/db.test.ts`
- Modify: `package.json:42` (script `test`), `.github/workflows/ci.yml:21-43` (service
  conteneur du job `bun-quality`)
- Test: `tools/ci/with-postgres.test.ts`, `apps/control-plane/test/db.test.ts`

**Interfaces:**
- Consumes: aucune.
- Produces:
  ```ts
  // tools/ci/with-postgres.ts — CLI: bun tools/ci/with-postgres.ts -- <command...>
  export interface PostgresSource { kind: "environment" | "docker"; adminUrl: URL; major: number; }
  export function parseImageReference(text: string): { repository: string; tag: string; digest: string };
  export function bootstrapRoleStatements(passwords: { owner: string; app: string }): string[];
  // apps/control-plane/test/db.ts
  export interface TestDatabase { name: string; ownerUrl: URL; appUrl: URL; owner: Bun.SQL; app: Bun.SQL; drop(): Promise<void>; }
  export function createTestDatabase(): Promise<TestDatabase>;
  ```

- [ ] **Résoudre l'image.** Prendre la version majeure PostgreSQL la plus haute de l'offre
  gérée Clever Cloud (`clever addon providers show postgresql-addon`, ou la page de
  l'offre ; citer la source dans le commit). Digest :
  `docker buildx imagetools inspect postgres:<major> --format '{{json .Manifest.Digest}}'`.
  Écrire la ligne unique `postgres:<major>@sha256:<digest>` dans
  `tools/ci/postgres-image.txt`.
- [ ] **Test qui échoue** (`tools/ci/with-postgres.test.ts`) :
  ```ts
  test("image reference must carry a tag and a sha256 digest", () => {
    expect(() => parseImageReference("postgres:17")).toThrow("postgres.image_unpinned");
    expect(parseImageReference(`postgres:17@sha256:${"a".repeat(64)}`))
      .toEqual({ repository: "postgres", tag: "17", digest: `sha256:${"a".repeat(64)}` });
  });
  test("the CI service image is the pinned image", async () => {
    const pinned = (await Bun.file("tools/ci/postgres-image.txt").text()).trim();
    const ci = Bun.YAML.parse(await Bun.file(".github/workflows/ci.yml").text()) as any;
    expect(ci.jobs["bun-quality"].services.postgres.image).toBe(pinned);
  });
  test("bootstrap roles never grant superuser, bypassrls, createrole or createdb", () => {
    const sql = bootstrapRoleStatements({ owner: "0".repeat(32), app: "1".repeat(32) }).join("\n");
    expect(sql).toContain("NOBYPASSRLS");
    expect(sql).not.toMatch(/(?<!NO)(SUPERUSER|BYPASSRLS|CREATEROLE|CREATEDB)\b/);
  });
  test("passwords that are not 32 lowercase hex characters are refused before interpolation", () => {
    expect(() => bootstrapRoleStatements({ owner: "x'; drop", app: "1".repeat(32) })).toThrow("postgres.password_shape");
  });
  ```
- [ ] **Exécution rouge :** `bun test tools/ci/with-postgres.test.ts` → `Cannot find module`.
- [ ] **Implémentation** `with-postgres.ts` :
  - source `environment` si `SIGNALEMENT_TEST_DATABASE_ADMIN_URL` est défini (CI) ;
    sinon `docker` : `Bun.which("docker")` absent → sortie `1`, stderr
    `postgres.unavailable: docker not found` ;
  - `docker run -d --rm -e POSTGRES_PASSWORD=<32 hex aléatoires> -p 127.0.0.1::5432
    <image>`, port lu par `docker port`, connexion SQL répétée jusqu'à 30 s, puis
    `bootstrapRoleStatements` en superutilisateur ;
  - rôles `signalement_owner` et `signalement_app`, tous deux `LOGIN NOSUPERUSER
    NOBYPASSRLS NOCREATEROLE NOCREATEDB` ; les bases de test sont créées par l'admin
    avec `OWNER signalement_owner` ;
  - exporte `SIGNALEMENT_TEST_DATABASE_ADMIN_URL`, `SIGNALEMENT_TEST_OWNER_PASSWORD`,
    `SIGNALEMENT_TEST_APP_PASSWORD` au fils, relaie son code ; `docker rm -f` en
    `finally`, y compris sur `SIGINT`/`SIGTERM` ;
  - imprime `postgres: source=<kind> major=<n>` avant le fils (gate-integrity §2).
- [ ] **Implémentation** `test/db.ts` : gabarit `signalement_template` migré une fois par
  processus (alimenté à partir de la Task 3), puis `CREATE DATABASE t_<16 hex> TEMPLATE
  signalement_template OWNER signalement_owner` ; `drop()` termine les connexions et
  supprime la base ; variable absente → `throw new Error("postgres.unavailable")`.
- [ ] **Test qui échoue** (`test/db.test.ts`) : `the app role is neither superuser nor
  bypassrls` (`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`
  par `db.app` → `{ rolsuper: false, rolbypassrls: false }`) ; `two test databases are
  disjoint` (noms différents).
- [ ] **Brancher.** `package.json:42` : `"test": "bun tools/ci/with-postgres.ts -- bun test"`.
  `ci.yml`, job `bun-quality` : `services.postgres` avec `image` = contenu de
  `postgres-image.txt`, `env.POSTGRES_HOST_AUTH_METHOD: trust` (un service démarre
  avant les étapes et ne peut lire aucun mot de passe produit par une étape ; `trust`
  évite tout mot de passe littéral, sur un runner éphémère ; le dire dans le commit),
  `ports: ["127.0.0.1:5432:5432"]`, santé `pg_isready` ; l'étape `check:tree` reçoit
  `SIGNALEMENT_TEST_DATABASE_ADMIN_URL` (utilisateur `postgres`, hôte `127.0.0.1`).
  Les rôles applicatifs reçoivent quand même des mots de passe aléatoires.
- [ ] **Exécution verte :** `bun run test` → `postgres: source=docker major=<n>` puis vert ;
  `SIGNALEMENT_TEST_DATABASE_ADMIN_URL= PATH=/usr/bin bun tools/ci/with-postgres.ts -- true`
  → code `1`, `postgres.unavailable`.
- [ ] **Neutralisation :** `NOBYPASSRLS` → `BYPASSRLS` pour `signalement_app` dans
  `bootstrapRoleStatements` → les deux tests de rôle rougissent ; restaurer.
- [ ] **Commit :** `git add tools/ci/with-postgres.ts tools/ci/with-postgres.test.ts tools/ci/postgres-image.txt apps/control-plane/test/db.ts apps/control-plane/test/db.test.ts package.json .github/workflows/ci.yml`
  puis `git commit -s -m "test(control-plane): provision pinned PostgreSQL for local and CI test runs"`.

### Task 2: Configuration fermée par défaut

**Files:**
- Create: `apps/control-plane/src/config.ts`, `apps/control-plane/src/config.test.ts`
- Test: `apps/control-plane/src/config.test.ts`

**Interfaces:**
- Consumes: aucune.
- Produces:
  ```ts
  export interface MasterKeyring { activeId: string; keys: ReadonlyMap<string, Uint8Array>; }
  export type ArtifactStoreConfig =
    | { kind: "posix"; root: string }
    | { kind: "s3"; endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string };
  export interface AppConfig {
    publicOrigin: string;            // new URL(x).origin; https except localhost/127.0.0.1
    organizationId: string;          // UUID, D12: one organization per deployment
    databaseUrl: URL;                // runtime role
    migrationDatabaseUrl: URL | null;// owner role; null = single-role mode (Task 4)
    keyring: MasterKeyring;
    oidc: { issuer: string; clientId: string; clientSecret: string; redirectUri: string };
    artifactStore: ArtifactStoreConfig;
    externalEffects: "enabled" | "disabled";
    allowPrivateDestinations: boolean;
    matrixPath: string;
  }
  export class ConfigError extends Error { readonly code: string; }
  export function loadConfig(env: Record<string, string | undefined>): AppConfig;
  ```

- [ ] **Test qui échoue** : table de cas sur un `validEnv()` synthétique (domaines
  `example.test`), une clé altérée par cas :

  | Cas | Altération | Code attendu |
  | --- | --- | --- |
  | trousseau absent | `SIGNALEMENT_MASTER_KEYRING` absent | `config.master_keyring_missing` |
  | clé active absente | `{ active: "k2", keys: { k1 } }` | `config.master_keyring_active_missing` |
  | clé courte | clé de 16 octets | `config.master_key_length` |
  | id invalide | id `"K 1"` | `config.master_key_id` |
  | origine http | `http://cp.example.test` | `config.public_origin_insecure` |
  | origine avec chemin | `https://cp.example.test/app` | `config.public_origin_not_origin` |
  | organisation | `acme` | `config.organization_id` |
  | S3 sans bucket | `SIGNALEMENT_ARTIFACT_STORE=s3`, bucket absent | `config.s3_bucket_missing` |
  | stockage inconnu | `ftp` | `config.artifact_store` |
  | effets | `yes` | `config.external_effects` |

  Plus : `external effects default to disabled` ; `http is accepted for localhost only`
  (`http://localhost:3000` accepté) ; `a config error never carries a secret value` (le
  message ne contient pas la clé fournie).
- [ ] **Exécution rouge :** `bun test apps/control-plane/src/config.test.ts`.
- [ ] **Implémentation.** Variables : `SIGNALEMENT_PUBLIC_ORIGIN`,
  `SIGNALEMENT_ORGANIZATION_ID`, `SIGNALEMENT_DATABASE_URL`,
  `SIGNALEMENT_MIGRATION_DATABASE_URL` (facultative), `SIGNALEMENT_MASTER_KEYRING` (JSON
  `{ "active": "<id>", "keys": { "<id>": "<base64 de 32 octets>" } }`, id
  `^[a-z0-9-]{1,32}$`), `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`,
  `OIDC_REDIRECT_URI` (= `<publicOrigin>/auth/callback`), `SIGNALEMENT_ARTIFACT_STORE`
  (`posix` | `s3`), `SIGNALEMENT_ARTIFACT_ROOT`, `SIGNALEMENT_S3_ENDPOINT|BUCKET|REGION|
  ACCESS_KEY_ID|SECRET_ACCESS_KEY`, `SIGNALEMENT_EXTERNAL_EFFECTS`,
  `SIGNALEMENT_ALLOW_PRIVATE_DESTINATIONS` (`true` | absent), `SIGNALEMENT_PROVIDER_MATRIX`
  (défaut : `qualification/provider-matrix.yaml` résolu depuis `import.meta.dir`).
  Messages d'erreur : texte fixe par code.
- [ ] **Exécution verte.**
- [ ] **Neutralisation :** défaut `externalEffects = "enabled"` → `external effects default
  to disabled` rougit ; restaurer.
- [ ] **Commit :** `git add apps/control-plane/src/config.ts apps/control-plane/src/config.test.ts`
  puis `git commit -s -m "feat(control-plane): fail-closed environment configuration"`.

### Task 3: Exécuteur de migrations versionnées

**Files:**
- Create: `apps/control-plane/src/db/migrate.ts`, `apps/control-plane/src/db/migrate.test.ts`,
  `apps/control-plane/migrations/0001_schema.sql`
- Modify: `apps/control-plane/test/db.ts` (gabarit migré par `migrate`)
- Test: `apps/control-plane/src/db/migrate.test.ts`

**Interfaces:**
- Consumes: `TestDatabase` (Task 1).
- Produces:
  ```ts
  export interface MigrationFile { version: number; name: string; sql: string; sha256: string; }
  export function readMigrations(directory: string): Promise<MigrationFile[]>;
  export function migrate(owner: Bun.SQL, files: readonly MigrationFile[]): Promise<{ applied: number; skipped: number }>;
  // errors: "migration.name" | "migration.duplicate_version" | "migration.checksum_mismatch" | "migration.missing" | "migration.out_of_order"
  // CLI: bun apps/control-plane/src/db/migrate.ts  (SIGNALEMENT_MIGRATION_DATABASE_URL ?? SIGNALEMENT_DATABASE_URL)
  ```

- [ ] **Test qui échoue** (répertoires synthétiques sous `mktemp -d`) :
  ```ts
  test("applies pending migrations once and records their checksum", async () => {
    expect(await migrate(db.owner, files(["0001_a.sql", "create table signalement.a(x int);"]))).toEqual({ applied: 1, skipped: 0 });
    expect(await migrate(db.owner, files(["0001_a.sql", "create table signalement.a(x int);"]))).toEqual({ applied: 0, skipped: 1 });
  });
  test("a failing migration leaves no partial schema and no record", async () => {
    expect(migrate(db.owner, files(["0001_a.sql", "create table signalement.p(x int); select 1/0;"]))).rejects.toThrow();
    const [row] = await db.owner`select to_regclass('signalement.p') as t, (select count(*)::int from signalement.schema_migrations) as n`;
    expect(row).toEqual({ t: null, n: 0 });
  });
  test("two concurrent runners apply each migration exactly once", async () => {
    const [a, b] = await Promise.all([migrate(db.owner, set), migrate(db.owner, set)]);
    expect(a.applied + b.applied).toBe(set.length);
  });
  ```
  Plus un test par code : contenu modifié après application → `migration.checksum_mismatch` ;
  fichier appliqué retiré → `migration.missing` ; `0001` ajouté après `0002` appliqué →
  `migration.out_of_order` ; `1_a.sql` → `migration.name`.
- [ ] **Exécution rouge :** `bun tools/ci/with-postgres.ts -- bun test apps/control-plane/src/db/migrate.test.ts`.
- [ ] **Implémentation.** `create schema if not exists signalement` ; table
  `signalement.schema_migrations(version int primary key, name text not null, sha256 text
  not null, applied_at timestamptz not null default now())` ; sérialisation par
  `pg_advisory_lock(hashtext('signalement.migrations'))` sur une connexion réservée
  (`owner.reserve()`) ; chaque migration dans `owner.begin(tx => …)` par
  `tx.unsafe(file.sql)` puis insertion de suivi dans la même transaction ; nom
  `^\d{4}_[a-z0-9_]+\.sql$` ; `sha256` hexadécimal minuscule des octets du fichier.
  `0001_schema.sql` ne crée que le schéma.
- [ ] **Exécution verte.**
- [ ] **Neutralisation :** remplacer la comparaison de checksum par `true` → le cas
  `migration.checksum_mismatch` rougit ; restaurer.
- [ ] **Commit :** `git add apps/control-plane/src/db/migrate.ts apps/control-plane/src/db/migrate.test.ts apps/control-plane/migrations/0001_schema.sql apps/control-plane/test/db.ts`
  puis `git commit -s -m "feat(control-plane): checksummed, serialized SQL migration runner"`.

### Task 4: Schéma, RLS forcée, droits du rôle applicatif

**Files:**
- Create: `apps/control-plane/migrations/0002_organizations_identity.sql`,
  `0003_dossiers_artifacts.sql`, `0004_policies_destinations.sql`,
  `0005_projections_outbox_receipts.sql`, `0006_keys_tokens_audit.sql`,
  `apps/control-plane/src/db/grants.ts`, `apps/control-plane/src/db/runtime-role.ts`,
  `apps/control-plane/src/db/schema.test.ts`
- Test: `apps/control-plane/src/db/schema.test.ts`

**Interfaces:**
- Consumes: `migrate` (Task 3).
- Produces:
  ```ts
  export function applyGrants(owner: Bun.SQL, appRole: string): Promise<{ tables: number }>;
  export function assertRuntimeRole(app: Bun.SQL): Promise<{ role: string; singleRoleMode: boolean }>;
  // errors: "db.runtime_role_superuser" | "db.runtime_role_bypassrls"
  export const ORGANIZATION_SETTING = "app.organization";
  export const EXPECTED_TABLES: readonly string[];   // the 21 tables below
  ```

Tables (schéma `signalement`, identifiants `uuid` par `Bun.randomUUIDv7()` sauf mention ;
`organization uuid not null references signalement.organizations(id)` partout sauf
`schema_migrations` et `organizations`) :

| Migration | Tables et contraintes décisives |
| --- | --- |
| 0002 | `organizations(id uuid pk, display_name, policy_approval_separation text default 'required' check in ('required','relaxed'), created_at)` ; `role_mappings(organization, claim, value, role check in ('reporter','policy-admin','auditor'), unique(organization, claim, value, role))` ; `sessions(id_sha256 bytea pk, organization, issuer, subject, principal_ref, roles text[], created_at, expires_at, idle_expires_at, revoked_at)` ; `organization_setting_changes(id, organization, setting check in ('policy_approval_separation'), value, author_ref, approver_ref null, state check in ('draft','approved','rejected'), created_at, decided_at, check (approver_ref is null or approver_ref <> author_ref))` |
| 0003 | `dossiers(id, organization, producer_dossier_id, submitter_issuer, submitter_subject, submitter_ref, created_at, unique(organization, producer_dossier_id, submitter_issuer, submitter_subject))` ; `dossier_revisions(id, organization, dossier_id, producer_revision int, export_sha256 check ~ '^[0-9a-f]{64}$', export_byte_length bigint, observed_origin null, received_at, unique(organization, dossier_id, export_sha256))` ; `artifacts(id, organization, revision_id, path, role check in ('manifest','document','screenshot','video'), mime_type, byte_length bigint, sha256, storage_key, unique(organization, revision_id, path))` |
| 0004 | `policy_versions(id, organization, version int, document bytea /* JCS */, digest, state check in ('draft','approved','retired'), author_ref, approver_ref null, created_at, approved_at, retired_at, unique(organization, version))` + unique partiel `(organization) where state = 'approved'` ; `destinations(id, organization, destination_id, profile_id check ~ '^[a-z0-9-]+/[a-z0-9.-]+/[a-z0-9.-]+$', target jsonb, declared jsonb, mode check in ('production','qualification'), state check in ('active','disabled'), created_by_ref, created_at, unique(organization, destination_id))` ; `provider_credentials(id, organization, destination_row_id, envelope bytea, created_at, rotated_at, unique(organization, destination_row_id))` |
| 0005 | `projections(id text /* projectionId() */, organization, dossier_id, destination_id, state check in (6 ProjectionState), remote_id null, remote_url null, updated_at, primary key(organization, id))` ; `approvals(id, organization, revision_id, approver_ref, verdict_digest, policy_version_id, created_at)` ; `deliveries(id, organization, projection_id, revision_id, approval_id, idempotency_key, plan jsonb, plan_digest, planned_attributes jsonb, policy_version_id, mapping_version, kind check in ('create','comment'), state check in (6 ProjectionState), attempts int default 0, ambiguous boolean default false, sent_body_digests text[] default '{}', first_attempt_at null, last_failure_code null, receipt_pending boolean default false, created_at, updated_at, unique(organization, idempotency_key))` ; `outbox(seq bigint generated always as identity, organization, delivery_id unique, state check in ('pending','leased','done','dead'), available_at, lease_until null, attempts int, primary key(organization, seq))` ; `outbox_cursors(organization, consumer, position bigint, primary key(organization, consumer))` ; `receipts(id, organization, delivery_id unique, key_id, bytes bytea, sha256, issued_at)` ; `projection_remote_state(organization, projection_id, cursor null, status null, closed null, observed_at, primary key(organization, projection_id))` |
| 0006 | `signing_keys(key_id, organization, purpose check in ('receipt','biscuit-root'), public_key bytea check octet_length = 32, secret_envelope bytea, state check in ('active','retired'), created_at /* notBefore */, retired_at /* notAfter */, primary key(organization, key_id))` + unique partiel `(organization, purpose) where state = 'active'` ; `api_tokens(id, organization, owner_ref, revocation_ids text[], roles text[], expires_at, created_at)` ; `revoked_tokens(organization, revocation_id, revoked_at, reason check in ('user','admin','rotation'), expires_at, primary key(organization, revocation_id))` ; `audit_log(seq bigint generated always as identity, organization, at, actor_ref null, event_type, payload jsonb, prev_hash, entry_hash, primary key(organization, seq))` + déclencheur `before update or delete` qui lève `audit_log.append_only` |

Sur chaque table portant `organization` (et `organizations` sur `id`) : `enable` puis
`force row level security` ; politique unique `organization_isolation`, `using
(organization = nullif(current_setting('app.organization', true), '')::uuid) with check
(même expression)`. Sans réglage : zéro ligne lue, aucune écriture.

- [ ] **Test qui échoue** (`schema.test.ts`) :
  ```ts
  test("every table except schema_migrations carries organization, RLS enabled and forced, and one policy", async () => {
    const rows = await db.owner`
      select c.relname as table, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
             (c.relname = 'organizations' or exists(select 1 from information_schema.columns k
                where k.table_schema='signalement' and k.table_name=c.relname
                and k.column_name = 'organization' and k.is_nullable = 'NO')) as scoped,
             (select count(*)::int from pg_policies p where p.schemaname='signalement' and p.tablename=c.relname) as policies
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='signalement' and c.relkind='r' and c.relname <> 'schema_migrations'`;
    console.log(`rls sweep: ${rows.length} tables inspected`);
    expect(rows.map((r) => r.table).sort()).toEqual([...EXPECTED_TABLES].sort());
    for (const r of rows) expect(r).toMatchObject({ rls: true, forced: true, scoped: true, policies: 1 });
  });
  ```
  Plus : `a session without app.organization sees nothing and writes nothing` (lecture →
  0 ligne, insertion → erreur `row-level security`) ; `the app role cannot update or
  delete the audit log` (permission refusée) ; `the audit log refuses update even for the
  owner` (`audit_log.append_only`) ; `assertRuntimeRole refuses a bypassrls role` (rôle
  jetable `BYPASSRLS LOGIN` créé par l'admin de test → `db.runtime_role_bypassrls`) ;
  `setting change author and approver must differ` (violation de contrainte).
- [ ] **Exécution rouge.**
- [ ] **Implémentation.** Cinq migrations. `applyGrants` (lancé par la CLI de migration
  après `migrate`, idempotent) : si `appRole` ≠ rôle courant, `usage` sur le schéma,
  `select, insert, update` sur toutes les tables, `usage` sur les séquences, puis
  `revoke update, delete on audit_log` et `revoke delete` partout sauf `sessions` et
  `outbox_cursors` ; si `appRole` = rôle courant (mode mono-rôle), ne rien accorder et
  compter sur `force row level security` et le déclencheur. `assertRuntimeRole` est
  appelée au démarrage (Task 10) avant toute route.
- [ ] **Exécution verte :** la ligne `rls sweep: 21 tables inspected` apparaît (4 + 3 +
  3 + 7 + 4 ; la Task 13 n'ajoute qu'un déclencheur).
- [ ] **Neutralisation :** retirer `force row level security` de `dossiers` → le balayage
  rougit ; retirer le déclencheur `append_only` → le test du propriétaire rougit.
- [ ] **Commit :** `git add apps/control-plane/migrations/0002_organizations_identity.sql apps/control-plane/migrations/0003_dossiers_artifacts.sql apps/control-plane/migrations/0004_policies_destinations.sql apps/control-plane/migrations/0005_projections_outbox_receipts.sql apps/control-plane/migrations/0006_keys_tokens_audit.sql apps/control-plane/src/db/grants.ts apps/control-plane/src/db/runtime-role.ts apps/control-plane/src/db/schema.test.ts`
  puis `git commit -s -m "feat(control-plane): organization-scoped schema with forced row-level security"`.

### Task 5: Accès scopé par organisation et suite `cross-organization-disclosure`

**Files:**
- Create: `apps/control-plane/src/db/scope.ts`, `apps/control-plane/test/seed.ts`,
  `apps/control-plane/test/cross-organization-disclosure.test.ts`
- Test: `apps/control-plane/test/cross-organization-disclosure.test.ts`

**Interfaces:**
- Consumes: schéma (Task 4).
- Produces:
  ```ts
  export type ScopedTx = Bun.SQL;   // transaction handle with app.organization set
  export function withOrganization<T>(app: Bun.SQL, organization: string, work: (tx: ScopedTx) => Promise<T>): Promise<T>;
  // test/seed.ts
  export interface SeededOrganization { id: string; dossierId: string; revisionId: string; policyVersionId: string; destinationRowId: string; deliveryId: string; receiptId: string; signingKeyId: string; }
  export function seedTwoOrganizations(db: TestDatabase): Promise<{ a: SeededOrganization; b: SeededOrganization }>;
  ```

- [ ] **Test qui échoue** (design §5.7 : deux organisations, accès croisé refusé par
  requête SQL directe) :
  ```ts
  const ORG_TABLES = EXPECTED_TABLES.filter((t) => t !== "organizations");
  test.each(ORG_TABLES)("organization A cannot read organization B rows in %s", async (table) => {
    const { a, b } = await seedTwoOrganizations(db);
    const rows = await withOrganization(db.app, a.id, (tx) => tx.unsafe(`select organization from signalement.${table}`));
    expect(rows.some((r: { organization: string }) => r.organization === b.id)).toBe(false);
    expect(rows.every((r: { organization: string }) => r.organization === a.id)).toBe(true);
  });
  test("app.organization does not leak to the next transaction on the same pooled connection", async () => {
    await withOrganization(db.app, a.id, async () => {});
    expect(await db.app`select current_setting('app.organization', true) as v`).toEqual([{ v: "" }]);
  });
  test("the suite inspected every organization table", () => {
    console.log(`cross-organization-disclosure: ${ORG_TABLES.length} tables x 3 operations`);
    expect(ORG_TABLES.length).toBe(EXPECTED_TABLES.length - 1);
  });
  ```
  Plus, pour chaque table : insertion d'une ligne étiquetée B depuis A → violation
  `WITH CHECK` ; `update … where organization = b.id` depuis A → 0 ligne ; et `organization
  A cannot reach B by guessing a primary key` (`where id = b.dossierId` → `[]`).
- [ ] **Exécution rouge.**
- [ ] **Implémentation.** `app.begin(async (tx) => { await tx\`select
  set_config('app.organization', ${organization}, true)\`; return work(tx); })` ; le
  troisième argument `true` borne le réglage à la transaction ; `organization` validé UUID
  (`db.organization_invalid`). Contrôle de revue : `grep -rn "signalement\."
  apps/control-plane/src --include=*.ts` ne liste que des requêtes faites avec un `tx`
  issu de `withOrganization` (hors `migrate.ts`, `grants.ts`, `runtime-role.ts`).
- [ ] **Exécution verte.**
- [ ] **Neutralisation :** `false` au lieu de `true` dans `set_config` → le test de fuite
  rougit ; une politique `using (true)` sur une table (migration de test) → le cas de
  cette table rougit.
- [ ] **Commit :** `git add apps/control-plane/src/db/scope.ts apps/control-plane/test/seed.ts apps/control-plane/test/cross-organization-disclosure.test.ts`
  puis `git commit -s -m "test(control-plane): cross-organization-disclosure suite over every organization table"`.

### Task 6: Chiffrement par enveloppe (AES-256-GCM, AES-KW)

**Files:**
- Create: `apps/control-plane/src/crypto/envelope.ts`, `apps/control-plane/src/crypto/envelope.test.ts`
- Test: `apps/control-plane/src/crypto/envelope.test.ts`

**Interfaces:**
- Consumes: `MasterKeyring` (Task 2).
- Produces:
  ```ts
  export type EnvelopePurpose = "provider-credential" | "signing-key" | "biscuit-root" | "artifact" | "oidc-login";
  export interface EnvelopeContext { organization: string; purpose: EnvelopePurpose; table: string; rowId: string; }
  export function seal(plaintext: Uint8Array, context: EnvelopeContext, keyring: MasterKeyring): Promise<Uint8Array>;
  export function open(envelope: Uint8Array, context: EnvelopeContext, keyring: MasterKeyring): Promise<Uint8Array>;
  export function rewrap(envelope: Uint8Array, keyring: MasterKeyring): Promise<Uint8Array>;
  export function envelopeKeyId(envelope: Uint8Array): string;
  ```

Format : `"SGE1"` (4) ‖ longueur de l'id maître (1) ‖ id UTF-8 ‖ DEK enveloppée AES-KW
(40) ‖ IV aléatoire (12) ‖ chiffré AES-256-GCM avec tag (16). Données authentifiées :
`JSON.stringify(["signalement/envelope/v1", organization, purpose, table, rowId])`. DEK
de 32 octets aléatoire par `seal`.

- [ ] **Test qui échoue :**
  ```ts
  test("a ciphertext moved to another row fails to decrypt", async () => {
    const sealed = await seal(bytes, { ...ctx, rowId: "row-1" }, ring);
    expect(open(sealed, { ...ctx, rowId: "row-2" }, ring)).rejects.toThrow("envelope.open_failed");
  });
  test("rewrap moves to the active master key and keeps the plaintext", async () => {
    const moved = await rewrap(await seal(bytes, ctx, ringWithActive("k1")), ringWithActive("k2"));
    expect(envelopeKeyId(moved)).toBe("k2");
    expect(await open(moved, ctx, ringWithActive("k2"))).toEqual(bytes);
  });
  ```
  Plus : aller-retour ; changer `organization`, `purpose` ou `table` → échec ; un octet
  inversé aux positions 0, 5 et dernière → échec ; id maître inconnu →
  `envelope.unknown_master_key` ; deux `seal` du même clair diffèrent.
- [ ] **Exécution rouge :** `bun test apps/control-plane/src/crypto/envelope.test.ts`.
- [ ] **Implémentation** par `crypto.subtle` seul (`generateKey` AES-GCM 256 extractible
  pour la DEK, `wrapKey("raw", dek, kek, "AES-KW")`, `encrypt` AES-GCM avec
  `additionalData`) ; toute exception WebCrypto devient
  `envelope.open_failed`, sans message d'origine.
- [ ] **Exécution verte.**
- [ ] **Neutralisation :** omettre `additionalData` → le test de déplacement rougit.
- [ ] **Commit :** `git add apps/control-plane/src/crypto/envelope.ts apps/control-plane/src/crypto/envelope.test.ts`
  puis `git commit -s -m "feat(control-plane): context-bound AES-256-GCM envelope encryption"`.

### Task 7: Clés de signature Ed25519 (génération, identifiant, rotation, export)

**Files:**
- Create: `apps/control-plane/src/crypto/signing-keys.ts`, `apps/control-plane/src/crypto/signing-keys.test.ts`
- Test: `apps/control-plane/src/crypto/signing-keys.test.ts`

**Interfaces:**
- Consumes: `seal`/`open` (Task 6), `withOrganization` (Task 5) ; `loadPolicyReceipt`,
  `PolicyReceiptApi.signReceipt(unsigned, secretKey)`, `verifyReceipt`, `PublicKeySet`,
  `UnsignedReceipt` (registre §4.2) ; `rawSigningKeySetFailures` (L1).
- Produces:
  ```ts
  export const MAX_PUBLIC_KEYS = 1024;   // registry §4.2
  export interface GeneratedKey { keyId: string; publicKey: Uint8Array; secretSeed: Uint8Array; }
  export function generateEd25519(): Promise<GeneratedKey>;
  export function keyIdOf(publicKey: Uint8Array): Promise<string>;   // sha256 hex of the 32 raw bytes; fits L1 grammar ^[a-z0-9][a-z0-9-]{0,63}$
  export function rotateSigningKey(tx: ScopedTx, organization: string, purpose: "receipt" | "biscuit-root", keyring: MasterKeyring, api: PolicyReceiptApi): Promise<{ activeKeyId: string; retiredKeyId: string | null }>;
  export function loadActiveSecret(tx: ScopedTx, organization: string, purpose: "receipt" | "biscuit-root", keyring: MasterKeyring): Promise<{ keyId: string; secretSeed: Uint8Array }>;
  export function exportPublicKeys(tx: ScopedTx, organization: string): Promise<PublicKeySet>;   // purpose "receipt" only
  ```

Extraction de la graine : `generateKey({ name: "Ed25519" }, true, ["sign", "verify"])` ;
`exportKey("pkcs8")` doit faire 48 octets et commencer par
`302e020100300506032b657004220420` (RFC 8410 ; mesuré le 2026-10-24 sous Bun
1.4.4-canary, rejouer la mesure sous le Bun épinglé) ; graine = octets 16..48 ; clé
publique = `exportKey("raw")` (32 octets). Autre forme → `signing.key_format`.
`exportPublicKeys` produit la forme du registre §4.2 : `{ organization, keys: [{ keyId,
algorithm: "ed25519", publicKey: base64url sans remplissage, status, notBefore:
created_at, notAfter: retired_at | null }] }`, validée par `rawSigningKeySetFailures`
avant d'être rendue.

- [ ] **Test qui échoue :**
  ```ts
  test("generated keys sign a receipt that L2 verifies with the exported public set", async () => {
    const api = await loadPolicyReceipt();
    await rotate("receipt");
    const { keyId, secretSeed } = await withOrganization(db.app, ORG_A, (tx) => loadActiveSecret(tx, ORG_A, "receipt", ring));
    const signed = api.signReceipt({ ...PROBE_UNSIGNED_RECEIPT, keyId }, secretSeed);
    const set = await withOrganization(db.app, ORG_A, (tx) => exportPublicKeys(tx, ORG_A));
    expect(rawSigningKeySetFailures(api.canonicalize(set))).toEqual([]);
    expect(api.verifyReceipt(api.canonicalize(signed), set)).toMatchObject({ signature: "valid", keyId, keyStatus: "active" });
  });
  test("rotation keeps exactly one active key per purpose and exports retired keys with notAfter", async () => {
    const first = await rotate("receipt"); const second = await rotate("receipt");
    expect(second.retiredKeyId).toBe(first.activeKeyId);
    const set = await withOrganization(db.app, ORG_A, (tx) => exportPublicKeys(tx, ORG_A));
    expect(set.keys.find((k) => k.keyId === first.activeKeyId)).toMatchObject({ status: "retired", notAfter: expect.any(String) });
  });
  ```
  Plus : `keyId is the sha256 of the raw public key` ; `the secret seed is stored sealed,
  never in clear` ; `a key that fails the L2 sign-verify self-test is not stored`
  (`api` dont `verifyReceipt` rend `invalid` → `signing.self_test_failed`, 0 ligne) ;
  `rotation beyond MAX_PUBLIC_KEYS receipt keys is refused` (1024 clés amorcées en base →
  `signing.key_set_full`, aucune clé retirée perdue). `PROBE_UNSIGNED_RECEIPT` vient des
  fixtures valides vendorisées du contrat `signalement-projection-receipt-v1`.
- [ ] **Exécution rouge.**
- [ ] **Implémentation.** `rotateSigningKey` en une transaction : génère, passe
  l'auto-test L2 (signature d'un reçu sonde puis `verifyReceipt` → `valid`), scelle la
  graine (`purpose` `"signing-key"` ou `"biscuit-root"`, `rowId` = `keyId`), retire
  l'ancienne active, insère la nouvelle. L'audit `signing_key.rotated` est branché par la
  Task 9. Pour `biscuit-root`, la même graine Ed25519 alimente la clé racine Biscuit
  (Task 22).
- [ ] **Exécution verte.**
- [ ] **Neutralisation :** graine aux octets 0..32 → le premier test rougit (`invalid`).
- [ ] **Commit :** `git add apps/control-plane/src/crypto/signing-keys.ts apps/control-plane/src/crypto/signing-keys.test.ts`
  puis `git commit -s -m "feat(control-plane): Ed25519 signing keys with rotation and public export"`.

### Task 8: Stockage d'artefacts (interface, POSIX, S3), chiffré

**Files:**
- Create: `apps/control-plane/src/artifacts/store.ts`, `posix.ts`, `s3.ts`,
  `store.test.ts`, `s3-live.test.ts` (sous `apps/control-plane/src/artifacts/`),
  `apps/control-plane/test/fake-s3.ts`
- Test: `apps/control-plane/src/artifacts/store.test.ts`

**Interfaces:**
- Consumes: `seal`/`open` (Task 6), `ArtifactStoreConfig` (Task 2).
- Produces:
  ```ts
  export interface ArtifactStore {
    put(key: string, bytes: Uint8Array): Promise<void>;          // idempotent overwrite of identical bytes
    get(key: string): Promise<Uint8Array | null>;
    delete(key: string): Promise<void>;
  }
  export function artifactKey(organization: string, revisionId: string, artifactId: string): string; // "org/<uuid>/rev/<uuid>/<uuid>"
  export function createPosixStore(root: string): ArtifactStore;
  export function createS3Store(config: Extract<ArtifactStoreConfig, { kind: "s3" }>): ArtifactStore;   // Bun.S3Client
  export function encryptedStore(inner: ArtifactStore, keyring: MasterKeyring): {
    putArtifact(context: EnvelopeContext, key: string, bytes: Uint8Array): Promise<void>;
    getArtifact(context: EnvelopeContext, key: string): Promise<Uint8Array | null>;
  };
  ```

- [ ] **Test qui échoue**, même suite contre POSIX (répertoire `mktemp -d`) et S3
  (`test/fake-s3.ts` : `Bun.serve` en processus, `PUT|GET|HEAD|DELETE` sur
  `/<bucket>/<key>`, requêtes enregistrées, SigV4 non vérifiée) : aller-retour ; clés
  `../x`, `org/a/../../etc`, `/abs`, `org/A/rev/x/y`, `""` → `artifact.key` ; `bytes at
  rest are ciphertext` (le clair n'apparaît pas dans `inner.get`). Plus : écriture POSIX
  atomique (échec entre écriture temporaire et `rename` → `get` rend `null`) ; le client
  S3 vise le bucket configuré et la clé secrète n'apparaît dans aucune sortie capturée.
- [ ] **Exécution rouge.**
- [ ] **Implémentation.** Clé `^org/[0-9a-f-]{36}/rev/[0-9a-f-]{36}/[0-9a-f-]{36}$` (UUID
  seulement, jamais un chemin venu de l'export) ; POSIX : `Bun.write` vers
  `<chemin>.tmp-<hex>` puis `rename`, répertoires `0700` ; S3 : `new Bun.S3Client({
  endpoint, bucket, region, accessKeyId, secretAccessKey })`, `file(key).write`,
  `.arrayBuffer()`, `.exists()`, `.delete()`.
- [ ] **Contrat S3 réel.** `s3-live.test.ts` ne tourne que si `SIGNALEMENT_TEST_S3_ENDPOINT`
  est défini ; sinon il imprime `s3-live: unavailable (no endpoint)` et n'échoue que si
  `SIGNALEMENT_REQUIRE_S3_LIVE=true` (vérification de déploiement, Task 29).
  `unavailable` n'est jamais rapporté vert.
- [ ] **Exécution verte.**
- [ ] **Neutralisation :** `putArtifact` écrit le clair → `bytes at rest are ciphertext`
  rougit pour les deux implémentations.
- [ ] **Commit :** `git add apps/control-plane/src/artifacts apps/control-plane/test/fake-s3.ts`
  puis `git commit -s -m "feat(control-plane): encrypted artifact store with POSIX and S3 backends"`.

### Task 9: Journal d'audit chaîné et journal applicatif sans donnée personnelle

**Files:**
- Create: `apps/control-plane/src/audit/journal.ts`, `apps/control-plane/src/audit/journal.test.ts`,
  `apps/control-plane/src/log.ts`, `apps/control-plane/src/log.test.ts`
- Modify: `apps/control-plane/src/crypto/signing-keys.ts` (`appendAudit` dans `rotateSigningKey`)
- Test: `apps/control-plane/src/audit/journal.test.ts`, `apps/control-plane/src/log.test.ts`

**Interfaces:**
- Consumes: `withOrganization`, `PolicyReceiptApi.canonicalize`.
- Produces:
  ```ts
  export type AuditEvent =
    | { type: "policy.drafted" | "policy.approved" | "policy.retired"; policyVersionId: string; version: number; digest: string }
    | { type: "setting.change.requested" | "setting.change.approved" | "setting.change.rejected"; changeId: string; setting: "policy_approval_separation"; value: "required" | "relaxed" }
    | { type: "destination.configured" | "destination.refused" | "destination.disabled"; destinationId: string; profileId: string; mode: "production" | "qualification"; code: string | null }
    | { type: "credential.rotated"; destinationId: string }
    | { type: "dossier.revision.received"; dossierId: string; revisionId: string; exportSha256: string; observedOrigin: "present" | "absent" }
    | { type: "upload.refused"; code: string; failureCount: number }
    | { type: "plan.evaluated"; revisionId: string; policyVersionId: string; policyDigest: string; matchedRuleIds: string[]; deniedCount: number; verdictDigest: string }
    | { type: "delivery.approved"; approvalId: string; deliveryIds: string[]; planDigests: string[] }
    | { type: "delivery.succeeded"; deliveryId: string; receiptId: string; remoteId: string }
    | { type: "delivery.to_resolve" | "delivery.failed" | "delivery.retry_scheduled"; deliveryId: string; code: string }
    | { type: "signing_key.rotated"; purpose: "receipt" | "biscuit-root"; activeKeyId: string; retiredKeyId: string | null }
    | { type: "token.issued" | "token.revoked"; tokenId: string; roles: string[] }
    | { type: "session.started" | "session.ended"; reason: string };
  export interface AuditRow { seq: number; organization: string; at: string; actorRef: string | null; eventType: string; payload: unknown; prevHash: string; entryHash: string; }
  export function appendAudit(tx: ScopedTx, organization: string, actorRef: string | null, event: AuditEvent, api: PolicyReceiptApi): Promise<{ seq: number; entryHash: string }>;
  export function verifyAuditChain(rows: readonly AuditRow[], api: PolicyReceiptApi): { status: "intact"; inspected: number } | { status: "broken"; atSeq: number; inspected: number };
  // log.ts
  export type LogField = "event" | "requestId" | "route" | "method" | "status" | "durationMs" | "code" | "deliveryId" | "attempt";
  export function log(level: "info" | "warn" | "error", fields: Partial<Record<LogField, string | number>>): void;
  ```

Chaînage : `entryHash = sha256hex(prevHash ‖ canonicalize({ seq, organization, at,
actorRef, eventType, payload }))` ; premier `prevHash` = 64 zéros ; appends sérialisés par
`pg_advisory_xact_lock(hashtext('signalement.audit:' || organization))` dans la
transaction appelante. `actorRef` = `principal_ref`, jamais un `sub` brut.

- [ ] **Test qui échoue :**
  ```ts
  test("a middle row deleted by a superuser breaks the chain at the next seq", async () => {
    await appendFive();
    await superuserTamper(`delete from signalement.audit_log where seq = 3`);   // trigger disabled for this test only
    expect(verifyAuditChain(await readAudit(ORG_A), api)).toMatchObject({ status: "broken", atSeq: 4 });
  });
  test("log drops every field outside LogField and never prints a token-shaped value", () => {
    const out = captureStdout(() => log("info", { event: "x", ...({ authorization: "secret", subject: "s" } as object) } as any));
    expect(out).not.toContain("secret"); expect(out).not.toContain('"subject"');
  });
  ```
  Plus : cinq appends → `{ status: "intact", inspected: 5 }` ; payload modifié par un
  superutilisateur → `broken` à ce `seq` ; 20 appends concurrents → chaîne linéaire
  intacte, `seq` 1..20.
- [ ] **Exécution rouge.** **Implémentation**, puis appel `appendAudit({ type:
  "signing_key.rotated", … })` dans `rotateSigningKey`. **Exécution verte.**
- [ ] **Neutralisation :** retirer `prevHash` du calcul → le test de suppression rougit ;
  passer l'objet tel quel à `log` → le test de journal rougit.
- [ ] **Fin de phase A :** `bun run check` vert ; nombre de tests et ligne `rls sweep`
  consignés dans le corps du commit.
- [ ] **Commit :** `git add apps/control-plane/src/audit/journal.ts apps/control-plane/src/audit/journal.test.ts apps/control-plane/src/log.ts apps/control-plane/src/log.test.ts apps/control-plane/src/crypto/signing-keys.ts`
  puis `git commit -s -m "feat(control-plane): hash-chained append-only audit journal and PII-free logger"`.
