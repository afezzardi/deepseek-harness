# Trace pipeline continuation — 2026-09-08

This report preserves the original continuation measurements. Subsequent code-review fixes and deterministic-v5 checks are recorded in [Fable review dispositions](FABLE-REVIEW.md).

The restored self-hosted route completed the frozen 144-trial medium baseline. Phoenix now holds recorded experiment runs and 126 eligible neutral targets. No paid operation, training job, inference configuration change, commit, or push occurred. This report continues the preserved [checkpoint](REPORT.md) at `588162d2e8` on `fork/qwen38-deployment`.

## Baseline and task limitations

The [trial receipts](baseline-r2/trials.json) cover 48 distinct instances in 12 families, each repeated three times. Execution returned zero for 142 trials; two timed out. The [final audit](baseline-r2/audit/summary.json) reconstructed 206 sessions, graded 144 roots, and retained 211 candidates. All 412 retained source files matched their pre-audit hashes ([integrity evidence](continuation-source-integrity.json)). Earlier generations and historical datasets were preserved. The separate [telemetry audit](baseline-r2/audit-with-telemetry-summary.json) records all 206 replay results without errors; final regrading disabled replay to avoid redundant imports.

The [experiment report](baseline-r2/experiment-report.json) records 57 passing trials, per-instance pass-at-three and pass-all-three outcomes, and family Wilson 95% intervals calculated over four independent instances per family. These intervals are wide. Failure categories are 38 task-tool-policy, 23 task-output-specification, 12 delegation-protocol-unclassified, 12 model, and two execution-unclassified. These categories are heuristic triage, including the model label; they do not isolate causality.

Several prompts omit exact oracle field names, including aggregation totals, release codes, reconciliation balances, and workflow agreement. The frozen allowed-tool lists were not fully communicated to the model, although the profile exposed other tools. Delegation requested background job IDs but the configured provider returned continuable subagent IDs. These are benchmark/configuration limitations, not evidence for relabelling historical trials as successes. A controlled repair requires a new pinned task revision and separate experiment; no additional campaign was run.

## Reconstruction and provider fidelity

[Baseline fidelity](provider-fidelity-baseline.json) matches 593 settled requests byte-for-byte through the installed PiAiAdapter. Each result binds the canonical snapshot, request, selected event, prepared wire payload, and recorded payload. Corrupted recordings are rejected. The remaining 152 records are explicitly classified: 144 auxiliary session-title calls and eight client-disconnected requests without settlement. They remain retained diagnostics. The [proxy inventory](baseline-proxy-summary.json) additionally retains two admission-only request IDs without response bodies; those cannot enter payload comparison. It records a maximum of four active requests, 601 medium/thinking request bodies, and 144 non-thinking title requests. No failed assistant-attempt event occurred in this corpus; the helper supports them but this run does not establish real-attempt coverage. [Selected historical fidelity](provider-fidelity-selected.json) separately matches 32 requests from 14 selected snapshots.

The offline helper uses the installed adapter and a fetch stub that captures the prepared body and stops before dispatch. It does not invoke inference. Request equivalence is separate from task success and renderer approval. An early unindexed helper run was interrupted for excessive repeated hashing; the final indexed run and corruption controls passed. Earlier diagnostic logs are retained and are not additional passing evidence.

## Phoenix publication and reporting

The frozen task dataset is `gh-benchmark-v3-20260908-r2`, pinned by its [receipt](benchmark-r2/tasks-receipt.json). The [native experiment receipt](baseline-r2/experiment-receipt.json) identifies 144 recorded runs with answers, execution facts, deterministic grade dimensions, and exact report identity. Experiment publication itself performs no inference. Exact retries reconcile existing runs and reject differing recorded outputs.

The curated dataset `gh-curated-v3-baseline-r2` contains 126 admitted targets: 57 final answers and 69 independently graded tool decisions, split 96 train / 18 validation / 12 test. Its [current receipt](baseline-r2/curated-receipt.json) pins the authoritative version; the [initial receipt](baseline-r2/curated-receipt-initial.json) retains the earlier publication. Required unknown/failing grades, human approval events, missing source-bound fidelity, and conflicting split groups block admission. This is format/task eligibility, not training readiness. Both destination renderers still reject unsupported tool-decision loss masks.

Publication checks internal hashes and exact provider/source linkage. Hash agreement does not authenticate a reviewer. Native revisions preserve changed examples, overlapping identities, historical content, and exact retries. Cross-campaign connected groups are checked before example revisions; a rejected first publication can leave an empty dataset. The sequence assumes a single publication writer; it does not claim concurrent compare-and-swap protection across Phoenix API calls.

Canonical instruction-source scope strings contain NUL separators that PostgreSQL JSONB rejects. Affected input/output/metadata fields use the lossless `json-text-v1` envelope described in the [decision note](../../plugins/gh-genai-traces/DESIGN.md). Native consumers must decode these fields through `Phoenix.examples()` before using them. Native round-trip tests include NUL content and reserved-marker collisions. No canonical source text was stripped or replaced.

## Observed renderer and primary-source evidence

