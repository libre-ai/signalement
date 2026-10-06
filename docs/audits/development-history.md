# Development history boundary

Normal CI audits the actual immutable pull-request head or pushed commit, including
all ancestors. It packs that history into a temporary isolated bare repository and
runs the existing exhaustive object scanner there. Unrelated local branches remain
untouched and are not covered by this result. The first-publication command remains
responsible for validating an exact complete authorized-ref inventory.

Shallow history, grafts, replacement refs, unexpected revisions, malformed packs and
size/time limit violations fail closed. Ambient Git variables and global/system
configuration are excluded from audit subprocesses. Snapshot packing uses the source
object store as a temporary alternate; the alternate is removed before pack ingestion
and scanning. This is not a sandbox for executing untrusted working-tree code.

Development mode permits the exact GitHub technical committer tuple only in the
committer header. Authors and terminal DCO signers must still match the approved
public identities. The original publication gate does not enable this exception.

The manifest renderer now orders `refs` before `repository`, fixing the lexical-key
ordering defect. A separate recursive key-order oracle tests the canonical output
for the fixed manifest schema. Earlier native manifest hashes are not rewritten:
the original Governance attestation already retains separately canonicalized bytes
and describes their relationship to the original native serialization.

The Git subprocess output bound also bounds compressed snapshot packs. Oversized
repositories are rejected; increasing this bound requires a separate measured change.
Passing this audit is neither a browser qualification nor an execution verdict.
