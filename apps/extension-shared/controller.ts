import { type CaptureTabs, captureExplicitly } from "./capture";

export interface ExtensionApi {
  runtime: { id: string; getURL(path: string): string };
  tabs: CaptureTabs & { create(options: { url: string }): Promise<unknown> };
}
export interface MessageSender {
  id?: string;
  url?: string;
}
export type Reply = { ok: true; data?: string | null } | { ok: false; error: string };

/** Only extension-owned pages can use the one-shot, memory-only capture handoff. */
export function createController(
  api: ExtensionApi,
  now: () => number = Date.now,
  nonce: () => string = () => crypto.randomUUID(),
) {
  let pending: { nonce: string; data: string; created: number } | null = null;
  let busy = false;
  return async function handle(input: unknown, sender: MessageSender): Promise<Reply> {
    if (sender.id !== api.runtime.id) return { ok: false, error: "not-authorized" };
    if (!input || typeof input !== "object" || Array.isArray(input))
      return { ok: false, error: "invalid-message" };
    const message = input as Record<string, unknown>;
    const keys = Object.keys(message).sort().join(",");
    if (
      !(
        (keys === "kind" && (message.kind === "capture" || message.kind === "open")) ||
        (keys === "kind,nonce" && message.kind === "consume" && typeof message.nonce === "string")
      )
    )
      return { ok: false, error: "invalid-message" };
    const requiredPage = message.kind === "consume" ? "editor.html" : "popup.html";
    if (sender.url?.split(/[?#]/u)[0] !== api.runtime.getURL(requiredPage))
      return { ok: false, error: "not-authorized" };
    if (message.kind === "consume") {
      const item = pending;
      if (!item || item.nonce !== message.nonce) return { ok: false, error: "capture-expired" };
      pending = null;
      const elapsed = now() - item.created;
      if (elapsed < 0 || elapsed > 60_000) return { ok: false, error: "capture-expired" };
      return { ok: true, data: item.data };
    }
    if (busy) return { ok: false, error: "capture-busy" };
    busy = true;
    try {
      let url = api.runtime.getURL("editor.html");
      if (message.kind === "capture") {
        const data = await captureExplicitly(api.tabs);
        const token = nonce();
        pending = { nonce: token, data, created: now() };
        // A suspended worker loses this buffer: the editor reports expiry and asks for a new capture.
        setTimeout(() => {
          if (pending?.nonce === token) pending = null;
        }, 60_000);
        url += `#${token}`;
      }
      await api.tabs.create({ url });
      return { ok: true };
    } catch {
      pending = null;
      return { ok: false, error: "capture-unavailable" };
    } finally {
      busy = false;
    }
  };
}
