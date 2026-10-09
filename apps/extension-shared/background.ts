import { browserApi } from "./browser-api";
import { createController } from "./controller";

const api = browserApi();
const handle = createController(api);
api.runtime.onMessage.addListener((message, sender, respond) => {
  void handle(message, sender).then(respond, () =>
    respond({ ok: false, error: "capture-unavailable" }),
  );
  return true;
});
