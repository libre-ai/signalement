import { expect, spyOn, test } from "bun:test";
import { type AtomicStore, DraftVault, type Envelope } from "./vault.ts";

class MemoryStore implements AtomicStore {
  record: Envelope | null = null;
  fail = false;
  async read() {
    return this.record === null ? null : structuredClone(this.record);
  }
  async compareAndSwap(expected: number | null, value: Envelope | null) {
    if (this.fail) throw new Error("quota");
    if ((this.record?.revision ?? null) !== expected) throw new Error("conflict");
    this.record = structuredClone(value);
  }
}
const phrase = "synthetic fixture passphrase only";
const draft = () => ({
  id: "private-fixture-id",
  content: new TextEncoder().encode("private-text"),
  attachments: [],
  expiresAt: 100_000,
});
test("encrypts identifiers and content, resumes, deletes, and locks", async () => {
  const store = new MemoryStore();
  const vault = new DraftVault(store, () => 1000);
  await vault.unlock(phrase);
  expect(await vault.save(draft(), null)).toBe(1);
  expect(new TextDecoder().decode(store.record?.ciphertext)).not.toContain("private");
  vault.lock();
  await expect(vault.list()).rejects.toThrow("Locked");
  await vault.unlock(phrase);
  expect((await vault.load(draft().id))?.revision).toBe(1);
  await vault.delete(draft().id, 1);
  expect(await vault.list()).toEqual([]);
});
test("wrong phrase and tamper fail closed", async () => {
  const store = new MemoryStore();
  const vault = new DraftVault(store, () => 1000);
  await vault.unlock(phrase);
  await vault.save(draft(), null);
  vault.lock();
  await expect(vault.unlock("wrong phrase")).rejects.toThrow();
  await expect(vault.list()).rejects.toThrow("Locked");
  if (store.record) store.record.ciphertext[0] = (store.record.ciphertext[0] ?? 0) ^ 1;
  await expect(vault.unlock(phrase)).rejects.toThrow();
});
test("failed write preserves old record and stale revisions refuse", async () => {
  const store = new MemoryStore();
  const vault = new DraftVault(store, () => 1000);
  await vault.unlock(phrase);
  await vault.save(draft(), null);
  const before = structuredClone(store.record);
  store.fail = true;
  await expect(vault.save(draft(), 1)).rejects.toThrow();
  expect(store.record).toEqual(before);
  store.fail = false;
  await expect(vault.save(draft(), 0)).rejects.toThrow("Conflict");
  expect((await vault.load(draft().id))?.revision).toBe(1);
});
test("expiry removes entries before access and rejects excess retention", async () => {
  const store = new MemoryStore();
  let now = 1000;
  const vault = new DraftVault(store, () => now);
  await vault.unlock(phrase);
  await vault.save(draft(), null);
  now = 100_000;
  expect(await vault.load(draft().id)).toBeNull();
  await expect(vault.save({ ...draft(), expiresAt: now + 8 * 86400000 }, null)).rejects.toThrow();
});
test("updates use fresh IVs and concurrent writers cannot overwrite", async () => {
  const store = new MemoryStore();
  const a = new DraftVault(store, () => 1000);
  await a.unlock(phrase);
  await a.save(draft(), null);
  const oldIV = store.record?.iv;
  const b = new DraftVault(store, () => 1000);
  await b.unlock(phrase);
  const results = await Promise.allSettled([a.save(draft(), 1), b.save(draft(), 1)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(store.record?.iv).not.toEqual(oldIV);
});
test("expiry cleanup failure refuses content and preserves durable envelope", async () => {
  const store = new MemoryStore();
  let now = 1000;
  const vault = new DraftVault(store, () => now);
  await vault.unlock(phrase);
  await vault.save(draft(), null);
  const before = structuredClone(store.record);
  now = 100_000;
  store.fail = true;
  await expect(vault.list()).rejects.toThrow();
  expect(store.record).toEqual(before);
});
test("rejects oversized screenshots before persistence", async () => {
  const store = new MemoryStore();
  const vault = new DraftVault(store, () => 1000);
  await vault.unlock(phrase);
  await expect(
    vault.save(
      {
        ...draft(),
        attachments: [{ kind: "screenshot", bytes: new Uint8Array(16 * 1024 ** 2 + 1) }],
      },
      null,
    ),
  ).rejects.toThrow("Attachment quota");
  expect(store.record).toBeNull();
});
test("lock during key derivation cannot reopen vault", async () => {
  const vault = new DraftVault(new MemoryStore(), () => 1000);
  const pending = vault.unlock(phrase);
  vault.lock();
  await expect(pending).rejects.toThrow("Locked");
  await expect(vault.list()).rejects.toThrow("Locked");
});
test("binds envelope revision to authentication and roundtrips attachment bytes", async () => {
  const store = new MemoryStore();
  const vault = new DraftVault(store, () => 1000);
  await vault.unlock(phrase);
  const input = {
    ...draft(),
    attachments: [{ kind: "screenshot" as const, bytes: new Uint8Array([1, 2, 3]) }],
  };
  await vault.save(input, null);
  expect((await vault.load(input.id))?.attachments[0]?.bytes).toEqual(new Uint8Array([1, 2, 3]));
  if (store.record) store.record.revision++;
  await expect(vault.load(input.id)).rejects.toThrow("Unable to unlock");
});
test("rejects video and aggregate draft limits", async () => {
  const store = new MemoryStore();
  const vault = new DraftVault(store, () => 1000);
  await vault.unlock(phrase);
  await expect(
    vault.save(
      { ...draft(), attachments: [{ kind: "video", bytes: new Uint8Array(64 * 1024 ** 2 + 1) }] },
      null,
    ),
  ).rejects.toThrow("Attachment quota");
  const bytes = new Uint8Array(64 * 1024 ** 2);
  await expect(
    vault.save(
      {
        ...draft(),
        attachments: [
          { kind: "video", bytes },
          { kind: "video", bytes },
        ],
      },
      null,
    ),
  ).rejects.toThrow("Draft quota");
  expect(store.record).toBeNull();
});

test("save snapshots the draft identity before asynchronous storage access", async () => {
  const vault = new DraftVault(new MemoryStore(), () => 1000);
  await vault.unlock(phrase);
  await vault.save({ ...draft(), id: "draft-a" }, null);
  await vault.save({ ...draft(), id: "draft-b" }, null);
  const input = { ...draft(), id: "draft-a", content: new Uint8Array([42]) };
  const saving = vault.save(input, 1);
  input.id = "draft-b";
  input.content[0] = 99;
  expect(await saving).toBe(2);
  expect((await vault.list()).map(({ id }) => id).sort()).toEqual(["draft-a", "draft-b"]);
  expect((await vault.load("draft-a"))?.content).toEqual(new Uint8Array([42]));
  expect((await vault.load("draft-b"))?.revision).toBe(1);
});

test("clears owned decryption buffers after unlock without corrupting durable content", async () => {
  const vault = new DraftVault(new MemoryStore(), () => 1000);
  await vault.unlock(phrase);
  await vault.save(draft(), null);
  vault.lock();
  const original = crypto.subtle.decrypt.bind(crypto.subtle);
  const buffers: ArrayBuffer[] = [];
  const mock = spyOn(crypto.subtle, "decrypt").mockImplementation(async (...args) => {
    const bytes = await original(...args);
    buffers.push(bytes);
    return bytes;
  });
  try {
    await vault.unlock(phrase);
    expect(buffers.length).toBe(1);
    expect(buffers.every((bytes) => new Uint8Array(bytes).every((byte) => byte === 0))).toBe(true);
    expect((await vault.load(draft().id))?.content).toEqual(draft().content);
  } finally {
    mock.mockRestore();
  }
});

test("bounds attachment count and text size before cloning or encrypting", async () => {
  const store = new MemoryStore();
  const vault = new DraftVault(store, () => 1000);
  await vault.unlock(phrase);
  await expect(
    vault.save(
      {
        ...draft(),
        attachments: Array.from({ length: 65 }, () => ({
          kind: "screenshot" as const,
          bytes: new Uint8Array([1]),
        })),
      },
      null,
    ),
  ).rejects.toThrow("Attachment count");
  await expect(
    vault.save({ ...draft(), content: new Uint8Array(1024 ** 2 + 1) }, null),
  ).rejects.toThrow("Content quota");
  expect(store.record).toBeNull();
});

test("list clears private decoded copies while exposing metadata only", async () => {
  const vault = new DraftVault(new MemoryStore(), () => 1000);
  await vault.unlock(phrase);
  await vault.save(draft(), null);
  const original = Uint8Array.prototype.slice;
  const copies: Uint8Array[] = [];
  const mock = spyOn(Uint8Array.prototype, "slice").mockImplementation(function (
    this: Uint8Array,
    start,
    end,
  ) {
    const copy = original.call(this, start, end);
    copies.push(copy);
    return copy;
  });
  try {
    expect(await vault.list()).toEqual([{ id: draft().id, revision: 1, expiresAt: 100_000 }]);
    expect(copies.length).toBeGreaterThan(0);
    expect(copies.every((copy) => copy.every((byte) => byte === 0))).toBe(true);
  } finally {
    mock.mockRestore();
  }
});
