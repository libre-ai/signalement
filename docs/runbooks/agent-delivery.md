# Agent delivery runbook

## Current entry point: product delivery

The owner selected addon-first delivery with focused qualification inside the first
lot. Start with [the product handoff](product-session.md) and
[its launch prompt](product-session.prompt.md). The standalone qualification flow below
remains available for a new material design inquiry; it does not block this approved
product session. Close each delivery with [the conclusion prompt](session-conclusion.prompt.md).

This runbook separates deep qualification from autonomous delivery. Codex is a
development tool in this workflow; Signalement does not depend on Codex or any AI
provider at runtime.

The commands use `workspace-write` and `on-request` approval. Do not replace them with
`danger-full-access`, `dangerously-bypass-approvals-and-sandbox`, or the deprecated
`--full-auto` compatibility flag. External publication, secrets, real provider writes,
payments, deletion, and production execution remain explicit approval boundaries.

References:

- [Codex non-interactive mode](https://developers.openai.com/codex/non-interactive-mode)
- [OpenAI model and autonomy guidance](https://developers.openai.com/api/docs/guides/latest-model)

## 1. Qualification session

Start from a clean Signalement checkout:

```sh
codex --search \
  --ask-for-approval on-request \
  --sandbox workspace-write \
  --cd . \
  exec --json --model gpt-6-astra - \
  < docs/runbooks/qualification.prompt.md
```

The first JSONL event is `thread.started`; copy its `thread_id` into a task-specific
shell variable for every later command in this delivery chain:

```sh
export SIGNALEMENT_CODEX_THREAD_ID="<thread.started.thread_id>"
```

Keep the event stream and identifier local and uncommitted. Do not substitute `--last`:
another Codex run or review in the same checkout can become the most recent session.

This phase may edit qualification documents, ADRs, and plans, but it must not implement
runtime behavior. It ends only when it has either closed the material product decisions
or returned a bounded decision packet containing the evidence needed for the owner to
choose.

Answer a material decision and resume the same session so that evidence and rejected
alternatives stay in context:

```sh
codex --search \
  --ask-for-approval on-request \
  --sandbox workspace-write \
  --cd . \
  exec resume "$SIGNALEMENT_CODEX_THREAD_ID" \
  "Decision: <chosen option and rationale>. Continue qualification."
```

Repeat only for security, architecture, dependency, scope, or irreversible decisions.
Routine reversible details belong to the agent.

## 2. Autonomous delivery session

After the qualification diff is reviewed and committed, resume with the delivery prompt:

```sh
codex --search \
  --ask-for-approval on-request \
  --sandbox workspace-write \
  --cd . \
  exec resume "$SIGNALEMENT_CODEX_THREAD_ID" --model gpt-6-astra - \
  < docs/runbooks/autonomous-delivery.prompt.md
```

If the process is interrupted by context or infrastructure rather than a decision, use:

```sh
codex --search \
  --ask-for-approval on-request \
  --sandbox workspace-write \
  --cd . \
  exec resume "$SIGNALEMENT_CODEX_THREAD_ID" \
  "Re-read current Git state and continue to the declared completion criteria."
```

## 3. Required owner checkpoints

The agent prepares the complete reviewable state before requesting these actions:

1. approve a decision that materially changes security, architecture, dependency
   authority, scope, or an irreversible downstream contract;
2. provide access to a pinned real browser, provider instance, test account, or private
   execution point without placing credentials in Git or chat;
3. authorize a real external side effect such as publishing a repository, sending a
   ticket, changing visibility, merging, deploying, paying, deleting, or touching
   production;
4. sign the governance and release attestations that cannot be delegated to an agent.

Everything else proceeds without a progress-confirmation loop.

## 4. Evidence contract

Each completed slice leaves:

- a work package binding allowed paths, risks, acceptance identifiers, and dependencies;
- a written implementation plan for cross-module or architectural work;
- tests observed red before implementation and green after it;
- API and CLI documentation, examples, schema or ADR updates where applicable;
- a full `bun run check` result on the immutable candidate commit;
- independent security, quality, architecture, and sovereignty reviews;
- an explicit list of remaining `unresolved` capabilities without marketing overclaim.

No mock, interface, WebKit run, provider family name, or successful click sequence is
accepted as proof of an operational connector, branded browser, or corrected defect.
