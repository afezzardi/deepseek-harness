# Trace-to-dataset evolution handoff

## Resume here

The 2026-09-08 implementation is complete for this checkpoint. Read [NEXT-SESSION](../../NEXT-SESSION.md), the [measured report](../../results/trace-curation-20260908/REPORT.md), [experiment guide](experiments/README.md), and [design](DESIGN.md). Continue improving the production agent and its validated datasets in a fresh context; do not repeat the completed campaigns by default. The [original production-agent objectives](../../Production-Ready_AI_Agents_2026.md) remain authoritative.

## Implemented and measured

- Mapping version 2 nests owned workflow children deterministically, buffers the live membership race, labels workflow/step spans as `CHAIN`, and suppresses standalone setup roots. Real W9 UAT completed nine child reads with peak overlap eight; Phoenix was inspected visually. Reimport preserved all 1,581 previously exported replay span identities.
- Capture distinguishes completion, actual redaction, truncation, omission, and serialization failure. Requested reasoning effort, request/config/tool hashes, privacy status, and missing renderer/tokenizer/checkpoint evidence are explicit. Capture completeness and task success are separate.
- Curation validates message/tool pairing and final-answer loss targets, reserves connected held-out families, and deduplicates rows. The 240-task medium campaign produced 218 unique passing SFT candidates (174 train, 23 validation, 21 test). Forty-eight frozen-request samples produced two DPO pairs and nine unique passing SFT rows; these are local candidates, not backend-approved training inputs.
- Three resettable write/read-back rollouts earned filesystem reward 1; missing/wrong-output controls earned 0. Exact-token RFT evidence is absent.
- Complex UAT covered sandbox denial, a nine-child workflow, two background subagents, and interactive Web approval allowed-once/rejected decisions across two turns. Background children completed, but their parent made two invalid job lookups; preserve that trajectory failure. An earlier nine-child run also failed strict output grading.
- The recording proxy now bounds actual provider forwarding at four and handles lowercase SSE headers. The initial buffered phase cannot support first-token claims. A fresh 100-task streaming comparison completed with 97 syntax passes, 88 semantic passes, 270 HTTP 200 responses, and first-byte p50/p95 of 0.47/1.73 seconds. See the report for canonical admission and final checks.

## Next bounded work

1. Inspect Phoenix replay session grouping: the project card reported one session for hundreds of replay traces. Determine whether the replay resource/session attribute is incorrectly scoped to the audit process; use upstream services and add a focused regression before another campaign.
2. Improve the background-subagent job-lookup trajectory and exercise cancellation/resume and compaction in bounded UAT. These cases are not established by the completed workflow/approval probes. Preserve failed outcomes rather than treating correct final text as a trajectory pass.
3. Validate an actual backend renderer, model eligibility, tokenization, and loss masks before calling any candidate training-ready. Grow diverse frozen-request preferences beyond the two observed pairs (below the documented three-example managed-DPO minimum); retain independent grading and reserved families.
4. Extend reward environments while keeping input hashes, private resets, independent outcome grading, and unsupported token-level RFT claims explicit. Combine campaigns through the partitioner before reporting aggregate unique yield.

## Evidence, launch, and ownership

All authored changes remain under `artifacts/`. The baseline was branch `fork/qwen38-deployment`, revision `ea7b6c424d9b2b61cb42700b199d3c41268fd4b7`; this checkpoint is committed separately. Use `git log -1` for the current checkpoint, not that experiment baseline. The old [discovery report](../../results/trace-discovery-20260908/REPORT.md) and its ignored evidence remain intact. New evidence lives under `artifacts/results/trace-curation-20260908/`; canonical stores, detached snapshots, credentials-bearing homes, and payload recordings stay ignored. Git is not a backup of those files.

Launch only through supported `pnpm dsh --profile …` profiles. Experiment homes select medium reasoning; the user's active settings remain independently owned. Canonical reads use upstream `sessionQuery`; never decode or rewrite released generations. The experiment runner uses a deployment-specific discovery-home template and a local proxy on port 4107. Start the proxy explicitly when resuming; do not assume task-owned processes survive this checkpoint.

Phoenix uses stable `gh-training-live` and `gh-training-replay` projects; `gh-genai-traces` preserves the initial metadata-only campaign. Dataset `gh-training-20260908-canonical`, experiment `medium-canonical-v1`, contains 240 stored graded runs. The audit-only `gh-training` project is transient debug noise and is removed during checkpoint cleanup after a local export. Do not delete evaluated projects or recreate this dataset on resume. Phoenix retention is not durable evidence storage.

The inference host at `afezzardi@100.108.76.12` is independently owned. Read its current `kb-mastra-infra/HOW-TO.md` before capacity changes; do not modify or restart its services. Tavily and Context7 were both used for targeted primary-source research. Refresh research only for the next concrete implementation question.

## Verification and continuation memory

The focused plugin suite passed 43 tests with two optional tests skipped. Typechecking, root lint, scoped lint, and the deterministic proxy streaming regression passed. Documentation checks exposed the existing Node 24 `globSync`/`ENOTDIR` scanner failure; bilingual issues introduced by the experiment guide were repaired. Final `pnpm run doc-sync` passed 32/33 checks, including translation pairing; only that upstream scanner failed. The staged whitespace check passed.

The codebase graph is `home-andrea-management-deepseek-harness`; refresh it after code changes. Persistent memory entity `deepseek-harness gh-genai-traces continuation` points here. Keep memory concise and use this handoff plus the report for dated measurements. No training job, external dataset upload, inference-host change, or push was performed.
