# Trace-to-dataset checkpoint handoff

## Resume here

The user requested this checkpoint before the full plan was complete. Keep implementation under `artifacts/`; do not start training or change the inference host. The VPN was confirmed down on 2026-09-08. No 144-rollout baseline ran. Read the [measured checkpoint](../../results/trace-pipeline-v3/REPORT.md), [experiment guide](experiments/README.md), and [Opus review](../../OPUS_FINDINGS.md). Kimi's updated review was still pending at checkpoint time; check `artifacts/KIMI_FINDINGS.md` before further implementation.

## Implemented scope

Mapping v3 namespaces project/origin/source IDs and gives owned workflow children one root presentation session. Replay and curation share upstream live/persistence reads and restore validation, preserve seeded-prefix identities, and retain interruption-repair provenance without rewriting generations. Ownership indexing is incremental and bounded. Candidate v2 preserves structured source content, explicit final-answer targets, four-state grades, review hashes, approval evidence, and requested/defaulted settings. Human-assisted trajectories and required unknown grades cannot promote.

Audits checkpoint source/task/grader/configuration identity atomically, retry operational failures, and separate grading, telemetry, and backend export. `prepare-audit.py` requires a pinned Phoenix receipt or explicit `--audit-only`. Native publication reconciles exact retries; split conflicts fail closed. The new replay project has an explicit non-expiring policy. Backup/restore commands use the existing PostgreSQL service and retained source stores.

Fireworks SFT/DPO remain supported exporters. Qwen reference rendering validates final-answer token masks; it is not observed deployed-renderer approval. The balanced runner owns an actual-request proxy capped at four and sets medium effort. Its two-turn lifecycle driver passed a built-profile test with a mock model and real flush/disposal/resume.

## Evidence and retained state

The active task dataset is `gh-benchmark-v3-20260908-r2`; its receipt is `artifacts/results/trace-pipeline-v3/benchmark-r2/tasks-receipt.json`. It contains 48 distinct instances, 12 families, and frozen family splits. The first task dataset remains intact; its browser recording demonstrates that first pinned version. Both datasets have zero baseline experiments. The 14 selected historical sessions were reimported into `gh-training-v3-replay`; three root tasks were graded and no candidate was promoted because required evidence was missing.

The real Phoenix browser GIF is the private local asset `artifacts/results/trace-pipeline-v3/.phoenix-review.gif` (8 seconds, 369725 bytes); frames and server/receipt provenance are in `.browser-verified/`. No model round ran in the recording. Binary media remains ignored, ready for a future PR attachment. It is not published or embedded as a remotely available asset.

Canonical stores, raw payloads, reference tokenizer files, private backups, and virtualenvs remain ignored. The report and receipts identify what was verified; Git alone is not a backup. Source archives and the PostgreSQL restore receipt remain under the checkpoint result directory. Preserve the existing historical projects, published datasets, source generations, and inference aliases.

Focused tests, native Phoenix tests, typecheck, build, and lint passed. Documentation passed 32 of 33 gates; Markdown wrap crashed in Node 24.12.0 filesystem glob with `ENOTDIR` on a snapshot path. See the report's check logs before claiming a fully passing documentation gate.

## Required next work

1. Finish task-specific delegation/workflow grading and explicitly selected tool-decision targets. Their current tool observations remain unknown. Add sabotage controls, compaction and approval/recovery admission fixtures, and early auxiliary-child presentation regression coverage. Final-answer correctness must not supervise every prior action.
2. Execute reconstructed-versus-recorded provider payload fidelity through the installed pi-ai adapter using existing recordings, with corruption controls and unmatched-request diagnostics. The adapter helper was not included in this checkpoint. Useful upstream functions: `toPiContext` in `llm-pi-ai/src/context.ts`, `resolveRouteModels` in `catalog.ts`, and pi-ai's `api/openai-completions` payload hook before HTTP dispatch.
3. Harden candidate-file validation and publication consumers; implement changed-export reconciliation for overlapping external IDs, curated-candidate dataset publication, native experiments, and cross-campaign group checks. Exact publication retry is tested; generic upsert is not. Keep Phoenix authoritative, with PostgreSQL/source restore evidence rather than a second local dataset database.
4. Once VPN returns, inspect the observed checkpoint/tokenizer/template read-only, run `/engine/tokenize` parity, and execute the 144-rollout medium baseline. Audit with the pinned task receipt; publish only defensible targets. Report per-instance repeatability and failure ownership. Preserve interrupted trial workspaces; the runner currently refuses incomplete prior trial directories.
5. Run actual Fireworks preview/model eligibility verification without starting a training job. Local tokenization does not approve Fireworks; schema validation does not approve either renderer. Ungraded reasoning must stay unsupervised.

## Review dispositions

Opus revision 2 identified missing split-manifest wiring, permanent caching of transient failures, approval evidence loss, missing dropped-record checks, non-atomic JSONL, lifecycle refusal, and duplicate provenance chains. Those mechanisms were addressed. Failed generic outputs do not join unrelated split groups; eligible duplicate outputs still do. Phoenix remains authoritative and Fireworks remains supported according to the user's explicit plan. Ungraded reasoning is not promoted to supervised content. Full acceptance remains unfinished and no training readiness is claimed.
