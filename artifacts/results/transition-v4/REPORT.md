# Session V3 transition review checkpoint

This pre-commit acceptance report records the implementation in `/tmp/dsh-v3-transition`, branch `fork/qwen38-v3-transition`, with the pending upstream merge pinned to `c291e7961a515f6d7af9304e7fd1d257929aef26`. The subsequent [review resolution](FABLE-RESOLUTION.md) owns corrections and commit readiness. Existing running services were not redeployed; fresh development projects and datasets were created in the existing Phoenix instance.

## Implementation

The plugin reads Session V3 through upstream observation and persistence services. Model spans correlate to canonical message IDs through settled attempt frames; ambiguous calls remain separately identified. Ordered capture recovers missed envelopes on late attachment and retains the telemetry content policy. Trace, span, and Phoenix session identities use mapping version 4.

Confirmed native ratings reconcile from durable Session events to Phoenix HUMAN annotations. Edits, deletion, restart recovery, unavailable destinations, replay fallback, and competing publishers have regression coverage. Notes are redacted and bounded. Ratings on inherited messages point to their original owning Session span; independent rating Sessions retain distinct annotation identifiers. Preference does not replace a task grade or grant training eligibility.

Candidate version 3 binds the selected message and completed-turn prefix. Earlier tool decisions derive their review only after verification of the reviewed root trajectory. Reconstruction metadata is outside the reviewed hash; included repair events remain covered. Original migration ancestry is not inferred from the normalized Session version. The retained unsupported pre-release V2 fixture is explicitly refused; separately constructed valid migration input tests the upstream path.

## Executed evidence

- `node artifacts/check.mjs`: tracing build/typecheck and 80 tests passed, five optional tests skipped; effort slider build/typecheck and 12 tests passed; Python discovery ran 33 tests, with 25 passing and eight optional skips.
- Native Phoenix integration: three tests passed, including HUMAN annotation update and deletion.
- Full lint and all 34 documentation checks passed before the final inherited-message refinement. Its focused feedback suite passed five tests, and final plugin build/typecheck passed. Final documentation and lint results are recorded separately in the review handoff.
- Preflight: 16 configurations passed with no inference requests.
- Fixed-build live acceptance: 16 processes completed, with 15 task grades passing and one failing. The Unicode task with reasoning off produced a tool error and failed its syntax/semantics checks; its trajectory was excluded from promotion.
- Provider fidelity: all 68 reconstructed model requests were byte-exact; 16 additional recordings were classified as auxiliary title calls.
- Publication: 41 targets, comprising 15 final answers and 26 independently graded tool decisions. Native Phoenix verification matched all 41 saved examples at the pinned version. Re-audit matched target identities, found no duplicate tool evidence, and verified all 52 canonical source files unchanged.
- One fresh final-answer candidate rendered with the retained local tokenizer: 8,293 tokens and 15 loss tokens. This is reference rendering, not current inference-engine token parity or managed-trainer verification.

The fixed-build acceptance preceded the isolated inherited-feedback refinement; that change has focused regression coverage and does not change request reconstruction or dataset grading. Full private run inputs and raw outputs remain locally under ignored `artifacts/results/transition-v4-final`; compact receipts and summaries accompany this report.

## Review and release limits

No commit, push, deployment, paid training, or inference-host reconfiguration was performed. Cloud CI has not run. Native API tests do not establish manual browser/dialog acceptance. Feedback locking requires POSIX support. The synthetic campaign validates infrastructure, not production task quality. The failing model trial remains visible and the dataset does not admit its targets.

Review the complete unstaged and untracked fork diff against the pinned upstream SHA, including the authorized `.github/workflows/fork-artifacts.yml`. Focus on canonical correlation, queue shutdown, policy-preserving recovery, inherited-message feedback ownership, exact deletion filters, and review derivation. The source remains available for Fable to request refinements before any commit.
