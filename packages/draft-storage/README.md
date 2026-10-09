# Internal encrypted draft storage

Plan (2026-10-07): test crypto and failure boundaries first; implement one encrypted
vault envelope with atomic IndexedDB compare-and-swap; exercise injected failure and
real WebCrypto; validate IndexedDB in an isolated branded browser if available.
No export schema is defined here.

PBKDF2-HMAC-SHA256 uses 600,000 iterations, checked 2026-10-07 against
https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#pbkdf2 .
AES-256-GCM uses a random 16-byte salt and a fresh random 12-byte IV on every write.
Only nonextractable CryptoKey objects are held in memory. The passphrase is never
persisted. JavaScript cannot promise zeroization of strings or garbage-collected keys.

A single encrypted binary envelope hides draft identifiers, contents, attachment kinds
and expiry. Plaintext exposes format/revision, salt, IV and ciphertext length only.
A read decrypts internally, removes expired entries before returning anything, and
atomically persists cleanup. Cleanup write failures fail closed. Closed browsers cannot
perform physical timed deletion. Whole-vault writes trade memory/CPU for atomicity and
hidden metadata; the ciphertext limit is 256 MiB. Concurrent writes fail explicitly.

## UI integration

```ts
import { DraftVault } from "./vault.ts";
import { IndexedDbStore } from "./indexeddb.ts";
const storage = await IndexedDbStore.open();
const vault = new DraftVault(storage);
await vault.unlock(passphrase); // 12–1024 characters; UI must clear its input.
const revision = await vault.save({
  id: crypto.randomUUID(),
  content: new TextEncoder().encode(JSON.stringify(internalDraft)),
  attachments: [{ kind: "screenshot", bytes: approvedOrQuarantinedBytes }],
  expiresAt: Date.now() + 24 * 60 * 60 * 1000,
}, null); // null for create, last returned revision for update.
// load(id), list(), delete(id, revision); lock() drops in-memory key references.
```

Consumers must clear decrypted state on lock and teardown. Never send the passphrase
to background messages or persist it in DOM state. Lock cannot retract plaintext
already returned to a caller or promise guaranteed memory zeroization. A write already
committing at the instant of lock may finish; its return is rejected as Locked.
No passphrase recovery or rotation is implemented. Authenticated ciphertext detects
modification, not rollback of an entire previously valid vault by a profile attacker.

## Evidence — 2026-10-07

- Initial tests failed before implementation (missing module, exit 1).
- `bun test --coverage packages/draft-storage`: exit 0, 10 tests, 27 assertions.
  Real WebCrypto; injected atomic-memory store for deterministic quota failures.
  Vault coverage: 100% lines, 97.44% functions. This is Bun's metric, not proof that
  all security branches or the IndexedDB adapter were exercised.
- Module-only strict TypeScript check passed with noUncheckedIndexedAccess and
  exactOptionalPropertyTypes. No dependencies or root configuration changed.
- `bun packages/draft-storage/run-browser-check.ts`: actual branded Google Chrome
  154.0.8037.98, fresh temporary profile, headless; exit 0. Four semantic checks:
  durable encrypted envelope, close/reopen and decrypt, two competing IndexedDB CAS
  operations with exactly one winner, and delete/readback. No user browser setting
  changed. The temporary profile and process were removed after the test.
- Initial sandboxed loopback server startup failed with EADDRINUSE for port 0.
  The approved escalated run succeeded; the failure was not treated as a browser result.
- Firefox/Safari, actual quota exhaustion, browser-process crash/restart, maximum
  256 MiB ciphertext workloads, and resource benchmarks remain unverified. The
  close/reopen test is a database connection restart, not a browser process restart.
- Only the requested module was edited. Browser tests contain synthetic data only;
  no capture bytes or identifiers from real pages enter the repository.

## Bounded metadata and owned buffers

The vault accepts at most 128 drafts, 64 attachments per draft and 1 MiB of text
per draft. Its encoded metadata header is bounded to 1 MiB before JSON parsing;
attachment metadata is checked before allocating decoded copies. The screenshot,
video, draft and whole-vault byte bounds remain separately enforced.

Saving snapshots identity and bytes before the first asynchronous read. Temporary
plaintext encryption/decryption buffers and decoded copies not returned to the
caller are cleared on success and failure. This is best-effort buffer hygiene,
not a guarantee about JavaScript strings, engine copies or physical RAM. The caller
owns a returned draft and must clear or release it when locking its editor.

## Resource benchmark — 2026-10-07

`bun tools/bench/vault.ts` exercises two near-limit drafts using real Bun WebCrypto
and a cloning memory store. At revision `57f349f6307cf89dcfb8893f003c1ef421a74589`,
268,419,403 ciphertext bytes (limit 268,435,456) roundtripped with checked edge
bytes. One observed run took 37 ms to unlock, 64/228 ms for successive writes and
127 ms to read. RSS at the end was 2,610,921,472 bytes; this includes unreclaimed
runtime allocations and is not a live-object or browser-heap measurement. The
large gap between payload and process footprint prevents treating the 256 MiB
storage cap as a browser memory guarantee. Actual maximum-load IndexedDB/browser
qualification remains open. The benchmark allocates only synthetic bytes and
writes no captured file.
