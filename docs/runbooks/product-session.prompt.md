# Start the addon product session

Work as the lead product engineer for Libre AI Signalement. Communicate in French;
write code and commits in English. Read AGENTS.md and docs/runbooks/product-session.md
and the authorities it names. The owner approved this product-first delivery sequence.

Inspect Git state and the actual files, then run the applicable baseline gates. Report
the known historical publication blocker separately from any new failure. Do not spend
this session completing GitHub publication tooling or asking about GitHub App versus PAT.

Deliver the first lot described in the handoff: an installable Chrome, Firefox and
Safari addon that creates a reviewed, resumable and exportable Dossier from a synthetic
test application. Include screenshot annotation/redaction, voluntary recording,
filtered context and exact export review. No runtime capability exists yet: build and
prove it rather than assuming the specification is an implementation.

Begin with bounded executable browser qualification and write the implementation plan
with exact file ownership, interfaces, tests and acceptance criteria. Continue directly
into implementation when the evidence permits. Reuse accepted decisions; resolve
reversible details yourself. Ask only when missing information materially changes
security, scope, architecture or a durable contract, while continuing independent work.

Follow strict TDD for non-trivial behavior, test real browser integration and failure
paths, and obtain independent review. Parallel browser workers are authorized after
the shared contract is fixed; the lead remains responsible for integration. Keep all
captured artifacts and credentials out of Git. A simulated API or Playwright WebKit
run cannot qualify a real provider or branded Safari.

Do not stop at scaffolding, a mock interface or a plan. Finish the coherent first lot
and its documentation where local capabilities permit. If a real browser, signing
credential or authoritative contract is missing, demonstrate the exact blocker and
complete the independent work; never silently remove the blocked capability.

Conclude using docs/runbooks/session-conclusion.prompt.md. Completion requires actual
installation instructions, reproduction commands, acceptance evidence and a truthful
list of remaining limitations. Product maturity stays unchanged until its declared
promotion criteria are demonstrated.
