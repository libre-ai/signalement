export const LIMITS = {
  screenshot: 16 * 1024 ** 2,
  video: 64 * 1024 ** 2,
  draft: 128 * 1024 ** 2,
  total: 256 * 1024 ** 2,
  retention: 7 * 86400000,
  drafts: 128,
  attachments: 64,
  metadata: 1024 ** 2,
  content: 1024 ** 2,
} as const;
export interface Envelope {
  revision: number;
  salt: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: Uint8Array<ArrayBuffer>;
}
export interface AtomicStore {
  read(): Promise<Envelope | null>;
  compareAndSwap(expected: number | null, value: Envelope): Promise<void>;
}
export interface Attachment {
  kind: "screenshot" | "video";
  bytes: Uint8Array<ArrayBuffer>;
}
export interface Draft {
  id: string;
  content: Uint8Array<ArrayBuffer>;
  attachments: Attachment[];
  expiresAt: number;
}
export interface SavedDraft extends Draft {
  revision: number;
}
interface Metadata {
  id: string;
  expiresAt: number;
  revision: number;
  content: number;
  attachments: { kind: Attachment["kind"]; length: number }[];
}
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
function encode(drafts: SavedDraft[]): Uint8Array<ArrayBuffer> {
  if (drafts.length > LIMITS.drafts) throw new Error("Draft count");
  const metadata = drafts.map((d) => ({
    id: d.id,
    expiresAt: d.expiresAt,
    revision: d.revision,
    content: d.content.length,
    attachments: d.attachments.map((a) => ({ kind: a.kind, length: a.bytes.length })),
  }));
  const header = encoder.encode(JSON.stringify(metadata));
  if (header.length > LIMITS.metadata) throw new Error("Metadata quota");
  const size =
    4 +
    header.length +
    drafts.reduce(
      (sum, d) => sum + d.content.length + d.attachments.reduce((n, a) => n + a.bytes.length, 0),
      0,
    );
  if (size + 16 > LIMITS.total) throw new Error("Quota");
  const result = new Uint8Array(size);
  new DataView(result.buffer).setUint32(0, header.length);
  result.set(header, 4);
  let offset = 4 + header.length;
  for (const d of drafts)
    for (const bytes of [d.content, ...d.attachments.map((a) => a.bytes)]) {
      result.set(bytes, offset);
      offset += bytes.length;
    }
  return result;
}
function decode(bytes: Uint8Array<ArrayBuffer>): SavedDraft[] {
  if (bytes.length < 4) throw new Error("Corrupt");
  const length = new DataView(bytes.buffer).getUint32(0);
  if (length > LIMITS.metadata || length > bytes.length - 4) throw new Error("Corrupt");
  const metadata = JSON.parse(decoder.decode(bytes.subarray(4, 4 + length))) as Metadata[];
  if (!Array.isArray(metadata) || metadata.length > LIMITS.drafts) throw new Error("Corrupt");
  for (const item of metadata) {
    if (
      !item ||
      !Array.isArray(item.attachments) ||
      item.attachments.length > LIMITS.attachments ||
      !Number.isSafeInteger(item.content) ||
      item.content < 0 ||
      item.content > LIMITS.content
    )
      throw new Error("Corrupt");
    for (const attachment of item.attachments) {
      if (
        !attachment ||
        (attachment.kind !== "screenshot" && attachment.kind !== "video") ||
        !Number.isSafeInteger(attachment.length) ||
        attachment.length < 0 ||
        attachment.length > LIMITS[attachment.kind]
      )
        throw new Error("Corrupt");
    }
  }
  let offset = 4 + length;
  const owned: Uint8Array<ArrayBuffer>[] = [];
  function take(size: number) {
    if (!Number.isSafeInteger(size) || size < 0 || offset + size > bytes.length)
      throw new Error("Corrupt");
    const part = bytes.slice(offset, offset + size);
    owned.push(part);
    offset += size;
    return part;
  }
  try {
    const drafts = metadata.map((m) => ({
      id: m.id,
      expiresAt: m.expiresAt,
      revision: m.revision,
      content: take(m.content),
      attachments: m.attachments.map((a) => ({ kind: a.kind, bytes: take(a.length) })),
    }));
    if (offset !== bytes.length || new Set(drafts.map((d) => d.id)).size !== drafts.length)
      throw new Error("Corrupt");
    for (const d of drafts) {
      validate(d);
      if (!Number.isSafeInteger(d.revision) || d.revision < 1) throw new Error("Corrupt");
    }
    return drafts;
  } catch (error) {
    for (const buffer of owned) buffer.fill(0);
    throw error;
  }
}
function validate(draft: Draft) {
  if (
    typeof draft.id !== "string" ||
    draft.id.length === 0 ||
    draft.id.length > 256 ||
    !Number.isSafeInteger(draft.expiresAt)
  )
    throw new Error("Invalid draft");
  let size = draft.content.length;
  if (size > LIMITS.content) throw new Error("Content quota");
  if (draft.attachments.length > LIMITS.attachments) throw new Error("Attachment count");
  for (const a of draft.attachments) {
    if ((a.kind !== "screenshot" && a.kind !== "video") || a.bytes.length > LIMITS[a.kind])
      throw new Error("Attachment quota");
    size += a.bytes.length;
  }
  if (size > LIMITS.draft) throw new Error("Draft quota");
}
function aad(revision: number) {
  return encoder.encode(`signalement-internal-vault-v1:${revision}`);
}
function clearDrafts(drafts: Draft[]): void {
  for (const draft of drafts) {
    draft.content.fill(0);
    for (const attachment of draft.attachments) attachment.bytes.fill(0);
  }
}
export class DraftVault {
  #key: CryptoKey | null = null;
  #salt: Uint8Array<ArrayBuffer> | null = null;
  #epoch = 0;
  constructor(
    private readonly store: AtomicStore,
    private readonly now: () => number = Date.now,
  ) {}
  lock(): void {
    this.#key = null;
    this.#salt = null;
    this.#epoch++;
  }
  async unlock(passphrase: string): Promise<void> {
    this.lock();
    const epoch = this.#epoch;
    if (passphrase.length < 12 || passphrase.length > 1024)
      throw new Error("Passphrase must contain 12–1024 characters");
    const record = await this.store.read();
    if (record && (record.salt.length !== 16 || record.ciphertext.length > LIMITS.total))
      throw new Error("Corrupt");
    const salt = record?.salt ?? crypto.getRandomValues(new Uint8Array(16));
    const material = encoder.encode(passphrase);
    let base: CryptoKey;
    try {
      base = await crypto.subtle.importKey("raw", material, "PBKDF2", false, ["deriveKey"]);
    } finally {
      material.fill(0);
    }
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    if (record) clearDrafts(await this.decrypt(record, key, salt));
    if (epoch !== this.#epoch) throw new Error("Locked");
    this.#key = key;
    this.#salt = salt;
  }
  private async decrypt(record: Envelope, key: CryptoKey, salt: Uint8Array<ArrayBuffer>) {
    if (
      record.salt.length !== 16 ||
      record.iv.length !== 12 ||
      record.ciphertext.length > LIMITS.total ||
      !Number.isSafeInteger(record.revision) ||
      record.revision < 1 ||
      !record.salt.every((v, i) => v === salt[i])
    )
      throw new Error("Corrupt");
    let plaintext: Uint8Array<ArrayBuffer> | null = null;
    try {
      plaintext = new Uint8Array(
        await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: record.iv,
            additionalData: aad(record.revision),
            tagLength: 128,
          },
          key,
          record.ciphertext,
        ),
      );
      return decode(plaintext);
    } catch {
      throw new Error("Unable to unlock vault");
    } finally {
      plaintext?.fill(0);
    }
  }
  private async read() {
    const key = this.#key;
    const salt = this.#salt;
    const epoch = this.#epoch;
    if (!key || !salt) throw new Error("Locked");
    const envelope = await this.store.read();
    const all = envelope ? await this.decrypt(envelope, key, salt) : [];
    if (epoch !== this.#epoch) {
      clearDrafts(all);
      throw new Error("Locked");
    }
    const now = this.now();
    const drafts = all.filter((d) => d.expiresAt > now);
    clearDrafts(all.filter((d) => d.expiresAt <= now));
    return { key, salt, epoch, envelope, drafts, expired: drafts.length !== all.length };
  }
  private async write(state: Awaited<ReturnType<DraftVault["read"]>>, drafts: SavedDraft[]) {
    const revision = (state.envelope?.revision ?? 0) + 1;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = encode(drafts);
    let ciphertext: Uint8Array<ArrayBuffer>;
    try {
      ciphertext = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv, additionalData: aad(revision), tagLength: 128 },
          state.key,
          plaintext,
        ),
      );
    } finally {
      plaintext.fill(0);
    }
    if (state.epoch !== this.#epoch) throw new Error("Locked");
    await this.store.compareAndSwap(state.envelope?.revision ?? null, {
      revision,
      salt: state.salt,
      iv,
      ciphertext,
    });
    if (state.epoch !== this.#epoch) throw new Error("Locked");
  }
  async save(draft: Draft, expectedRevision: number | null): Promise<number> {
    validate(draft);
    const now = this.now();
    if (draft.expiresAt <= now || draft.expiresAt > now + LIMITS.retention)
      throw new Error("Retention");
    const copy = structuredClone(draft);
    let state: Awaited<ReturnType<DraftVault["read"]>> | null = null;
    try {
      state = await this.read();
      const existing = state.drafts.find((d) => d.id === copy.id);
      if ((existing?.revision ?? null) !== expectedRevision) throw new Error("Conflict");
      const revision = (existing?.revision ?? 0) + 1;
      await this.write(state, [
        ...state.drafts.filter((d) => d.id !== copy.id),
        { ...copy, revision },
      ]);
      return revision;
    } finally {
      clearDrafts([copy]);
      if (state) clearDrafts(state.drafts);
    }
  }
  async load(id: string): Promise<SavedDraft | null> {
    const state = await this.read();
    let result: SavedDraft | null = null;
    try {
      if (state.expired) await this.write(state, state.drafts);
      result = state.drafts.find((d) => d.id === id) ?? null;
      return result;
    } finally {
      clearDrafts(state.drafts.filter((draft) => draft !== result));
    }
  }
  async list(): Promise<{ id: string; revision: number; expiresAt: number }[]> {
    const state = await this.read();
    try {
      if (state.expired) await this.write(state, state.drafts);
      return state.drafts.map(({ id, revision, expiresAt }) => ({ id, revision, expiresAt }));
    } finally {
      clearDrafts(state.drafts);
    }
  }
  async delete(id: string, expectedRevision: number): Promise<void> {
    const state = await this.read();
    try {
      const draft = state.drafts.find((d) => d.id === id);
      if (!draft || draft.revision !== expectedRevision) throw new Error("Conflict");
      await this.write(
        state,
        state.drafts.filter((d) => d.id !== id),
      );
    } finally {
      clearDrafts(state.drafts);
    }
  }
}
