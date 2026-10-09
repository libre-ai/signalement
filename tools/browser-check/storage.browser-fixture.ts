import { IndexedDbStore } from "../../packages/draft-storage/indexeddb";
import { DraftVault, type Envelope, LIMITS } from "../../packages/draft-storage/vault";

interface StorageQualification {
  status: "passed";
  scope: "synthetic-page-production-storage-not-engine-quota";
  checks: string[];
}
async function fingerprint(record: Envelope | null): Promise<string> {
  if (!record) throw new Error("Missing durable encrypted draft");
  const digest = await crypto.subtle.digest("SHA-256", record.ciphertext);
  return `${record.revision}:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
async function expectRejection(action: () => Promise<void>, expected: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof Error && error.message === expected) return;
    throw new Error("Unexpected storage rejection");
  }
  throw new Error("Storage operation unexpectedly succeeded");
}
export async function qualifyStorage(): Promise<StorageQualification> {
  const checks: string[] = [];
  const name = `synthetic-storage-${crypto.randomUUID()}`;
  const store = await IndexedDbStore.open(name);
  const vault = new DraftVault(store);
  let nativeDatabase: IDBDatabase | null = null;
  try {
    await vault.unlock("synthetic qualification phrase");
    const content = new TextEncoder().encode("SYNTHETIC-PERSISTENCE-CANARY");
    await vault.save(
      { id: "synthetic", content, attachments: [], expiresAt: Date.now() + 60000 },
      null,
    );
    const record = await store.read();
    if (!record) throw new Error("Missing baseline");
    const baseline = await fingerprint(record);
    if (new TextDecoder().decode(record.ciphertext).includes("SYNTHETIC-PERSISTENCE-CANARY"))
      throw new Error("Plaintext canary in ciphertext");
    checks.push("real-webcrypto-encrypted-baseline-in-native-indexeddb");
    if (LIMITS.total !== 256 * 1024 ** 2) throw new Error("Unexpected application limit");
    // The oversized buffer never reaches IndexedDB: this tests the production guard,
    // without consuming the browser's disk quota or claiming an engine quota failure.
    await expectRejection(async () => {
      await store.compareAndSwap(record.revision, {
        ...record,
        revision: record.revision + 1,
        ciphertext: new Uint8Array(LIMITS.total + 1),
      });
    }, "Quota");
    if ((await fingerprint(await store.read())) !== baseline)
      throw new Error("Application quota changed durable data");
    checks.push("256-mib-plus-one-byte-application-refusal-preserves-ciphertext-and-revision");
    await expectRejection(async () => {
      await store.compareAndSwap(record.revision + 1, { ...record, revision: record.revision + 2 });
    }, "Conflict");
    if ((await fingerprint(await store.read())) !== baseline)
      throw new Error("CAS abort changed durable data");
    checks.push("production-cas-conflict-native-abort-preserves-ciphertext-and-revision");
    nativeDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("Native database open failed"));
    });
    const database = nativeDatabase;
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("vault", "readwrite", { durability: "strict" });
      const request = transaction
        .objectStore("vault")
        .put(
          { ...record, revision: record.revision + 1, ciphertext: new Uint8Array([1, 2, 3]) },
          "encrypted",
        );
      let putSucceeded = false;
      request.onsuccess = () => {
        putSucceeded = true;
        transaction.abort();
      };
      transaction.onabort = () =>
        putSucceeded ? resolve() : reject(new Error("Abort preceded native put"));
      transaction.oncomplete = () => reject(new Error("Aborted transaction committed"));
      transaction.onerror = () => reject(new Error("Unexpected transaction error"));
    });
    if ((await fingerprint(await store.read())) !== baseline)
      throw new Error("Native abort changed durable data");
    checks.push("native-successful-put-then-abort-preserves-ciphertext-and-revision");
    const resumed = await vault.load("synthetic");
    if (
      resumed?.revision !== 1 ||
      !resumed.content.every((byte, index) => byte === content[index]) ||
      resumed.content.length !== content.length
    )
      throw new Error("Encrypted draft resume mismatch");
    checks.push("original-draft-decrypts-after-both-refusals-and-native-abort");
    return {
      status: "passed",
      scope: "synthetic-page-production-storage-not-engine-quota",
      checks,
    };
  } finally {
    vault.lock();
    nativeDatabase?.close();
    store.close();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error("Synthetic database cleanup failed"));
      request.onblocked = () => reject(new Error("Synthetic database cleanup blocked"));
    });
  }
}
Object.assign(globalThis, { storageQualification: qualifyStorage() });
