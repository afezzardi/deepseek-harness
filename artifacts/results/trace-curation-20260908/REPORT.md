# Trace curation and complex UAT — 2026-09-08

## Summary

This checkpoint implements and measures tracing, local dataset curation, and complex UAT. Over 400 root trials were exercised, with medium reasoning as the baseline. All authored changes stay under `artifacts/`. Existing discovery evidence and canonical generations are preserved. No training job, external dataset upload, inference-host change, commit, or push was performed.

## Contents

- [Implementation](#implementation)
- [Measured datasets](#measured-datasets)
- [Complex workloads](#complex-workloads)
- [Evidence](#evidence)
- [Remaining limits](#remaining-limits)

## Implementation

Mapping version 2 gives owned workflow children deterministic parent contexts in their parent's trace. A bounded live buffer handles child turns that precede publication of canonical workflow membership. Replay reads ancestor membership through upstream services, including child-first import. Phoenix displays workflow and step spans as `CHAIN`; standalone setup-event roots are disabled by default. Canonical workflow records lack the invoking tool-call ID, so workflows remain under their step rather than guessing tool ownership.

Content attributes distinguish unchanged completion, actual redaction, truncation, omission, and withheld serialization. Model spans independently record stream completeness, capture eligibility/rejections, requested reasoning effort, request/tool/configuration hashes, privacy disposition, and ungraded task outcome. Missing renderer, tokenizer, and checkpoint evidence stays unknown.

The maintained curation library validates supported message blocks, tool-call/result pairing, final-answer targets, loss weights, privacy admission, and connected split groups. The explicit sampling overlay constructs a fixed text policy before upstream logs requests. The reward library allocates fresh fixture directories and checks input integrity and final file state independently of assistant claims.

## Measured datasets

The normal campaign completed 240 trials across ten task families in 572.54 seconds: 232 strict-JSON passes, 219 semantic passes, 24/24 successful final write states, and no nonzero process exits. Canonical admission produced 239 candidates; one empty final assistant answer was rejected. After grading, 218 unique SFT candidates remain: 174 train, 23 validation, 21 held-out test. The `heldout-filter` and `unicode` families were reserved before the campaign.

The preference experiment sampled six problem instances eight times each at medium effort, temperature 0.9, and a 2,048-token budget. The proxy records exactly six distinct serialized provider-request hashes, each observed eight times. All 48 outputs parsed as JSON; 41 passed semantic grading. Canonical validation yielded six request groups, nine distinct passing SFT rows after deduplication, and two independently graded DPO pairs. The two pairs do not meet Fireworks managed training's three-example minimum. A subsequent two-sample configuration smoke had one strict pass and one failure; it is separate from the 48-sample experiment.

Three resettable write/read-back rollouts used identical initial fixture hashes in fresh directories. All preserved input files and produced the correct output, earning filesystem reward 1. Fresh missing-output and wrong-output controls earned 0. These are rollout/reward experiments, not exact-token RFT data.

The initial campaign overlay accidentally replaced rich capture and the project setting when adding metadata, so its live spans are metadata-only in `gh-genai-traces`. The corrected runner explicitly supplies the full config and uses `gh-training-live`. Canonical replay recovers rich records in `gh-training-replay`; the initial live capture limitation is retained rather than relabelled.

## Complex workloads

The fresh E2 denial case passed its canonical checks: recorded README heading, `FS_NOT_FOUND`, `FS_SANDBOX_DENIED`, correct Git revision, completed turn, and absent outside-workspace target. The W9 case recorded nine distinct children, peak workflow overlap eight, nine completed members, nine successful reads, and no open members at completion. The parent returned all nine ordered non-null results.

The two-background-subagent case completed both child reads and returned the expected headings, but the parent also made two invalid job lookups. It is a final-answer pass with a trajectory defect. A separate earlier nine-child stress run contained a null child result and failed strict output grading; it is preserved as a failed workload.

The real W9 live trace has nine child-agent roots directly under its workflow span. [Rendered Phoenix evidence](phoenix-nine-child-tree.png) shows the nested execution and a 29.4-second root latency. The repaired three-child comparison also completed; canonical and live parent checks are recorded with its evidence.

The interactive Web test recorded two `approval/asked` events and matching `allowed-once`/`rejected` decisions through canonical session-query reads. The allowed target contained exactly `OK`; the rejected target remained absent. [Approval UI evidence](web/reject-pending.png) shows the actual gate. The first decision waited 321 seconds while the browser reconnected, so its 336-second turn duration includes human/test-driver waiting, not just inference. The second decision took 0.52 seconds. Both turns completed.

## Capacity and streaming comparison

The initial recording phase observed 865 HTTP 200 responses with peak forwarded concurrency four, queue p95 4.28 seconds, and provider completion p95 9.52 seconds. This is a saved phase summary; two later configuration-smoke trials added four buffered requests. A discovered case-sensitive response-header lookup buffered SSE from lowercase `content-type` headers. Initial first-token and recorded-chunk timings are therefore invalid as provider latency measurements; the canonical answers and request bodies remain usable.

After fixing header handling, 100 fresh trials produced 97 strict JSON passes, 88 semantic passes, and no process failures. Canonical validation admitted 100 candidates and 88 unique SFT passes (69 train, nine validation, ten test). The proxy streamed all 270 responses, with no HTTP failures and peak forwarded concurrency four. First-byte p50/p95 was 0.47/1.73 seconds, completion p50/p95 2.12/5.86 seconds, and queue p95 1.85 seconds. A deterministic local test proves that the proxy forwards bytes before upstream finishes. These batches differ in sampling and task instances; do not infer model improvement from their score differences or sum unique yields without cross-campaign partitioning.

Read-only engine scrapes collected 240 successful samples: observed running peak four, waiting peak zero, and prefix-cache deltas of 1,756,160 hits over 2,538,931 queried tokens. Scrapes cover a partial interval and can include other consumers. Proxy counts exclude direct-route Web and audit calls.

## Evidence

Source files and commands are in the [experiment guide](../../plugins/gh-genai-traces/experiments/README.md). Ignored local evidence remains beside this report: `campaign/`, `preferences/`, `complex-uat/`, `hierarchy/`, `hierarchy-fixed/`, `reward-reset/`, and `web/` contain fresh homes, fixtures, source sessions, detached upstream reads, and per-attempt outputs. Top-level provider recordings, engine scrapes, Phoenix exports, source-integrity records, grades, and candidate JSONL preserve the measured facts. Do not rely on Phoenix retention alone.

Focused source tests, the built headless smoke, and typechecking have run. The final plugin suite reports 43 passed and two optional tests skipped. Typechecking, root lint, scoped lint, and the Python streaming regression passed. Sandbox-denied networking, browser launch, and tsx IPC attempts are retained separately from host retries. The documentation aggregates initially passed 13/15 and 31/33 checks: the known upstream Node 24 `globSync`/`ENOTDIR` Markdown scanner failure and missing bilingual experiment navigation were reported. The bilingual guide and shared anchors were corrected. Final `pnpm run doc-sync` passed 32/33 checks, including translation pairing; only the existing upstream Markdown scanner failed. `git diff --cached --check` passed. Raw historical lint output remains byte-preserved and ignored because its trailing whitespace is not source content.

Primary-source research used both Tavily and Context7: [Phoenix span kinds](https://github.com/arize-ai/phoenix/blob/main/docs/phoenix/tracing/concepts-tracing/otel-openinference/span-kinds.mdx), [Fireworks managed SFT](https://docs.fireworks.ai/fine-tuning/fine-tuning-models), and [managed DPO](https://docs.fireworks.ai/fine-tuning/dpo-fine-tuning). These informed explicit parent contexts, positive-loss target selection, and conservative DPO admission. The inference owner's current consumer guide was read over SSH, and metrics were scraped without changing the host.

The local Phoenix dataset `gh-training-20260908-canonical` and experiment `medium-canonical-v1` contain 240 graded runs with source-trace links. Repeated complex-session import preserved all 1,581 existing replay span identities. Source hashes remained unchanged for 480 campaign files, 96 preference files, 28 complex-UAT files, eight repaired-workflow files, six reward files, and four Web files. The 100-trial streaming audit also preserves its 200 source files.

Checkpoint cleanup exported then deleted only audit-placeholder project `gh-training`: 40 spans across ten traces, HTTP 204. The [cleanup receipt](debug-cleanup.json) records its backup hash. Evaluated live/replay projects, historical discovery projects, datasets, experiments, and ignored canonical evidence are preserved. The task-owned proxy and isolated Web server were stopped. Final screenshots retain the observed UI; project-grid screenshots taken before cleanup can still show the deleted debug project.

## Remaining limits

Local schema validation does not prove Fireworks renderer or model eligibility. No backend render preview, exact sampled token IDs, aligned log probabilities, or checkpoint/tokenizer parity evidence is available. Auxiliary calls are purpose-labelled and remain distinct from conversation targets. Replay model durations measure recorded chunks, not dispatch latency. The baseline campaign does not establish general agent reliability or trained-model improvement. Phoenix replay project cards reported one session despite hundreds of traces; replay session grouping needs investigation. Cancellation/resume, compaction, and full deployment UAT remain unverified here.
