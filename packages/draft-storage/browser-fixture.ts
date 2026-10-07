import { IndexedDbStore } from "./indexeddb.ts";
import { DraftVault } from "./vault.ts";

async function run() {
  const checks: string[] = [];
  function check(value: boolean, label: string) {
    if (!value) throw new Error(label);
    checks.push(label);
  }
  const name = "synthetic-draft-storage-qualification";
  const store = await IndexedDbStore.open(name);
  const vault = new DraftVault(store);
  const phrase = "synthetic browser test passphrase";
  await vault.unlock(phrase);
  const draft = {
    id: "synthetic-id",
    content: new Uint8Array([7, 8, 9]),
    attachments: [],
    expiresAt: Date.now() + 60000,
  };
  await vault.save(draft, null);
  const envelope = await store.read();
  check(envelope !== null, "durable-envelope");
  vault.lock();
  store.close();
  const reopened = await IndexedDbStore.open(name);
  const resumed = new DraftVault(reopened);
  await resumed.unlock(phrase);
  check((await resumed.load(draft.id))?.content[1] === 8, "reopen-decrypt");
  if (!envelope) throw new Error("Missing");
  const races = await Promise.allSettled([
    reopened.compareAndSwap(envelope.revision, { ...envelope, revision: envelope.revision + 1 }),
    reopened.compareAndSwap(envelope.revision, { ...envelope, revision: envelope.revision + 1 }),
  ]);
  check(races.filter((r) => r.status === "fulfilled").length === 1, "indexeddb-atomic-cas");
  // Restore the original authenticated envelope via CAS before checking the vault.
  await reopened.compareAndSwap(envelope.revision + 1, envelope);
  await resumed.delete(draft.id, 1);
  check((await resumed.list()).length === 0, "delete-readback");
  resumed.lock();
  reopened.close();
  return checks;
}
run()
  .then((checks) =>
    fetch("/result", { method: "POST", body: JSON.stringify({ status: "passed", checks }) }),
  )
  .catch(() => fetch("/result", { method: "POST", body: JSON.stringify({ status: "failed" }) }));
