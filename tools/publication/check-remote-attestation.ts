import { APPROVED_PUBLIC_IDENTITIES } from "../ci/public-policy";
import { verifyRemoteAttestation } from "./remote-attestation";

const USAGE =
  "Usage: check-remote-attestation.ts --expected-head <oid> --expected-manifest-sha256 <sha256> --expected-visibility <private|public>";

export interface RemoteAttestationArguments {
  readonly expectedHead: string;
  readonly expectedManifestSha256: string;
  readonly expectedVisibility: "private" | "public";
}

export function parseRemoteAttestationArguments(
  arguments_: readonly string[],
): RemoteAttestationArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const option = arguments_[index];
    const value = arguments_[index + 1];
    if (!option || !value || values.has(option)) throw new Error(USAGE);
    values.set(option, value);
  }
  const expectedHead = values.get("--expected-head");
  const expectedManifestSha256 = values.get("--expected-manifest-sha256");
  const expectedVisibility = values.get("--expected-visibility");
  if (
    values.size !== 3 ||
    !expectedHead ||
    !/^[0-9a-f]{40,64}$/.test(expectedHead) ||
    !expectedManifestSha256 ||
    !/^[0-9a-f]{64}$/.test(expectedManifestSha256) ||
    (expectedVisibility !== "private" && expectedVisibility !== "public")
  ) {
    throw new Error(USAGE);
  }
  return { expectedHead, expectedManifestSha256, expectedVisibility };
}

async function main(): Promise<void> {
  const arguments_ = parseRemoteAttestationArguments(Bun.argv.slice(2));
  const result = await verifyRemoteAttestation(
    arguments_.expectedHead,
    arguments_.expectedManifestSha256,
    arguments_.expectedVisibility,
    APPROVED_PUBLIC_IDENTITIES,
  );
  console.log(
    `Remote attestation verified: ${result.refCount} ref(s), ${result.objectCount} object(s), HEAD ${result.headObjectId}, manifest sha256:${result.manifestSha256}`,
  );
}

if (import.meta.main) {
  try {
    await main();
  } catch {
    console.error("Remote attestation check failed");
    process.exitCode = 1;
  }
}
