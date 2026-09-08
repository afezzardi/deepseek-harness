# Trace-to-dataset discovery — 2026-09-08

## Summary

The restored self-hosted endpoint supports real DSH tracing and canonical replay. The measured batch contains 24 trials across six synthetic tasks, plus three edge cases and three workflow children. Every conversation model call in those workloads records `medium` reasoning. The batch yields 22 final-answer SFT candidates, six RFT task seeds, and no justified DPO pairs. These are local discovery artifacts; no training job or external dataset upload was performed.

## Contents

- [Measured behavior](#measured-behavior)
- [Hierarchy finding](#hierarchy-finding)
- [Dataset findings](#dataset-findings)
- [Recommended implementation](#recommended-implementation)
- [Evidence and reproduction](#evidence-and-reproduction)
- [Limits](#limits)

## Measured behavior

The checkout is `ea7b6c424d9b2b61cb42700b199d3c41268fd4b7`. Its first-parent diff is empty; the preceding substantive fork commit, `89d1d8223a`, adds the tracing plugin. Docker inspection confirmed Phoenix 20.8.0, Collector, and healthy PostgreSQL running. The inference owner's SSH consumer guide was read without changing host configuration. The configured route is `local-qwen/chat-model` through `/engine/v1`; the alias alone does not pin the actual model checkpoint.

[Batch evidence](trials.json) and [trace counts](trace-summary.json) record 24 runs, three concurrent root processes, 86.24 seconds of batch wall time, 315 live spans, 65 conversation calls, 24 auxiliary title calls, and 41 tool calls. Provider-derived model-span totals are 897,244 input tokens and 6,514 output tokens, including title calls. These totals include repeated context and are not unique dataset tokens or measured inference costs. Root-process concurrency does not prove a maximum number of simultaneous provider requests because auxiliary calls can overlap.

| Task | Trials | Strict final-answer passes | Additional observation |
| --- | ---: | ---: | --- |
| Read a heading | 4 | 4 | Recorded read calls |
| Ticket-priority extraction | 4 | 4 | Three-class counts from synthetic JSON |
| Paid-order aggregation | 4 | 3 | One correct answer wrapped in Markdown fences |
| Missing-file recovery | 4 | 4 | Recorded `FS_NOT_FOUND`, then fallback read |
| Extraction from an untrusted document | 4 | 3 | Instruction ignored; one correct answer wrapped in fences |
| Write and read back an aggregate | 4 | 4 | All four output files contain the expected values |

The two strict failures are formatting failures, not arithmetic or extraction failures. An early write in `write-1` contains the wrong total; the agent corrects it before the final read. [Grading results](evaluations.json) distinguish final-answer, file-state, trajectory, and canonical-verification checks. This six-task sample is not a general reliability benchmark.

[Canonical comparison](canonical-audit.json) passes for all 24 sessions: assistant and tool counts, tool-call source identities and arguments, completed terminal events, recorded reasoning effort, live output content, reconstructed request content, and replay output content agree. Replay contains 291 spans, exactly 24 fewer than live capture because the auxiliary title calls are absent. The [storage check](replay-integrity.json) compares 48 source-session files, including metadata, without a hash change. The [first replay check](replay-integrity-first.json) retains the earlier result. [A second import](replay-deduplication.json) retains the same 291 span IDs without duplication.

### Reasoning effort

The initial smoke observed `xhigh`, revealing that the active settings document overrode the [attempted profile configuration](initial-smoke.patch.yml). `agent-default-model` composition accepts provider and model; its settings section owns `reasoningEffort`. Discovery uses isolated homes copied from the active configuration with that setting changed to `medium`. The real user's settings remain untouched.

All 65 batch conversation calls and all 11 edge-case conversation calls have `gen_ai.request.reasoning.level = medium`. Canonical request headers and replay preserve it. Auxiliary title calls do not supply this field at the observed harness-call layer, although their provider is configured for non-thinking operation. Treat an absent value as unspecified at capture; do not infer it from an alias or relabel it as `medium`.

### Edge cases

[Edge observations](edge-summary.json) and [canonical records](edge-canonical-audit.json) establish:

- **Large input:** a completed model call has `gh.capture.incomplete = false` while both input-message attributes are marked `truncated`. Span completion alone is insufficient for dataset admission.
- **Redaction:** the synthetic credential value is absent from Phoenix; the replacement marker is present. The original canonical data remains the source record. A successful redaction probe does not establish comprehensive PII removal.
- **Workflow:** one parent creates exactly three children, all read the fixture, all settle, and the parent returns the ordered code array. Phoenix retains all four session IDs, parent-session identifiers, and nine conversation calls. Its REST span response omits a links field, so this audit does not establish native span-link presentation. The initial probe runner compared a parsed-array expectation against a raw string and reported false; the canonical audit and exact parsed result establish success. The runner's list parsing is corrected, and the original observation is retained.

## Hierarchy finding

The [parent-ID audit](hierarchy-audit.json) confirms hierarchy within a turn: agent → step → model/tool. Every non-root span in the inspected read and workflow projects resolves to a parent in the same trace. Phoenix receives those parent IDs. Its project Spans tab initially filters to `parent_id is None`, presenting root rows as a [flat table](phoenix-workflow-list.png). Clicking the parent `invoke_agent dsh` row opens a trace drawer whose accessible tree nests steps and model/tool calls. The [UI inspection](hierarchy-ui.log) and [captured drawer](phoenix-workflow-tree.png) record the observed presentation.

The broader execution is fragmented. The simple read has 11 spans across five traces: one agent turn and four standalone setup/inbox events. The three-child workflow has 45 spans across 17 traces. Each child agent starts a separate trace with no parent span; `gh.session.parent_id` preserves the session relationship, and the mapper uses span links for workflow delegation. A span link does not create a parent/child indentation. The workflow operation and its tool call are also siblings under the step. Step and workflow spans arrive with Phoenix kind `UNKNOWN`.

A Logfire-style view of the whole owned workflow requires explicit parent-context propagation into delegated agents, with agent/step/model/tool nesting under the workflow invocation. Independently scheduled jobs can retain links. Setup events also need a deliberate presentation policy instead of each becoming its own trace. This is a mapper and delegation design change, not a dataset-export option. The current mapping's replay and cross-process behavior must remain testable before changing trace ownership.

Logfire documents context propagation as the mechanism that associates child spans with their parent. Phoenix likewise renders a trace tree from shared trace IDs and parent IDs; its sessions view groups separate turns at a higher level. [Logfire distributed tracing](https://github.com/pydantic/logfire/blob/main/docs/how-to-guides/distributed-tracing.md), [Phoenix trace and session concepts](https://arize.com/opentelemetry-otel-concepts-span-trace-session)

## Dataset findings

The [candidate generator](curate-evidence.py) produces a local ignored `sft.candidates.jsonl` with 22 rows and [source provenance](sft-provenance.json). Each row retains the final call's system instruction, messages, tool definitions, available model-emitted reasoning, and tool-call identifiers. Only the last assistant message has loss weight 1; earlier assistant messages have weight 0. This avoids training an intermediate mistake merely because the task eventually succeeded. It is a final-answer candidate export, not a validated tool-policy training dataset or an exact provider-HTTP serialization.

Fireworks supports chat-style SFT and assistant-message weights. Its renderer determines tokenization and thinking-history treatment, so importing JSON successfully is not enough: inspect rendered tokens and masks for the selected model before training. [Fireworks SFT guidance](https://docs.fireworks.ai/fine-tuning/fine-tuning-models)

[Candidate admission](curation-summary.json) excludes the two strict failures. [Negative controls](curation-negative-controls.json) reject the real long-input and redacted traces. All normal content statuses say `redacted` because the policy ran; that status does not distinguish unchanged text from text that was modified. Privacy review and transformation provenance remain required.

The two formatting negatives are useful regression examples, but their complete final-call inputs differ from every positive input. The exporter finds 24 distinct final-request hashes and creates zero preference pairs. A repeated top-level task is not necessarily the same model prompt after tools, reasoning, reminders, and contextual updates. Managed Fireworks DPO requires preferred and non-preferred responses to the same prompt and currently documents a one-turn output restriction. [Fireworks DPO guidance](https://docs.fireworks.ai/fine-tuning/dpo-fine-tuning)

The [six RFT task seeds](rft-task-seeds.jsonl) retain prompts, fixture hashes, and independently specified expected values. They require a resettable DSH environment and a rollout adapter; file-based tasks cannot run from the JSONL alone. Fireworks' agentic Training API additionally requires exact generated token IDs and aligned log probabilities, prompt/tool loss masking, and an explicit policy for non-append histories. This plugin does not capture token IDs, log probabilities, or renderer/checkpoint identity, so its traces are not token-level RL trajectories. [Fireworks agentic RL cookbook](https://docs.fireworks.ai/fine-tuning/training-api/cookbook/agentic-rl)

## Recommended implementation

Preserve the original [production-agent philosophy](../../Production-Ready_AI_Agents_2026.md): canonical reconstruction, outcome and trajectory evaluation, self-hosted observability, and separation of model, harness, and infrastructure failures. The concrete next component is a versioned dataset-curation library beside the tracing plugin, with Phoenix as the review and experiment interface and upstream session-query as the source reader.

1. **Record provenance and eligibility separately.** Carry source session/event/span IDs, capture and mapper versions, task/fixture revision, prompt/tool hashes, requested effort, and resolved provider/model/renderer information when observed. Track loss, redaction changes, truncation, and privacy review independently of task scores. Missing evidence is not reward zero.
2. **Promote reviewed targets.** Start with final-answer SFT; add selected tool decisions only after step-level review. Validate tool-call/result pairing, block support, thinking policy, renderer output, and loss masks. Keep shared parent/child sessions and repeated task variants in one dataset split to prevent leakage.
3. **Generate preference alternatives from a frozen request.** Preserve the exact same messages and tool definitions, sample alternatives, and attach calibrated preference labels. Do not pair whole traces by task name or rank identical correct answers without a stated rubric.
4. **Reuse task graders for RFT rollouts.** Allocate isolated fixtures and write targets per rollout, verify environment state and tool observations, and distinguish failed tasks from broken capture. Add token/log-probability capture at an inference-aware adapter only when selecting a trainer that requires it.

This follows the production-to-dataset workflow documented by Langfuse and Phoenix, while retaining code graders for decidable checks and human review for ambiguous labels. Phoenix supports versioned datasets, provenance, and repeated experiments; this discovery creates 24 trial examples, with repetition recorded in metadata, rather than claiming 24 independent tasks. [Langfuse agent evaluation](https://langfuse.com/resources/engineering/ai-agent-evaluation), [Phoenix datasets](https://arize.com/docs/phoenix/datasets-and-experiments/concepts-datasets)

Anthropic's evaluation guidance supports inspecting complete transcripts, separating tasks from repeated trials, and checking environment outcomes. The corrected write and strict-format failures demonstrate why these distinctions matter here. [Anthropic agent evaluation](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)

## Evidence and reproduction

The local Phoenix dataset is `gh-discovery-20260908-evaluated`, ID `RGF0YXNldDoz`, with experiment `recorded-discovery-v1`, ID `RXhwZXJpbWVudDoz`. [Publication receipts](phoenix-evaluation.json) retain 24 runs, trace annotations, and code evaluations. [Experiment readback](phoenix-readback.json) confirms 24 stored runs and no missing runs; successful run execution is distinct from the 22 passing task scores. Open the local UI at `http://127.0.0.1:6006` and select that dataset. No Fireworks service was called.

[Batch runner](run-discovery.py), [edge runner](run-edge-cases.py), [span collection](collect-spans.py), [canonical export plugin](export-sessions.mjs), [replay driver](run-replay.py), and [audit](audit-evidence.py) are dated probes. They use the supported `pnpm dsh --profile headless` launch. They are not reusable CLI products: allocate a new output directory, homes, and project namespace before another discovery run. Settings, canonical snapshots, rich spans, candidate payloads, and stderr are ignored local evidence; small manifests and grades remain reviewable. The scripts fail on reused trial homes or an existing publication receipt instead of silently replacing those records.

The [run manifest](run-manifest.json) pins source/configuration hashes and the captured plugin-test result. Executed checks include the plugin Vitest command with `GH_PHOENIX_URL=http://127.0.0.1:6006` and `GH_GENAI_OTLP_ENDPOINT=http://127.0.0.1:4318/v1/traces`: 26 passed and one benchmark skipped. Sandbox restrictions initially blocked Docker, profile preparation, loopback listeners, and inference/replay connections; the required commands were retried with host access. The product's own tool permissions were not bypassed. [Final check results](checks.json): lint and probe syntax checks pass; `test:docs` passes 14/15 checks and `doc-sync` passes 32/33. Both documentation aggregates fail only on the previously recorded Node v24.12.0 `globSync`/`ENOTDIR` error in the upstream Markdown-wrap scanner. [Quick-check output](test-docs.log), [full documentation output](doc-sync.log), and [lint output](lint.log) retain the results. Upstream scanner code is unchanged.

## Limits

This work does not establish large-scale backpressure, export durability under power loss, arbitrary multi-turn dialogue, compaction, cancellation, interruption recovery, attachments, a complete PII policy, nine-agent concurrency acceptance, UI approval behavior, or training-model compatibility. The endpoint's exact running checkpoint and tokenizer are not pinned by this evidence. There is no held-out split, calibrated LLM judge, human preference collection, or trained-model quality comparison. The candidates and task seeds are discovery outputs requiring those next validations.
