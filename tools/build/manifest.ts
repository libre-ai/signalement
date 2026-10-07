export type BrowserTarget = "chrome" | "firefox" | "safari";

export function extensionManifest(target: BrowserTarget) {
  return {
    manifest_version: 3,
    name: "Signalement — capture locale relue",
    version: "0.1.0",
    description:
      "Capture volontaire, brouillons chiffrés et export local approuvé. Qualification en cours.",
    permissions: ["activeTab"],
    action: { default_popup: "popup.html", default_title: "Signalement" },
    background:
      target === "chrome" ? { service_worker: "background.js" } : { scripts: ["background.js"] },
    content_security_policy: {
      extension_pages:
        "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'",
    },
    ...(target === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              id: "signalement@libre-ai.invalid",
              strict_min_version: "126.0",
              data_collection_permissions: { required: ["none"] },
            },
          },
        }
      : {}),
  };
}
