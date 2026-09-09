# Trace-to-dataset handoff

## Resume here

Read the [2026-09-09 report](../../results/trace-pipeline-r3-20260909/REPORT.md), [Fable dispositions](../../results/trace-pipeline-r3-20260909/FABLE-REVIEW.md), and [experiment guide](experiments/README.md). Work remains under `artifacts/` on `fork/qwen38-deployment`. Collection started from `8bc12e2e0b606a2a429e7496e428821dac0dae65` with the working-tree inputs preserved in its manifest; this checkpoint records the reviewed implementation and results. No push, paid operation, training job, or inference configuration change was performed. The user owns inference and requires notification before any change.

## Current evidence

Revision 5 pins 48 distinct instances across twelve families. Its complete 144-trial campaign has 111 passes, 30 task failures, and three timeouts. The unchanged deterministic-v6 grader reconstructs 201 sessions; all 402 source files remain unchanged. Provider replay matches 524 settled agent requests, with 144 auxiliary title requests classified separately and three proxy admissions lacking response records. The client proxy caps actual forwarded concurrency at four.

Phoenix contains the 144-run native experiment and 300 eligible targets: 111 final answers and 189 tool decisions. The task, experiment, and curated receipts are under `benchmark-r5/` and `baseline-r5/` in the report directory. Exact launch sources/configuration are retained privately in `baseline-r5/.implementation/`; the collection-time Git revision alone does not describe those executable inputs. Historical revisions and baseline-r2 remain evidence with their original meaning.

Explicit template-trim rendering passes request and full-example engine token parity for all 111 eligible baseline final answers and twelve pilot answers. Each removes only leading `\n\n`; canonical candidates retain their hashes. Default exact rendering retains its original rejections. The renderer records destination identity and transformations, rejects control-token strings and unsupported block arrangements, and verifies mask contiguity and decoded text. The objective excludes final reasoning and the terminator; no candidate has production thinking-training approval.

## Cleanup and next decisions

Cleanup removed forty disposable projects and eleven datasets, including seven orphan experiment projects. Retained historical example revisions match the pre-cleanup dump. The older canonical dataset’s deleted source spans survive only in that local dump. Keep the pre-cleanup backup as well as the final backup; local restore verification does not establish off-host durability. Raw recordings, canonical stores, executable archives, and backups remain ignored private evidence.

The report owns validation results and remaining limits. Before training, decide termination supervision and the production reasoning objective, then validate the actual trainer loss implementation. Tool-decision masks and exact-token RL remain unsupported. Fireworks remote verification remains deferred because its documented procedure includes paid operations. Do not repeat the completed campaign without a new task revision or a specific diagnostic purpose.

## Pending work

| Work | Status and next action |
|---|---|
| Benchmark repairs, collection, grading, publication | Complete for r5. Preserve all 144 outcomes, including three timeouts. Further failure diagnosis uses a separate diagnostic run. |
| Qwen final-answer serialization | Verified on 123 real rows. Keep explicit template-trim and the pinned template/tokenizer identity. |
| Training objective and trainer | Not approved. Decide final-reasoning and terminator supervision, then verify the selected trainer’s token masks and loss behavior before any training. |
| Tool-decision supervision and exact-token RL | Unsupported. Implement and validate tool masks; exact-token RL also requires sampled token IDs. |
| Fireworks remote verification | Deferred; its documented procedure includes paid operations requiring separate authorization. |
| Backup durability | Local restore verified. Select off-host storage and copy both backups before relying on survival of disk loss. |
| Documentation verification | The Node 24.12 Markdown globber fails with `ENOTDIR`; the other checks and direct changed-file paragraph check pass. Resolve in an upstream or host-maintenance task. |
| Deployment UAT | The benchmark does not replace [fresh deployment acceptance](../../UAT.md); execute unverified UAT cases separately. |
| Git checkpoint | Contains the reviewed implementation, evidence, and aligned documentation. Push remains unauthorized. |
