import {
  type AtomicStore,
  DraftVault,
  type Envelope,
  LIMITS,
} from "../../packages/draft-storage/vault";

class BenchStore implements AtomicStore {
  record: Envelope | null = null;
  async read(): Promise<Envelope | null> {
    return this.record ? structuredClone(this.record) : null;
  }
  async compareAndSwap(expected: number | null, value: Envelope): Promise<void> {
    if ((this.record?.revision ?? null) !== expected) throw new Error("Conflict");
    this.record = structuredClone(value);
  }
}
const store = new BenchStore();
const vault = new DraftVault(store);
const timings: Record<string, number> = {};
let start = performance.now();
await vault.unlock("synthetic benchmark passphrase only");
timings.unlock = performance.now() - start;
const bytes = new Uint8Array(LIMITS.video - 4096);
bytes[0] = 42;
bytes[bytes.length - 1] = 71;
for (const id of ["bench-a", "bench-b"]) {
  start = performance.now();
  await vault.save(
    {
      id,
      content: new Uint8Array([1]),
      expiresAt: Date.now() + 86400000,
      attachments: [
        { kind: "video", bytes },
        { kind: "video", bytes },
      ],
    },
    null,
  );
  timings[`save-${id}`] = performance.now() - start;
}
start = performance.now();
const loaded = await vault.load("bench-b");
if (
  loaded?.attachments.length !== 2 ||
  loaded.attachments.some(
    ({ bytes: value }) =>
      value.length !== bytes.length || value[0] !== 42 || value[value.length - 1] !== 71,
  )
)
  throw new Error("Roundtrip mismatch");
timings.load = performance.now() - start;
for (const attachment of loaded.attachments) attachment.bytes.fill(0);
loaded.content.fill(0);
vault.lock();
console.info(
  JSON.stringify({
    scope: "Bun WebCrypto with cloning memory store, not browser IndexedDB",
    runtime: Bun.version,
    revision: Bun.revision,
    ciphertextBytes: store.record?.ciphertext.length,
    limit: LIMITS.total,
    milliseconds: timings,
    rssAtEndBytes: process.memoryUsage().rss,
    assertions: 3,
  }),
);
bytes.fill(0);
