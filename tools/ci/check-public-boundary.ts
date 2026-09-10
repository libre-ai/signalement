import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { inspectPublicTree, type PublicFile } from "./public-boundary";
import { APPROVED_PUBLIC_EMAILS } from "./public-policy";

interface CommandResult {
  readonly exitCode: number;
  readonly stdout: Uint8Array;
}

async function runGit(arguments_: readonly string[], cwd: string): Promise<CommandResult> {
  const process = Bun.spawn(["git", ...arguments_], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout] = await Promise.all([
    process.exited,
    new Response(process.stdout).bytes(),
  ]);
  await new Response(process.stderr).bytes();
  return { exitCode, stdout };
}

interface IndexEntry {
  readonly mode: string;
  readonly path: string;
}

function parseIndexEntries(output: Uint8Array): readonly IndexEntry[] {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(output);
  return text
    .split("\0")
    .filter((record) => record.length > 0)
    .map((record) => {
      const tab = record.indexOf("\t");
      const metadata = tab === -1 ? "" : record.slice(0, tab);
      const path = tab === -1 ? "" : record.slice(tab + 1);
      const [mode] = metadata.split(" ");
      if (!mode || !path) {
        throw new Error("Git index returned a malformed entry");
      }
      return { mode, path };
    });
}

export async function readIndexFiles(root: string): Promise<readonly PublicFile[]> {
  const listing = await runGit(["ls-files", "--stage", "-z"], root);
  if (listing.exitCode !== 0) {
    throw new Error("Unable to enumerate the Git index");
  }

  const entries = parseIndexEntries(listing.stdout);
  if (entries.length === 0) {
    throw new Error("Git index contains no files");
  }
  const unsupported = entries.find((entry) => entry.mode !== "100644" && entry.mode !== "100755");
  if (unsupported) {
    throw new Error(`Unsupported Git index mode at ${unsupported.path}`);
  }

  const checkout = await mkdtemp(join(tmpdir(), "signalement-public-index-"));
  try {
    const materialized = await runGit(["checkout-index", "--all", `--prefix=${checkout}/`], root);
    if (materialized.exitCode !== 0) {
      throw new Error("Unable to materialize the Git index");
    }

    return await Promise.all(
      entries.map(async (entry) => ({
        path: entry.path,
        content: new Uint8Array(await readFile(join(checkout, entry.path))),
      })),
    );
  } finally {
    await rm(checkout, { recursive: true });
  }
}

export async function readCounterproofFile(path: string): Promise<PublicFile> {
  const label = basename(path);
  if (!label || label === "." || label === "..") {
    throw new Error("Counter-proof path must name one file");
  }
  return {
    path: `counterproof/${label}`,
    content: new Uint8Array(await readFile(path)),
  };
}

async function main(): Promise<void> {
  const arguments_ = Bun.argv.slice(2);
  let files: readonly PublicFile[];

  if (arguments_.length === 0) {
    files = await readIndexFiles(process.cwd());
  } else if (arguments_.length === 2 && arguments_[0] === "--path" && arguments_[1]) {
    files = [await readCounterproofFile(arguments_[1])];
  } else {
    throw new Error("Usage: check-public-boundary.ts [--path <counterproof-file>]");
  }

  const findings = inspectPublicTree(files, { allowedEmails: APPROVED_PUBLIC_EMAILS });
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`${finding.path}: ${finding.code}`);
    }
    throw new Error(`Public boundary rejected ${findings.length} finding(s)`);
  }

  console.log(`Public boundary verified: ${files.length} file(s), 0 findings`);
}

if (import.meta.main) {
  try {
    await main();
  } catch {
    console.error("Public boundary check failed");
    process.exitCode = 1;
  }
}
