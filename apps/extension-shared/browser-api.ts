import type { ExtensionApi, MessageSender, Reply } from "./controller";

export interface BrowserApi extends ExtensionApi {
  runtime: ExtensionApi["runtime"] & {
    sendMessage(message: unknown): Promise<Reply>;
    onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: MessageSender,
          respond: (reply: Reply) => void,
        ) => boolean,
      ): void;
    };
  };
}
export function browserApi(): BrowserApi {
  const host = globalThis as unknown as { browser?: BrowserApi; chrome?: BrowserApi };
  const api = host.browser ?? host.chrome;
  if (!api) throw new Error("Extension context required");
  return api;
}
