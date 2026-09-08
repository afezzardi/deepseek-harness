# Fable review dispositions — 2026-09-08

The user-relayed [Fable 5.1 review](reviews/fable-5.1-findings.md) found no blocking defects in the original continuation and requested six fixes before commit. The user authorized the checkpoint commit after a second review confirmed the six fixes and requested the remaining changes recorded below. Neither review-fix cycle performed inference, native dataset publication, paid operations, training jobs, or a push. The original baseline and its Phoenix versions remain evidence for deterministic-v4; new deterministic-v5 checks are recorded separately under `fable-r1/`.

## Requested fixes

| Finding | Resolution | Regression evidence |
|---|---|---|
| Incomplete checkpoint identity | `GRADER_VERSION` is shared by grades and cache identity. The build emits explicit hashes for every artifact source module and the audit profile, including `reward.ts`. Checkpoint identity includes consulted child digests. | `tests/audit-evidence.spec.ts` proves reuse and invalidation by child, implementation, and version, and checks actual build hashes. |
| Silent tool-selection errors | Shared selection returns considered events, targets, and per-event rejections. Checkpoints and summaries retain unexpected errors as well as ordinary admission refusals. | `tests/curation.spec.ts` checks passing selection, ungraded rejection, missing eligible root, and an injected TypeError. |
| Mutation content not independently graded | Writes must parse as the expected JSON output. Edits are unknown if more than one write/edit addresses that path, even if the final workspace passes. | `tests/grading.spec.ts` rejects the wrong write in a corrective trajectory and refuses repeated edits; correct writes and sole edits pass. |
| Competing/stale decision notes | The version-3 section of `DESIGN.md` owns tool selection, checkpoint identity, JSONB encoding, and single-writer publication. The redundant uncommitted note was removed and all links retargeted. | The existing `# Agent Note:` and `Status: implemented` format remains. Documentation validation is recorded below. |
| Untested delegation success | A two-job fixture passes actual background-ID/status text conventions; foreign IDs and unfinished jobs fail. | `tests/agent-grading.spec.ts`; the [task revision plan](TASK-REVISION.md) requires jobs tools and `backgroundMode: one-shot`. |
| Missing publication negative tests | Synthetic candidates exercise the actual publication entry point and must be rejected before native access when admission evidence is corrupted. | `test_publication.py` covers absent/mismatched fidelity, source/session/event/wire mismatches, split mismatch, approval, ineligibility, and unknown required grades. |

## Other dispositions

Shared agent evidence is appended once to the overall tool observation. Child-event diagnostics include event sequence numbers so distinct violations remain distinguishable. Experiment reporting rejects duplicate grades instead of assigning capture failure. Evaluation retries deliberately retain native upsert by run and evaluation name: this repairs a run created before its evaluations were stored. The guide states this dependency; the review independently observed four annotations per original baseline run after retries.

Provider corruption controls call the same matcher as prepared requests. A complete recording scope rejects unresolved bodies. The complete baseline again verifies 593 byte-exact requests, 144 title records, and eight disconnected records. The historical selected-source run verifies 32 requests, but its broader recording files contain 698 otherwise unresolved bodies and 409 title records. Its manifest explicitly declares `selected-sources`; it does not claim complete inventory reconciliation. Both old reports remain unchanged, and strengthened evidence has separate filenames.

`candidateGroupKeys()` now owns both partitioning and publication keys. Tool selection deliberately remains limited to the terminal completed turn, with explicit diagnostics and documentation. New trial receipts and runner identities include subprocess cwd. Historical preparation rejects missing cwd unless supplied with `--legacy-cwd` and `--legacy-cwd-evidence`; originals remain unchanged. The review re-audit binds the historical cwd to the original runner's explicit `cwd=ROOT` launch.

The original Opus review was already tracked at `588162d2e8`; it remains at `artifacts/OPUS_FINDINGS.md` as dated evidence, with its original baseline declaration and obsolete line references intact. The uncommitted Fable request moved into `reviews/`. Python cache ignores are consolidated at `artifacts/.gitignore`. The checkpoint report's extra blank line was removed. The handoff and next-session instructions now describe review dispositions instead of requesting the initial review again.

## Verification

The [final deterministic-v5 re-audit](fable-r1/re-audit-verification.json) graded all 144 roots and retained exactly the same 126 published target identities. Among graded roots it considered 295 owned tool-call assistant events, selected 69, and recorded 226 rejections: 212 ineligible root trajectories, two mixed tool/text targets, and 12 earlier lifecycle-turn targets. All 412 canonical source files remained unchanged. Overall tool evidence has no duplicated strings.

