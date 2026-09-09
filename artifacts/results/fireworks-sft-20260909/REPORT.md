# Fireworks dataset foundation — 2026-09-09

The deliverable is infrastructure for a later, specific workload. No near-term fine-tuning is planned. Current synthetic examples validate source integrity, admission, splits, serialization, upload, and native preview inspection; they do not demonstrate that training improves the agent. The user authorized dataset uploads. No model inference, training job, deployment, or inference-host change was performed in this work.

## Preserved sources and complete export

The source is the r5 curated Phoenix dataset `RGF0YXNldDoxOQ==`, pinned to version `RGF0YXNldFZlcnNpb246MjU=` by its [receipt](../trace-pipeline-r3-20260909/baseline-r5/curated-receipt.json). The exporter verifies that version, row hashes, candidate admission/review/fidelity, connected group assignments, and frozen split membership. All 402 canonical source-file hashes still match the [pre-audit inventory](../trace-pipeline-r3-20260909/baseline-r5/source-hashes-before.json). The 144 original trial outcomes, including three timeouts, remain unchanged.

| Split | Final answers | Tool decisions | Total | Fireworks resource |
|---|---:|---:|---:|---|
| Train | 73 | 150 | 223 | `accounts/gh01-andrea-fezzardi/datasets/gh-r5-actions-train-e0a2cb06` |
| Validation | 16 | 24 | 40 | `accounts/gh01-andrea-fezzardi/datasets/gh-r5-actions-val-5cf85866` |
| Test | 22 | 15 | 37 | Kept local |

The complete bundle excludes zero eligible targets. The uploaded `.bundle-actions/manifest.json` binds split files, each source row/event, submitted-row and derivation hashes, and the export implementation at creation time. That historical inventory predates the final exporter edits and includes built chunks no longer present in the working tree. A fresh `.bundle-reviewed/` export binds the current source files, build configuration, and built modules. The summary checks every current implementation hash and requires byte-identical train/validation/test files across the uploaded bundle, fresh bundle, and current converter. `.bundle-actions/phoenix-snapshot.json` retains the decoded pinned source. Private files are ignored and protected by private directories; raw JSONL, credentials, and native preview bodies are not part of the public evidence. The [summary](summary.json) verifies counts, canonical integrity, DPO availability, and native checks. It also reruns the current built exporter against the retained snapshot and requires identical submitted file hashes.

Newly curated tool candidates retain block-to-call grade bindings, and file validation rejects an unrelated later passing grade as a substitute. The unchanged r5 candidates predate that addition: all 189 tool targets rely on canonical curation plus pinned publication evidence for exact attribution, as recorded by `toolGradeBinding: canonical-curation-only` in the fresh bundle.

The 300 targets derive from only 48 task instances and repeated runs. Targets sharing tasks, contexts, or trajectories are correlated. This is a pipeline fixture, not 300 independent production examples.

## Reasoning and selected actions

The original format exporter omits target reasoning. Native Fireworks previews showed that these rows train an immediate `</think>`, the answer, and `<|im_end|>`. The source reasoning had not been lost; the selected objective omitted it. That behavior must not be presented as thinking-preserving SFT.

Explicit `outcome-reasoning` derives supervision over the recorded reasoning and its selected answer or independently graded tool calls. It requires a passing admitted candidate with a frozen split and one nonempty reasoning block followed by the selected action blocks. Earlier assistants retain weight zero. A selected tool-call message may end before its results, while preceding tool calls must be settled. Original v2 candidates, their `reasoning: omit` format selection, privacy reviews, and source hashes are unchanged. Derivation identity records the different destination objective. The canonical content review does not attest this derived objective; the exporter reuses the reviewed source without introducing another review workflow. Task outcomes select the demonstrations; individual reasoning statements have no independent grade.

