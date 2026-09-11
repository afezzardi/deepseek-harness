# NVFP4 / v2 UAT — 2026-09-05

Required headless cases **PASS** at revision `a01c0c3710e94eb77604007dc16d2507756c0b8b` with the uncommitted deployment changes recorded below. Interactive cases remain unverified. [UAT](../../UAT.md) owns the procedure.

## Selected deployment: eight concurrent children

The operator selected `maxConcurrentAgents: 8` after the nine-child capacity run. The runtime patch matches the [versioned patch](../../dsh-cordis.patch.yml) byte-for-byte; [effective configuration](config-eight.yaml) and [patch hash](eight-patch-sha256.txt) record this deployment. This leaves one admission slot below the reported engine ceiling for a single workflow; it does not reserve GPU memory or impose a global request limit.

A fresh nine-task run at limit 8 **PASS**ed: peak child overlap was 8, the ninth child started after a member settled, and all nine reads and ordered results succeeded. The parent and every child completed; process exit was 0. [Evidence](workflow-eight-evidence.json), [metrics](workflow-eight-metrics.jsonl), and [output](workflow-eight-output.txt) preserve the run. The parent session is `/home/andrea/.dsh/sessions/--home-andrea-management-deepseek-harness--/session-89baebd3-0d8a-4970-92bf-6332fefb2028/session.v2.jsonl.zstd`. Engine sampling below belongs only to the earlier limit-9 run.

## Initial deployment and capacity run: nine concurrent children

The initial runtime files matched the [input hashes](inputs-sha256.json). The [effective headless configuration](config.yaml) contains `maxConcurrentAgents: 9`. Both thinking and non-thinking display names include NVFP4; endpoint, route IDs, and context settings are unchanged. NVFP4 build identification comes from the operator-provided inference handoff; this run did not inspect or change the inference host's boot configuration.

The configured route is `local-qwen/chat-model`, reasoning `medium`. The uncredentialed endpoint probe returned HTTP 401; the subsequent authenticated model runs completed. Each headless process exited 0 within its 600-second limit.

## Acceptance

| Case | Status | Evidence |
|---|---|---|
| Configuration | PASS | Runtime equality, effective concurrency 9, input hashes |
| V2 instrument | PASS | [Regression](v2-regression.txt): timing/projection parity, embedded streams, compression, invalid-input rejection |
| E2 | PASS | [Tool records](e2-tools.json), [metrics](e2-metrics.jsonl), [output](e2-output.txt); README heading, missing-file error, denied write, correct commit |
| B1.4 | PASS | [Checker](e2-check.txt): 5/5, real `FS_SANDBOX_DENIED`, absent target, no granted approval, completed turn |
| W9 | PASS | [Member records](workflow9-events.jsonl), [child evidence](workflow9-evidence.json), [parent and child metrics](workflow9-metrics.jsonl), [output](workflow9-output.txt) |
| Web / B3.1 / B3.2 / B4.1 / Resume / Cancel | NOT RUN | Operator interaction required; no UI, approval, compaction, resume, or cancellation acceptance claimed |

E2 session: `/home/andrea/.dsh/sessions/--home-andrea-management-deepseek-harness--/session-39624d4e-64b7-4b7e-a609-abb613389a5b/session.v2.jsonl.zstd`. It decoded completely: 13 frames, no torn tail. Tool results and final answer agree; the write target remains absent.

W9 parent: `/home/andrea/.dsh/sessions/--home-andrea-management-deepseek-harness--/session-aba40898-f296-49e5-b7a7-75f5f8404217/session.v2.jsonl.zstd`. Nine distinct child sessions each made exactly one successful README read. Member peak was **9**; all nine completed before run-end. The ordered result contains numbers 1–9 and the correct heading, with no nulls or extra children. Child read paths were checked after absolute-path resolution; both relative and absolute spellings occurred.

The workflow lasted **15.349 s**; the parent session lasted **38.989 s**, including model orchestration and the final answer. Parent plus children reported **295,027 input tokens** and **2,539 output tokens**. This validates bounded read-only fan-out and collection, not arbitrary complex workflows or sustained capacity.

## Engine observations

The six [bracketing samples](engine.jsonl) selected in the [summary](engine-summary.json) span the parent run. Sampled running peak: **9**; sampled waiting peak: **0**; preemption delta: **0**. Samples are about ten seconds apart, so peaks are lower bounds. Engine counters include auxiliary or other concurrent traffic; they are not interchangeable with the parent/child usage totals. The sampler ended at its planned 240-second timeout (exit 124).

## Repository checks

- [test:docs](test-docs.txt): 13 passed, 2 failed.
- [doc-sync](doc-sync.txt): 31 passed, 2 failed.
- Both failures are outside the edited UAT: missing `artifacts/README.zh.md` pairing and Node `fs.glob` raising `ENOTDIR` on an upstream snapshot path. They also appear in the [earlier audit](../upstream-audit-20260905.md).
- [lint](lint.txt): passed after retrying with host access for tsx IPC.

All versioned changes are under `artifacts/`. The operator authorized the local Q20 reply in [MESSAGE.md](../../MESSAGE.md) and a commit of these changes. No upstream product edits, inference-host changes, push, or remote message-channel write was made.
