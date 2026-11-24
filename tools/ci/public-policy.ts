// Construct the address so the boundary policy can scan its own source without granting
// this personal attribution a blanket exemption in blobs, paths, or messages.
export const APPROVED_PUBLIC_IDENTITIES = [
  {
    name: "Constantin Jais",
    email: ["74049135+constantin-jais", "@users.noreply.github.com"].join(""),
  },
] as const;

// This tuple is authorized only as a technical committer by the development gate.
export const APPROVED_FORGE_COMMITTER_IDENTITIES = [
  { name: "GitHub", email: ["noreply", "@github.com"].join("") },
] as const;

// Observed on the GitHub merge of PR #1; the address and canonical DCO stay identical.
export const APPROVED_DEVELOPMENT_AUTHOR_ALIASES = [
  {
    canonical: APPROVED_PUBLIC_IDENTITIES[0],
    alias: { name: "Constantin", email: APPROVED_PUBLIC_IDENTITIES[0].email },
  },
] as const;

// The squash merge of pull request #39 (2026-11-24) carries its sign-off under the alias
// above instead of the canonical name; the address is the canonical one. The commit is on
// the default branch and cannot be reworded without rewriting it, so the development gate
// accepts an alias sign-off for this exact object and for no other.
export const ALIAS_SIGNED_DEVELOPMENT_COMMITS = [
  "d5d6d7ac7eb57b222fbd839ec1a984c37843d213",
] as const;
