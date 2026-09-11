# Fable 5.1 follow-up review

Review the fixes to your six pre-commit findings and accompanying hygiene notes in `/home/andrea/management/deepseek-harness`, branch `fork/qwen38-deployment`. Nothing has been committed since `588162d2e8`.

Read `artifacts/results/trace-pipeline-v3/FABLE-REVIEW.md`, its linked evidence, and the updated plugin `DESIGN.md` and `HANDOFF.md`. Inspect both tracked changes and untracked source/test files.

Focus on explicit grader/source/child checkpoint identity, per-event selection rejection accounting, wrong-write and repeated-edit admission, background-job success and failure fixtures, publication negative controls, shared group keys, duplicate-grade rejection, declared fidelity recording scope, and recorded cwd. Confirm the task-revision plan requires jobs tooling and one-shot background delegation.

The v5 re-audit preserved the same 126 published target identities, recorded 295 considered / 69 selected / 226 rejected tool events, and verified 412 unchanged canonical files. The plugin suite passed 66 tests with four optional skips; additional fidelity and publication controls passed. Doc-sync remains 32/33 with the existing Node Markdown-wrap failure. Native datasets and the v4 baseline were preserved.

Use read-only inspection and targeted offline checks. Do not commit, push, invoke inference or paid services, start training, or change configuration. Report actionable remaining defects with file:line references and concrete failure scenarios; distinguish accepted limits from new regressions. State whether the six requested fixes are satisfied.
