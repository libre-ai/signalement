import { inspectReachableHistory, renderPublicHistoryManifest } from "./public-history";
import { APPROVED_PUBLIC_IDENTITIES } from "./public-policy";

interface PublicHistoryArguments {
  readonly authorizedRefs: readonly string[] | undefined;
  readonly printManifest: boolean;
}

const USAGE = "Usage: check-public-history.ts [--ref <full-ref>]... [--print-manifest]";

export function parsePublicHistoryArguments(arguments_: readonly string[]): PublicHistoryArguments {
  const authorizedRefs: string[] = [];
  let printManifest = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--ref" && arguments_[index + 1]) {
      authorizedRefs.push(arguments_[index + 1] as string);
      index += 1;
    } else if (argument === "--print-manifest" && !printManifest) {
      printManifest = true;
    } else {
      throw new Error(USAGE);
    }
  }
  return {
    authorizedRefs: authorizedRefs.length === 0 ? undefined : authorizedRefs,
    printManifest,
  };
}

async function main(): Promise<void> {
  const arguments_ = parsePublicHistoryArguments(Bun.argv.slice(2));
  const result = await inspectReachableHistory(
    process.cwd(),
    arguments_.authorizedRefs === undefined
      ? { allowedIdentities: APPROVED_PUBLIC_IDENTITIES }
      : {
          allowedIdentities: APPROVED_PUBLIC_IDENTITIES,
          authorizedRefs: arguments_.authorizedRefs,
        },
  );
  if (result.findings.length > 0) {
    for (const finding of result.findings) {
      console.error(`${finding.path}: ${finding.code}`);
    }
    throw new Error(`Public history rejected ${result.findings.length} finding(s)`);
  }

  const verification = `Public history verified: ${result.refs.length} ref(s), ${result.commitCount} commit(s), ${result.blobCount} unique blob(s), ${result.objectCount} object(s), manifest sha256:${result.objectManifestSha256}, 0 findings`;
  if (arguments_.printManifest) {
    console.log(renderPublicHistoryManifest(result.manifest));
    console.error(verification);
  } else {
    console.log(verification);
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch {
    console.error("Public history check failed");
    process.exitCode = 1;
  }
}
