import { browserApi } from "./browser-api";

const api = browserApi();
for (const kind of ["capture", "open"] as const) {
  document.getElementById(kind)?.addEventListener("click", async () => {
    const status = document.getElementById("status");
    try {
      const reply = await api.runtime.sendMessage({ kind });
      if (!reply.ok) throw new Error("Unavailable");
      window.close();
    } catch {
      if (status)
        status.textContent =
          "Ouverture impossible. Vérifiez les permissions et gardez la page web active, puis réessayez.";
    }
  });
}
