import { expect, test } from "bun:test";
import { extensionManifest } from "./manifest";

test("all packages restrict authority to voluntary active-tab capture and deny remote code", () => {
  for (const target of ["chrome", "firefox", "safari"] as const) {
    const manifest = extensionManifest(target);
    expect(manifest.permissions).toEqual(["activeTab"]);
    expect(manifest).not.toHaveProperty("host_permissions");
    expect(manifest).not.toHaveProperty("content_scripts");
    expect(manifest).not.toHaveProperty("externally_connectable");
    expect(manifest.content_security_policy.extension_pages).toContain("connect-src 'none'");
    expect(manifest.content_security_policy.extension_pages).not.toContain("unsafe-eval");
  }
  expect(extensionManifest("chrome").background).toEqual({ service_worker: "background.js" });
  expect(extensionManifest("firefox").background).toEqual({ scripts: ["background.js"] });
});
