# Trace pipeline v3 — 2026-09-08 checkpoint

This is the preserved pre-restoration checkpoint. See the [continuation report](CONTINUATION.md) for the completed baseline and subsequent validation.

## Status

This is a viable implementation checkpoint, not completion of the full dataset plan. The user confirmed the inference VPN is down and requested a commit and fresh-context handoff. No new baseline inference, training job, inference-host change, or push was performed. No candidate is training-ready.

## Measured evidence

| Check | Result | Evidence |
|---|---|---|
| Selected canonical reconstruction | 14 sessions reconstructed; 3 root tasks graded; 0 promoted targets | [audit summary](selected-audit-summary.json) |
| Source preservation | 28 inventoried source files unchanged; none missing | [integrity](source-integrity.json) |
| Replay recovery | Initial missing dependency and sandbox transport errors diagnosed; final selected replay had zero telemetry errors | [audit log](selected-audit.log), [summary](selected-audit-summary.json) |
| Native Phoenix | GenAI ingestion, repeat import, evaluated example linkage, and independent live/replay session records passed | [native test log](native-phoenix.log), [session records](native-phoenix.json.sessions.json) |
| Balanced task publication | 48 distinct instances, 12 families, equal repository/business domains; 144 rollouts pending | [tasks](benchmark-r2/tasks.json), [receipt](benchmark-r2/tasks-receipt.json) |
| Pinned publication retry | 48 row hashes and assignments verified; retry returned the identical receipt | [verification](benchmark-r2/publication-verification.json) |
| Reference rendering | Five cases: final answer, reasoning-bearing, tool trajectory, recovery, and long context; selected tokens decode to the exact answer | [cases](qwen-reference-cases.json), [Python checks](python-checks.log) |
| Built lifecycle | Two turns across actual persistence flush, disposal, and resume with a mock provider | [built smoke](built-smoke.log) |
| Retention | Native non-expiring policy assigned only to `gh-training-v3-replay` | [receipt](retention-receipt.json) |

The active benchmark is [gh-benchmark-v3-20260908-r2](http://127.0.0.1:6006/datasets/RGF0YXNldDo4), pinned to version `RGF0YXNldFZlcnNpb246OQ==`. Its predecessor remains intact. Dataset publication exercises Phoenix ownership; it does not mean rollout success or curated-target approval. Generic changed-export upsert, curated dataset publication, and benchmark experiment records remain unfinished.

The reference tokenizer was downloaded with `hf` from `Qwen/Qwen3.8-27B` at revision `1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0`. The isolated environment uses Transformers 5.16.1 and tokenizers 0.23.2. [Rendered evidence](qwen-reference-render.json) records file hashes, token IDs, and masks. This upstream reference is not the observed deployed NVFP4 checkpoint. `/engine/tokenize` parity, actual provider-payload fidelity, and remote Fireworks preview remain unverified. Relevant primary documentation was checked with Context7 and Tavily: [Phoenix retention](https://docs.arize.com/phoenix/settings/data-retention) and [Fireworks thinking history](https://docs.fireworks.ai/fine-tuning/thinking-history).

## Browser asset

A real browser recorded the first published benchmark dataset on the existing local Phoenix 20.8.0 server: overview, examples, filtered held-out rows, and versions. The private local GIF is `.phoenix-review.gif`, 1200×750, 8 seconds, 40 encoded frames, 369725 bytes. `.browser-verified/provenance.json` records source frames, hashes, server origin, receipt, and the uncommitted source-tree status. No model round ran. The recording is evidence of dataset review only. The GIF is ignored and available for a later PR attachment; no remote media publication occurred.

## Validation and remaining work

The focused suite passed 54 tests with three optional tests skipped; the two native Phoenix tests passed separately. [Focused tests](focused-tests.log), [typecheck](typecheck.log), [build](build.log), and [lint](lint.log) record passing checks. [Documentation checks](doc-sync.log) passed 32 gates; Markdown wrap crashed with Node 24.12.0 `ENOTDIR` while globbing `snapshots/acp/image-compaction/system-prompt.expected.md/system-prompt.expected.md`. The full documentation gate therefore did not pass. The isolated restore passed for 169 retained source roots containing 1282 files and the Phoenix dataset/version tables, recorded in [restore receipt](restore-receipt.json); private PostgreSQL/source archives remain in `.backup-final/`, with isolated extracted sources in `.restore-final/`. The backup rejects symlinks; generated profile symlinks were excluded in favor of exact configuration-file copies.

Final-answer-only SFT is explicitly a format objective, with ungraded target reasoning omitted. Approval-dependent trajectories are preserved but cannot promote. Unsupported tool graders remain unknown, preventing a correct final answer from admitting unverified delegation or workflow decisions. Tool-decision target selection remains unfinished. Historical version-1 data has not been relabelled or rewritten.

Continue from the [handoff](../../plugins/gh-genai-traces/HANDOFF.md). Finish local fidelity and task-grader work first; after VPN restoration, inspect serving provenance read-only, validate the engine renderer, execute the 144-rollout baseline, audit with pinned splits, and publish defensible curated targets and experiment results. No exact-token RL or paid training is authorized by this checkpoint.