Connectivity returned HTTP 200 from inference health and local Phoenix, and SSH identified `srvhapeda`. Read-only owner documentation and container inspection are retained in [deployed inspection](deployed-inspection.log). The active checkpoint is `unsloth/Qwen3.8-27B-NVFP4@7d6f8d4d72f56b92b3cdbf22f156b90e1bab0108`; the active template comes from `Qwen/Qwen3.8-27B-FP8@017b9c7af6b5689d5dd426a76e0bc077eb5ca20a`. vLLM reports 0.27.1. The [route record](deployed-route.json), [container hashes](deployed-tokenizer-hashes.log), and [HF metadata](hf-deployed-checkpoint.json) pin the observed identities. Only tokenizer files were downloaded with `hf`; no model weights were downloaded.

[Deployed request parity](qwen-deployed-render.json) passed for one fixture: 326 full-example tokens and seven selected answer tokens. The helper serializes API tool arguments as strings and explicitly requests a token list from Transformers 5.16.1. Five additional cases—tool context, final answer, reasoning omission, recovery context, and long context—passed [local masking checks](qwen-deployed-local-cases.json). Those five were not sent to the engine. Neither the single observed request comparison nor local masks approve the deployed training renderer or supervise ungraded reasoning. Reference tokenization remains separately labelled.

`firectl version` and help established installed CLI 1.8.2 capabilities; no native preview command was exposed. An initial guessed model name returned NotFound; read-only catalog inspection located `accounts/fireworks/models/qwen3p8-27b`. Its [model response](fireworks-qwen38-model.json) reports READY, supervised-LoRA tunable, and training context length 131072. The broad catalog response remains private, with its [hash](fireworks-catalog-evidence.json) retained.

Targeted Tavily research used primary [Fireworks tunable-model documentation](https://docs.fireworks.ai/fine-tuning/fine-tuning-models) and the [official renderer-verification guide](https://github.com/fw-ai/cookbook/blob/main/skills/fireworks-training/references/renderer-verification.md). That guide includes a paid one-token inference preflight, so it was not executed. Context7 oriented the Phoenix and Fireworks APIs; installed Phoenix 20.8.0 OpenAPI and GraphQL introspection supplied version-specific mutation evidence ([API record](phoenix-api-evidence.json)). Fireworks remote preview remains unverified under the no-paid constraint. Both Qwen and Fireworks exporters remain supported; no training readiness or exact-token RL support is claimed.

## Validation and preservation

Focused source tests passed 35 cases, including candidate corruption, compaction, approval exclusion, workflow ownership/order, and early auxiliary-child presentation. Plugin typecheck and build passed. Python checks passed nine tests with one native-endpoint test skipped in the combined local run; native reconciliation was executed separately. The full artifact plugin suite passed 61 tests with four optional checks skipped. Installed-adapter comparisons ran separately and passed two tests for each corpus. Native Phoenix reconciliation and lossless encoding passed two tests; actual curated version verification and exact retry also passed. The prior checkpoint’s repository tests and commit hooks remain checkpoint evidence. The documentation workflow required a fresh lint run, which passed; no commit hooks were invoked.

| Check | Evidence |
|---|---|
| Focused source behavior: 35 passed | [Focused tests](new-focused-tests.log) |
| Artifact plugin suite: 61 passed, 4 optional skipped | [Plugin tests](new-plugin-tests.log) |
| Installed-adapter baseline and historical comparisons: 2 passed each | [Baseline](provider-fidelity-baseline-final.log), [historical](provider-fidelity-selected.log) |
| Python/tokenizer checks: 9 passed, 1 native test skipped | [Python checks](new-python-final.log) |
| Native publication: 2 tests passed; 126 rows verified in both versions | [Native tests](native-publication-reconciliation.log), [version verification](native-curated-verification.json) |
| Plugin build, typecheck, scoped lint, full lint: passed | [Build](new-build.log), [typecheck](new-typecheck.log), [scoped lint](new-scoped-lint.log), [lint](new-lint.log) |
| Documentation: 32/33 gates passed | [Doc-sync](new-doc-sync.log) |
| PostgreSQL/source restore: passed | [Backup](continuation-backup.log), [restore](continuation-restore-receipt.json) |

Documentation retains the checkpoint’s single known failure: Node 24.12.0 filesystem glob raises `ENOTDIR` in Markdown-wrap on a snapshot path. No upstream scanner was modified and a fully passing documentation gate is not claimed. Updated bilingual pairing passed in doc-sync. Sandbox loopback/IPC denials were retried with host access; they did not justify skipping behavior checks.

The final audit wrote its complete summary and publication input before the supported profile was manually stopped; the profile stays alive after its audit plugin finishes. The recorded output is audit evidence, not a clean process-exit assertion. No source files were changed by that stop.

The private `.backup-continuation` archive contains a PostgreSQL dump and 1,332 files across three source/configuration/audit inventories. The [isolated restore receipt](continuation-restore-receipt.json) verifies all three source inventories and dataset/version/experiment table hashes. Only the temporary restore database was dropped. Earlier backups remain intact. Raw candidates, provider recordings, canonical stores, tokenizer files, and private archives remain ignored. The earlier browser GIF depicts only the first benchmark dataset version. No new product GUI was introduced, and the old recording is not evidence for the new experiment view. Local backup restoration does not establish off-host durability.

Fable 5.1 review feedback and its fixes are recorded separately; the user authorized the checkpoint commit after the second review. All checkpoint changes stay under `artifacts/`; the remaining acceptance items are renderer approval and a controlled benchmark revision, followed by any separately authorized training work.
