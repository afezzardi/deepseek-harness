# Fable review resolution

The transition includes upstream `c291e7961a515f6d7af9304e7fd1d257929aef26` and the fork plugin adaptation on `fork/qwen38-v3-transition`. The user authorized the commit after review corrections. Deployment and push are outside this checkpoint.

## Disposition

1. Failed ancestor reads increment `ownershipRecoveryFailures` and preserve child event mapping. A bounded per-child cache limits reads to adoption and new turn starts. The regression injects unavailable parent persistence, verifies all child events reach the mapper, and verifies no per-event reread.
2. `node artifacts/check.mjs` regenerated the plugin. A separate SHA-256 comparison verified all 18 files named by `lib/audit-code-identity.json` against current source bytes.
3. Feedback compares upstream stat revisions, skips unchanged successful sessions, and remembers acknowledged mutations. Unrelated appends do not cause duplicate writes. Failed passes retry; startup reconstructs from durable history. External Phoenix restoration requires restarting publishers. Tests observe read and HTTP counts, including recovery after failure.
4. The shutdown deadline includes capture drain and feedback shutdown. Expiration counts active and queued observations as `captureAbandoned`, drops queued work, and suppresses late capture mapping. A blocked-read regression verifies deadline rejection and no mapping after release. Filesystem reads themselves are not cancellable.
5. Plugin documentation and the decision record use mapping version 4. Experiment documentation covers candidate version 3, earlier-turn review derivation, `acceptance.py`, and audit template/project flags. English and Chinese pairs are aligned.
6. Ratings without notes use `noteCapture: absent`; the regression verifies native annotation payload metadata.
7. Human feedback remains a published metadata snapshot. The canonical candidate row ID stays stable; changed feedback changes export content and requires a new dataset version and previous receipt. The distinction is documented rather than silently removing preference evidence.
8. Configuration rejects enabled feedback on Windows before mounting effects. A platform regression verifies refusal and permits feedback-disabled configuration.

## Evidence and limits

Current command results and log hashes are recorded in `review-checks.json`. The fork aggregate covers plugin build/typecheck/tests, effort-slider build/typecheck/tests, and Python publication tests. Native Phoenix checks include two independent ratings on one inherited-message span and deletion of the fork rating while preserving the parent rating.

The earlier live campaign retains its measured 15/16 task success, 68 byte-exact reconstructed requests, and 41 admitted examples. It was not rerun after these lifecycle and reconciliation corrections. Its stdout/stderr do not contain plugin diagnostics; zero capture loss cannot be inferred from those files. Fable independently observed complete correlated conversation spans in Phoenix. Manual browser acceptance, an actual cross-process parent-materialization race, and cloud CI remain unexecuted acceptance checks. Local regression tests cover the failure condition without timing-dependent process scheduling. No existing deployment or inference configuration was changed.

## Handoff

Use `/tmp/dsh-v3-transition` for the committed checkout and regenerate ignored built files with `node artifacts/check.mjs` when restoring elsewhere. Preserve raw local acceptance evidence only while useful; it is disposable development data. Before deployment, run manual Web rating/dialog acceptance against the intended profile and verify diagnostics under representative child-process concurrency. Push and cloud CI can follow the committed checkpoint when requested.
