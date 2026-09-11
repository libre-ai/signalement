# Conclude and prepare the next session

Finish the active coherent work package, then prepare a factual handoff in the repo.
Do not interpret this prompt as permission to publish, deploy, rewrite history or
merge a candidate with failing gates.

1. Reinspect git status, HEAD and diff. Identify your changes and preserve unrelated
   changes. Report commits actually made, never proposed commits as completed work.
2. Run checks appropriate to the final changes. Separate new failures from reproduced
   pre-existing blockers; retain command, result and exact tested revision. Never
   report repository-tooling tests as product acceptance evidence.
3. Review the final diff on security, quality, performance and completeness. Record
   independent review evidence when performed; do not imply review occurred otherwise.
4. Update docs/runbooks/product-session.md with the actual next starting point and
   update qualification and capability state only where supported by evidence. Keep
   pending criteria pending. Treat the handoff as a dated snapshot to reverify.
5. Give the user install/run/test commands for delivered behavior. For Chrome, Firefox
   and Safari, state separately: implemented, actually exercised, qualified or blocked.
   Never invent a command for a script or artifact that does not exist.
6. Record residual findings and exact external dependencies with the acceptance
   criterion they block. State the next bounded product work package and provide a
   self-contained restart prompt naming the relevant repository documents.

Final response in French: usable outcome; changed files and commit state; tests and
review; real limitations; next-session prompt. No generic request to continue and no
claim of completion where a required acceptance criterion is still unresolved.