| Check | Result |
|---|---|
| [Artifact plugin suite](fable-r1-plugin-tests.log) | 66 passed, four optional checks skipped |
| [Focused review regressions](fable-r1-tests.log) | 28 passed, one manifest-dependent check skipped |
| [Complete baseline fidelity](fable-r1/fidelity-baseline.log) and [selected historical fidelity](fable-r1/fidelity-selected.log) | Two tests passed for each declared recording scope |
| [Publication controls](fable-r1-publication-tests.log) | Three tests passed, one native-endpoint test skipped; ten corrupt-admission subcases rejected before network access |
| [Experiment-report controls](fable-r1-report-tests.log) | Two tests passed, including duplicate-grade rejection |
| [Historical cwd preparation fixture](fable-r1/cwd-preparation.log) | Missing cwd rejected; explicit evidenced cwd retained; original trial unchanged. The actual re-audit manifests were derived manually as detailed below. |
| [Build](fable-r1-build.log), [typecheck](fable-r1-typecheck.log), [scoped lint](fable-r1-scoped-lint.log), [full lint](fable-r1-lint.log) | Passed |
| [Documentation](fable-r1-doc-sync.log) | 32/33 gates passed; the same Node filesystem-glob Markdown-wrap failure remains |

The [explicit code inventory](fable-r1/audit-code-identity.json) pins the re-audit implementation. The audit profile was stopped after durable output, as recorded in its [run log](fable-r1/audit-final-run.log). Python compilation checks passed for the changed runner, preparation script, and experiment reporter. Existing native publication/upsert and restoration evidence remains applicable; this review cycle performed no native publication or inference. The stored v4 baseline, native dataset/experiment receipts, renderer evidence, and source generations were not rewritten. Renderer approval and the [planned task revision](TASK-REVISION.md) remain separate acceptance work.

## Second review and final fixes

The second user-relayed Fable review independently reconciled the v5 evidence and found no blocking defect. All five remaining findings and the minor diagnostics/documentation issues are addressed in this checkpoint.

| Finding | Resolution and evidence |
|---|---|
| File gates ignored tool-decision grades | TypeScript and Python candidate readers reject missing, failed, unknown, repeated, or pre-target decisions when distinct passing decisions cannot cover the selected tool blocks. Canonical curation still checks each individual selected call. Focused candidate and publication regressions pass. |
| Candidate-less rows bypassed curated admission | Publication requires a candidate on every row when `--fidelity` or `sourceInventory.graderVersion` identifies curated input. Both entry conditions reject before native access in Python tests; generic task datasets remain supported. |
| Actual manifest derivation was unstated | The private `fable-r1/.audit-manifest.json` and `.audit-final-manifest.json` were manually derived from `baseline-r2/audit-manifest.json`, adding the repository cwd to each trial from the original runner's `subprocess.Popen(..., cwd=ROOT)`. Their `{runner, rule, sourceManifest}` evidence records that derivation. They were not emitted by `prepare-audit.py`; the preparation fixture separately tests the shipped `{cwd, evidence}` output. |
| Verification JSON had no tracked generator | `experiments/verify_reaudit.py` reproduces every field from the retained audit, pinned publication receipt, and canonical source hashes. The command below produced [identical verification evidence](fable-r2-verification.json). Raw candidate/checkpoint inputs remain private and ignored; a Git checkout alone does not contain those inputs. |
| Built-inventory test failed on a clean tree | The build-specific inventory assertion skips explicitly when its generated file is absent. It ran and passed after the artifact build in this checkpoint. |

Unspecified delegation/workflow counts now produce unknown unless other observed evidence establishes a failure. Non-JSON writes and forbidden output paths retain specific failure diagnostics. These grader changes use deterministic-v6. The archived v5 audit and its code inventory remain unchanged; v6 has focused regression evidence, not a new 144-trial audit. The decision note's extra blank line and obsolete implementation narration were removed.

Run from the repository root with the retained private audit and canonical source files present:

```sh
python3 artifacts/plugins/gh-genai-traces/experiments/verify_reaudit.py \
  --audit artifacts/results/trace-pipeline-v3/fable-r1/audit-final \
  --receipt artifacts/results/trace-pipeline-v3/baseline-r2/curated-receipt.json \
  --source-hashes artifacts/results/trace-pipeline-v3/baseline-r2/source-hashes-before.json \
  --output artifacts/results/trace-pipeline-v3/fable-r2-verification.json
```

Final local checks: [four focused specs](fable-r2-tests.log) passed 27 tests; [publication controls](fable-r2-python.log) passed five tests with one optional native test skipped; [build](fable-r2-build.log) and [typecheck](fable-r2-typecheck.log) passed. [Offline admission validation](fable-r2-admission.log) joined the retained source/event fidelity rows to all 126 candidates and accepted every row through the strengthened gate. The generator reproduced all v5 verification fields and rechecked 412 unchanged canonical files. Final [full lint](fable-r2-lint.log) passed. [Documentation gates](fable-r2-doc-sync.log) passed 32/33, including translation pairing; Markdown-wrap again failed in Node filesystem glob with `ENOTDIR`, matching the recorded checkpoint failure. The [scope check](fable-r2-scope.log) found only artifact changes, no likely credentials, and no raw session/checkpoint files selected for Git. Existing provider, native publication, restoration, and full-suite checkpoint evidence remains applicable. Tracked command logs have trailing whitespace and extra terminal blank lines removed for the Git whitespace gate. No training-readiness flag changed.