The first format-only datasets (`gh-r5-sft-train-bdf33ffa`, `gh-r5-sft-val-42721666`) and reasoning-plus-final-answer datasets (`gh-r5-think-train-ac0ecf7d`, `gh-r5-think-val-68489623`) remain diagnostic evidence in the same account. Empty CLI create-output files reflect quiet-mode output and are not validation receipts; native GET responses, previews, and downloaded hashes supply the evidence. Their private exports are under `.bundle/` and `.bundle-thinking/`; the complete foundation export is `.bundle-actions/`. The HF reference comparison and current-method research are in [METHODS.md](METHODS.md). No reference examples were mixed into the DSH corpus.

## Fireworks upload and preview

Both complete split uploads are native `READY` / `CHAT` datasets with the expected counts. A subsequent [account inventory](dataset-inventory.json) lists all six foundation datasets as READY and no foundation test-named resource; it checks names and states, not arbitrary dataset contents. Downloads match the original JSONL SHA-256 hashes byte-for-byte. The [remote dataset receipt](remote-datasets.json) records this round trip. Calling `:validateUpload` after the CLI upload returns HTTP 400 with `dataset is already uploaded`; this is retained as the actual revalidation result, not a successful second validation. Native READY status, source rows returned by previews, and matching downloads are the upload evidence.

