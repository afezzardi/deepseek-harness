# Fable 5.1 code review

Review the uncommitted traces-to-dataset continuation in `/home/andrea/management/deepseek-harness`, branch `fork/qwen38-deployment`, based on commit `588162d2e8`.

Read `AGENTS.md`, `artifacts/AGENTS.md`, `artifacts/plugins/gh-genai-traces/HANDOFF.md`, `artifacts/results/trace-pipeline-v3/CONTINUATION.md`, the preserved `REPORT.md` beside it, and `artifacts/OPUS_FINDINGS.md`. Read `artifacts/KIMI_FINDINGS.md` if present. Use the applicable code-review skill and knowledge graph for orientation.

Inspect `git status --short`, `git diff 588162d2e8 -- artifacts/`, and untracked source/test files: ordinary git diff omits them. Review code and evidence; do not edit, commit, push, start training, invoke paid services, rerun inference, or change inference configuration. Prefer existing evidence and narrowly targeted offline checks.

Prioritize:

- `src/curation.ts`, `src/grading.ts`, and new `src/agent-grading.ts`: candidate-file validation, owned targets, independently graded tool decisions, approval/recovery exclusion, child ownership and workflow ordering, and false-positive admission risks.
- `experiments/audit-profile.ts`: canonical reconstruction, checkpoint identity, task/review provenance, selected target publication, and preservation of both exporters.
- `experiments/phoenix_dataset.py`: lossless JSONB encoding, hash/source fidelity, native overlapping-ID revisions, partial-publication reconciliation, immutable historical evidence, frozen splits, cross-campaign groups, and the documented single-writer assumption.
- New `experiments/experiment_report.py`: repeatability calculations, missing or duplicate evidence, uncertainty units, failure attribution, and native experiment retry behavior.
- `experiments/render_qwen.py` and new `tests/provider-fidelity.spec.ts`: actual installed-adapter comparison, corruption rejection, unmatched requests, teardown, tokenizer evidence, and strict separation of local masks, deployed request parity, and training-renderer approval.
- New and changed tests, the publication decision note, bilingual guide, reports, and handoff. Check whether evidence supports each claimed acceptance result.

These paths are relative to `artifacts/plugins/gh-genai-traces/`. The continuation report links checks and receipts: 61 plugin tests passed with four optional skips; separate adapter comparisons and native publication checks passed; Python/tokenizer checks, build, typecheck, lint, and isolated backup restoration passed. Doc-sync passed 32/33 gates; Markdown-wrap reproduces the checkpoint's Node filesystem-glob failure.

The baseline recorded 144 trials, 593 byte-exact settled requests, 57 passing trials with documented benchmark confounds, and 126 eligible neutral targets. Two proxy admissions lack response bodies. One fixture passed deployed request-token parity. Fireworks model eligibility was inspected read-only; paid renderer verification was not executed. No data is training-ready.

Return prioritized actionable findings with file:line references, a concrete failure scenario, and the violated requirement. Distinguish blocking defects from accepted limitations and test gaps. Do not repeat resolved historical findings without current evidence. State explicitly if no blocking findings remain. The user will provide your feedback before authorizing any commit.
