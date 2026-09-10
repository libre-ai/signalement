// Construct the address so the boundary policy can scan its own source without granting
// this personal attribution a blanket exemption in blobs, paths, or messages.
export const APPROVED_PUBLIC_IDENTITIES = [
  {
    name: "Constantin Jais",
    email: ["74049135+constantin-jais", "@users.noreply.github.com"].join(""),
  },
] as const;