Fireworks documentation separates dataset operations from training. Its [pricing page](https://fireworks.ai/pricing) lists no dataset upload or preview tariff. This work used dataset creation/upload/download/get, attempted revalidation, and the pre-training `:renderPreview` endpoint. It did not exercise billable inference or training; no invoice audit was performed. The earlier handoff's blanket deferral of remote Fireworks checks was too broad.

The installed firectl protobuf descriptors identify `POST /v1/{name=accounts/*/datasets/*}:renderPreview` and request fields `baseModel`, `pageSize`, `pageToken`, and `contextLength`. The captured requests use `accounts/fireworks/models/qwen3p8-27b` and context length 131072. The live response advertises Preserved and Interleaved thinking history, defaulting to Preserved. Interleaved advertises `unrollsMultiTurn: true`, but every accepted rendering has exactly one datum with only the selected assistant under loss. This is consistent with history weights of zero suppressing additional targets; it does not establish how a future training job unrolls a different multi-turn workload. This matches the role of the [documented pre-training preview](https://docs.fireworks.ai/fine-tuning/thinking-history), which is separate from job Render Samples.

| Native check | Rows | Mode renderings | Matching text and selected loss | Remote errors |
|---|---:|---:|---:|---:|
| [Train, ten rows per page](actions-train-preview-check.json) | 223 | 446 | 446 | 0 |
| [Validation, ten rows per page](actions-validation-preview-check.json) | 40 | 80 | 71 | 9 preview-size errors |
| [Validation, one row per page](actions-validation-single-check.json) | 40 | 80 | 80 | 0 |

The single-row diagnostic resolves the nine response-size errors without changing examples or reducing context length. The original failures remain evidence. Across the accepted train and validation captures, all 263 uploaded source rows match their submitted JSON, and all 526 mode renderings match the explicit destination presentation and selected continuation loss. Termination receives positive loss. Test rows were not uploaded or remotely rendered.

## Explicit compatibility limits

The observed Fireworks presentation differs from the pinned inference rendering in three respects: ASCII escaping inside JSON produced by template filters, separate user wrappers for consecutive tool results, and default `xhigh` reasoning instructions. Collection used medium effort, no extra xhigh instruction, grouped consecutive tool results, and interleaved history. Native Preserved is also a different history policy from collection.

The verifier's default exact comparison preserves mismatches. Explicit `--json-serialization ascii --tool-responses separate` checks the observed destination presentation using the retained template. It requires the retained template hash for these adaptations, tests the tokenizer’s ASCII JSON filter behavior, derives the effort label from the template default, and names unsupported empty-reasoning or termination layouts. It records library versions, template/derived-template hashes, transformations, native text/loss hashes, source-line identity, advertised unrolling, and observed datum counts. The [default comparison](format-train-preview-check.json) and [partial ASCII diagnostic](thinking-train-ascii-check.json) retain the mismatches that motivated these explicit options. This does not modify canonical candidates, uploaded rows, the pinned tokenizer, or inference configuration.

All accepted comparisons still report `matchesCollectionTemplateSettings: false`. Preview acceptance proves that the selected destination renderer and segment weights are understood. It does not prove token-ID parity with a future training job, native Fireworks inference, or the current collection route. Future workload setup must deliberately align effort, history, and tool serialization with the intended serving path. Every bundle and preview report retains `trainingReady: false`.

## Reproduction

Run from the repository root with the artifact plugin built and local Phoenix available. These commands prepare and inspect data; they create no training job.

```sh
python3 artifacts/plugins/gh-genai-traces/experiments/fireworks_bundle.py artifacts/results/trace-pipeline-r3-20260909/baseline-r5/curated-receipt.json --objective outcome-reasoning --output <fresh-private-directory>
python3 artifacts/plugins/gh-genai-traces/experiments/fireworks_preview.py accounts/gh01-andrea-fezzardi/datasets/gh-r5-actions-val-5cf85866 --model accounts/fireworks/models/qwen3p8-27b --context-length 131072 --page-size 1 --output <fresh-preview-directory>
python3 artifacts/plugins/gh-genai-traces/experiments/verify_fireworks_preview.py --bundle artifacts/results/fireworks-sft-20260909/.bundle-actions --split validation --preview artifacts/results/fireworks-sft-20260909/.remote/actions-validation-single-preview --tokenizer artifacts/results/trace-pipeline-r3-20260909/.tokenizer-active --json-serialization ascii --tool-responses separate --output <comparison-report>
python3 artifacts/results/fireworks-sft-20260909/summarize.py
```

The preview comparator requires Transformers and Jinja2; the temporary validation environment used Transformers 5.16.1, tokenizers 0.23.2, and Jinja2 3.1.6. The HF Parquet comparison used pyarrow 25.0.1. These are isolated validation dependencies, not repository runtime dependencies. Raw evidence requires this working disk or its backup; Git alone does not contain it.

## Local verification and review

Focused TypeScript tests cover reasoning retention, unchanged original candidates, ineligible/unknown/corrupt evidence, frozen split requirements, graded tool targets, unknown tool names, and unresolved history. Python controls cover receipt/source/split corruption, private output files, no overwrite, failed conversion, source-line/page integrity, ordered loss, truncation, missing or misidentified datums, empty or duplicate modes, remote errors, pagination, and credential exclusion from receipts. Build, typecheck, tests, and documentation command outputs are retained beside this report.

| Check executed | Result |
|---|---|
| `node artifacts/plugins/gh-genai-traces/build.mjs` | Passed. |
| `pnpm exec tsc -p artifacts/plugins/gh-genai-traces/lib/tsconfig.check.json` | Passed. |
| `pnpm exec vitest run --config artifacts/plugins/gh-genai-traces/vitest.config.ts tests/curation.spec.ts` | 22 curation tests passed; the obsolete TypeScript preview module and its test were removed. |
| `python3 -m unittest discover -s artifacts/plugins/gh-genai-traces/experiments -p 'test_fireworks*.py'` | Nine tests passed, including real converter failure diagnostics and missing-credential retry behavior. |
| Retained native preview recheck with the final verifier | Train 446/446; single-row validation 80/80. The original batched validation retains nine remote errors. |
| `python3 artifacts/results/fireworks-sft-20260909/summarize.py` | All 402 canonical source files unchanged; current built exporter reproduces all three submitted split hashes. |
| `pnpm run lint` | Passed. |
| `pnpm run test:docs` | 14 gates passed; Markdown wrap failed with the existing Node 24.12 globber `ENOTDIR` on an unrelated snapshot path. |
| `pnpm run doc-sync` | 32 gates passed; the same Markdown wrap failure remains. |
| Direct repository Markdown AST paragraph check | All nine edited Markdown files pass. This scoped check does not replace the failed repository-wide glob traversal. |
| `git diff --check` | Passed. |

The tsx-based commands needed a host retry after sandbox IPC denial. No failed assertion was bypassed. Documentation and lint logs retain the actual final command output; an empty typecheck log indicates successful execution without diagnostics.

Remaining workload-dependent work is defined in the [handoff](../../plugins/gh-genai-traces/HANDOFF.md#pending-work).
