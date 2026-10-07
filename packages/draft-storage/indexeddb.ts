import { type AtomicStore, type Envelope, LIMITS } from "./vault.ts";

export class IndexedDbStore implements AtomicStore {
  private constructor(private readonly database: IDBDatabase) {}
  static async open(
    name = "signalement-encrypted-drafts",
    factory: IDBFactory = indexedDB,
  ): Promise<IndexedDbStore> {
    return new Promise((resolve, reject) => {
      const request = factory.open(name, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("vault");
      };
      request.onerror = () => reject(new Error("Storage unavailable"));
      request.onblocked = () => reject(new Error("Storage blocked"));
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(new IndexedDbStore(request.result));
      };
    });
  }
  close(): void {
    this.database.close();
  }
  async read(): Promise<Envelope | null> {
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction("vault", "readonly");
      const request = transaction.objectStore("vault").get("encrypted");
      let result: Envelope | null = null;
      request.onsuccess = () => {
        result = (request.result as Envelope | undefined) ?? null;
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(new Error("Storage read failed"));
      transaction.onerror = () => reject(new Error("Storage read failed"));
    });
  }
  async compareAndSwap(expected: number | null, value: Envelope): Promise<void> {
    if (value.ciphertext.length > LIMITS.total) throw new Error("Quota");
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction("vault", "readwrite", { durability: "strict" });
      const store = transaction.objectStore("vault");
      const request = store.get("encrypted");
      let conflict = false;
      request.onsuccess = () => {
        const previous = request.result as Envelope | undefined;
        if ((previous?.revision ?? null) !== expected) {
          conflict = true;
          transaction.abort();
          return;
        }
        store.put(value, "encrypted");
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(new Error(conflict ? "Conflict" : "Storage write failed"));
      transaction.onerror = () => reject(new Error("Storage write failed"));
    });
  }
}
