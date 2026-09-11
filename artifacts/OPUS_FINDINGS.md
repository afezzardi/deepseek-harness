# Independent review — gh-genai-traces and the trace-to-dataset design

Historical review of the baseline named below. The [current handoff](plugins/gh-genai-traces/HANDOFF.md#pending-work) and [r5 review dispositions](results/trace-pipeline-r3-20260909/FABLE-REVIEW.md) own current implementation status and remaining work.

Reviewer: Claude Opus 5. Revision 2, 2026-09-08.

**Review baseline.** Branch `fork/qwen38-deployment` at `0cd6db5b80`, **plus the uncommitted working tree** as of ~19:21 — 13 modified files and the new `src/{checkpoint,fireworks,grading,render-preview,snapshot}.ts`, `tests/{reliability,render-preview}.spec.ts`, and `experiments/{backup,balanced_campaign,benchmark,phoenix_dataset,render_qwen}.py`. Revision 1 of this document was written against the pre-19:00 tree and is superseded; the [repaired list](#repaired-since-revision-1) records what changed so nothing is re-litigated. Line references below are to the working tree, not to HEAD.

Scope read: `AGENTS.md`, `artifacts/{AGENTS,README,NEXT-SESSION}.md`, the plugin's `HANDOFF/README/DESIGN/VALIDATION` and `experiments/README`, both dated reports, current plugin `src/` and `tests/`, the experiment scripts, `recproxy.py`, committed evidence under `artifacts/results/`, and the upstream session / session-query / llm / user-approval sources the plugin depends on. External claims verified against Fireworks and Arize primary documentation via Context7 and Tavily on 2026-09-08 and cited inline; anything unverified is marked.

## A. Decision brief

**Sound.** Rows are curated from upstream canonical snapshots, never from Phoenix spans, so trace loss cannot corrupt a dataset. Reconstruction uses upstream's own blessed projection (`foldSurface` + `deriveEventMessage`). Capture completeness, privacy transformation, and task success stay separate facts. The second-pass rewrite added the three things that were most obviously missing: real environment grading against a pre-inference inventory, an externally-supplied split ledger that fails closed, and resumable per-session checkpoints. `recproxy.py`'s byte-identical request hashes remain the strongest evidence in the package.

**Largest threat.** Still the objective, not fidelity. The trained turn can never contain a tool call (`fireworks.ts:43`) and has its reasoning stripped (`fireworks.ts:57`) — and Fireworks now explicitly documents `reasoning_content` on the trained turn as what "ensures training-inference consistency". You are training a thinking-route agent to stop thinking, on an objective that cannot reach delegation, tool selection, or recovery.

**Second-largest.** The promotion path is open at both ends. Nothing writes `assignments` into an audit manifest, so every candidate resolves to `split: null` and `sftEligible` is forced false — the audit currently promotes nothing, and the split ledger it would use lives only in Phoenix.

**Next investment.** Close the ledger loop, then run the renderer check that `render_qwen.py` is already reaching for, then the 144-rollout repeatability baseline. In that order.

**Stop / defer.** Stop growing candidate counts. Defer managed DPO. Defer ATIF, semantic recall, and further tracing polish.

## B. Prioritized findings

Ten ranked findings against the current tree, then a short lower-severity list. Findings 2–10 are new or newly re-verified in this revision; finding 1 carries forward with stronger evidence.

---

### 1. The trained turn cannot contain a tool call, and its reasoning is removed

- **Severity:** critical · **Category:** learning objective · **Confidence:** high (mechanism certain; the training effect is inference)
- **Evidence:** `src/fireworks.ts:43` rejects a target message carrying `tool_calls`, so **no tool-call token ever receives positive loss**. `src/fireworks.ts:57` — `if (!target) row.reasoning_content = …` — keeps `reasoning_content` on weight-0 turns and omits it from the trained turn. `src/curation.ts:31` names this deliberately: `TRANSFORMATION.reasoning: 'retain-source-omit-target'`, with `curation.ts:93` selecting `reasoning: 'omit'`. Fireworks' SFT documentation presents the opposite as the point of the field: its thinking-traces example carries `reasoning_content` on the trained assistant turn and states this "ensures training-inference consistency", and its interleaved example keeps `reasoning_content` on an assistant turn *alongside* `tool_calls` (Fireworks fine-tuning docs, retrieved 2026-09-08).
- **Failure scenario:** you train on the promoted rows. The only positive-loss content is a short JSON answer that follows a context containing reasoning. The model learns to terminate thinking at the answer step. At inference the production route requests `medium` effort, so the deployment's whole premise is pushed toward degenerate reasoning. Meanwhile the four agentic families now in the benchmark — `scoped-edit`, `recovery`, `delegation`, `workflow` (`benchmark.py:8-9`) — generate rollouts whose tool decisions receive no gradient at all.
- **Smallest useful change:** flip `TRANSFORMATION.reasoning` to `'supervise'` (the union at `curation.ts:93` already declares it) and emit `reasoning_content` on the target, **or** state in `DESIGN.md` that these rows target a non-thinking route only and stop describing them as production-agent SFT.
- **Acceptance test:** render one candidate with the real base-model template and assert the trained span contains a non-empty thinking region — or that the destination route is non-thinking.
- **What would change my mind:** the selected renderer's history mode discarding thinking from *all* assistant turns, making the omission a no-op.

---

### 2. The split ledger has no writer — the audit promotes nothing

- **Severity:** high (blocking) · **Category:** promotion wiring · **Confidence:** high
- **Evidence:** `experiments/prepare-audit.py:31` builds the manifest with `output`, `sessionIds`, `trials`, `replay`, `revision` — and no `assignments`. `experiments/audit-profile.ts:26` defaults `assignments` to `[]`. With an empty list, `partitionCandidates` builds no `memberships`, so `curation.ts:134-135` yields `splits.size === 0` → `split = null`, and `curation.ts:139` forces `sftEligible: candidate.sftEligible && split !== null` to false for **every** candidate. `audit-profile.ts:78` and `:81` both filter on that. The only `groupKeys` producer is `experiments/benchmark.py:89`, and a repo-wide grep finds no caller that pipes `phoenix_dataset.Phoenix.assignments(receipt)` into a manifest.
- **Failure scenario:** you run the audit and get `eligibleTargets: 0`, `fireworks-sft.jsonl` empty, `preferences.jsonl` empty — regardless of how well the campaign scored. Fail-closed is the right direction, but the visible symptom invites someone to hand-write assignments into the manifest, which is exactly the ad-hoc split path the redesign removed.
- **Smallest useful change:** in `prepare-audit.py`, accept a receipt path, call `Phoenix.assignments(receipt)`, embed the result, and raise when no receipt is given.
- **Acceptance test:** a run producing a nonzero `eligibleTargets` with every promoted row carrying a `version` traceable to a pinned dataset version; and a run with a missing receipt failing loudly rather than emitting zero.
- **What would change my mind:** an unversioned driver script outside the plugin that assembles the manifest — I did not find one.

---

### 3. Checkpoints memoize transient failures as permanent rejections

- **Severity:** high · **Category:** lost audit work · **Confidence:** high
- **Evidence:** `src/checkpoint.ts:39` — `try { record = { key, result: await work() } } catch (error) { record = { key, rejection: String(error) } }` — persists **any** thrown error as a durable record. `checkpoint.ts:36` then returns it on every later run whenever `prior.key === key`, and the key is `digest({source, task, grader, config, settings, transformation})` (`audit-profile.ts:43-44`), none of which changes on a retry. The work function does real I/O: `gradeTask` → `gradeWorkspace` walks the trial workspace (`reward.ts:59-70`).
- **Failure scenario:** the audit runs while a trial workspace is on a slow or briefly-unavailable mount, or after a cleanup pass removed it. `gradeWorkspace` throws, the rejection is written, and that session is **excluded from candidates forever** — re-running the audit returns the cached rejection and never regrades it. Nothing distinguishes it in `summary.json` from a legitimately ungradable session.
- **Smallest useful change:** tag deterministic rejections (a `GradeRejection` error class) and persist only those; rethrow operational errors so `audit-profile.ts:71-74` records a retryable `read-rejections` entry instead.
- **Acceptance test:** make `gradeWorkspace` throw once, re-run, and assert the session is regraded and admitted.
- **What would change my mind:** nothing — the caching is unconditional and readable.

---

### 4. Approval decisions are invisible to grading and curation

- **Severity:** high · **Category:** evaluation validity / safety · **Confidence:** high
- **Evidence:** `packages/interaction/user-approval/src/types.ts:41` and `:50` declare `approval/asked` and `approval/decided` as **log-only audit events, explicitly not surface events**, so `foldSurface`/`deriveEventMessage` never place them in a reconstructed request. A grep over the plugin's `src/*.ts` finds no approval handling; `src/grading.ts` never inspects them; `curateSession` has no approval gate; `curation.ts:103`'s `sourceEvidence` filter collects `tool/result` errors and `assistant/attempt` but not approval outcomes.
- **Failure scenario:** a rollout succeeds **only because a human granted `allowed-once`**. Every grade dimension passes, the candidate is curated, and neither the row nor its provenance records that a gate was crossed. At inference no human approves, so the trajectory the model learned to condition on is unreproducible. The inverse also erases: a `rejected` decision produces a tool error result that reads, in the row, like an ordinary tool failure.
- **Smallest useful change:** add `approval/decided` to the `sourceEvidence` filter at `curation.ts:103`, and reject (or flag) any candidate whose prefix contains a decision other than `rejected` until an explicit policy exists.
- **Acceptance test:** a fixture with one `allowed-once` decision mid-turn and a correct final answer; assert the candidate is either rejected or carries the decision in provenance.
- **What would change my mind:** a stated decision that human-approved trajectories are acceptable training data — legitimate, but today the candidate cannot express it either way.

---

### 5. The split ledger exists only inside Phoenix

- **Severity:** high · **Category:** governance / leakage · **Confidence:** high
- **Evidence:** `experiments/phoenix_dataset.py:85` writes `splitSnapshot` and `rowHashes` into dataset-**version** metadata; `:124-130` `assignments()` reads `splitSnapshot` back from that pinned version and joins it to `e['metadata']['groupKeys']`. The local atomic receipt written at `:112-114` carries `datasetId`, `datasetVersion`, `exportIdentity`, `rowHashes`, `count`, `url` — but **not** `splitSnapshot` and **not** `groupKeys`. The plugin's own handoff states Phoenix retention is not durable evidence storage (`HANDOFF.md:29`), and the Compose stack defaults to 30-day retention (`README.md:39`).
- **Failure scenario:** the Phoenix volume is lost, pruned, or the dataset is deleted. The receipt still verifies its own row hashes, but every held-out assignment is gone. The next campaign re-derives splits from scratch and a previously reserved family can land in train — with no record that it was ever held out.
- **Smallest useful change:** add `splitSnapshot` and per-example `groupKeys` to the receipt at `phoenix_dataset.py:112`; treat the receipt file as the durable ledger and Phoenix as its mirror.
- **Acceptance test:** delete the Phoenix dataset, then reconstruct assignments from the receipt alone and assert byte-identical split membership.
- **What would change my mind:** an external backup of Phoenix's Postgres volume with a tested restore.

---

### 6. `output:` as a union key can merge a train family into a test family

- **Severity:** medium-high · **Category:** leakage / yield · **Confidence:** medium-high (mechanism certain; trigger frequency estimated)
- **Evidence:** `src/curation.ts:128` includes `output:${p.outputHash}` among the union keys, and `curation.ts:129` joins **all** candidates — `candidates.forEach(c => join(keys(c)))` — with no grade filter, so failing candidates participate. `outputHash` is `digest(response.content)` (`curation.ts:101`). Union-find merges are transitive and permanent within a partition call.
- **Failure scenario:** two failing rollouts in different families emit byte-identical text — an empty object, the same refusal sentence, the same truncated fragment. Their families merge into one group. If those families carry different splits, `curation.ts:136` records `conflictVersions` and `split` becomes `null`, so **both families lose all eligibility**. Passing rows are protected only incidentally, because `benchmark.py` embeds a unique `instance` key in every expected answer; failure text has no such protection. The `row:` key already covers exact duplicates including the request, so `output:` adds merge risk without adding dedup power.
- **Smallest useful change:** drop `output:` from `keys()`, or join it only among candidates that already share a `task:` key.
- **Acceptance test:** two candidates from differently-split families with identical `response.content`; assert both keep their own family's split.
- **What would change my mind:** evidence that failure texts are reliably instance-unique in practice — worth measuring on the existing grades before changing anything.

---

### 7. Replay reports success while silently dropping records

- **Severity:** medium · **Category:** lost audit work / evidence · **Confidence:** high
- **Evidence:** `src/index.ts:121` asserts `stats.spansFailed || stats.spansDropped || stats.captureErrors` — it omits `recordsDropped`, which is the counter incremented by the only two record-loss paths: `mapper.ts:103` (deferred-buffer overflow) and the session-limit guard in `event()`. `audit-profile.ts:66-70` then writes `{session: id}` with no `error` field and pushes it to the `telemetry` array reported in `summary.json`.
- **Failure scenario:** a large session overflows `maxPendingRecords` (default 1,024, `config.ts:21`). Whole child turns never map. The replay resolves successfully, the audit records an affirmative telemetry entry, and `summary.json` shows a clean run — while the replay project is missing spans nobody will look for.
- **Smallest useful change:** add `recordsDropped` to the assertion at `index.ts:121`; better, also compare `recordsAccepted` against the number of events offered.
- **Acceptance test:** replay with `maxPendingRecords: 1` and assert the call rejects.
- **What would change my mind:** nothing — the counter is simply absent from the predicate.

---

### 8. Half the held-out split cannot execute

- **Severity:** medium · **Category:** benchmark validity · **Confidence:** high
- **Evidence:** `experiments/benchmark.py:10` assigns the `lifecycle` family to the **test** split; `benchmark.py:49` gives it `extra['driver'] = 'resume-two-turns'`. `experiments/balanced_campaign.py:57-58` refuses any task carrying `driver` — `error = 'Unsupported lifecycle driver: ' + task['driver']` — and records `failure_owner: 'harness'` without running anything.
- **Failure scenario:** the test split nominally holds two families (`lifecycle`, `reconciliation`, 8 instances). One of them produces only harness errors, so held-out coverage of cancellation/resume — the exact path `HANDOFF.md:19` lists as unverified — is measured at zero while the benchmark reports 12 families.
- **Smallest useful change:** either implement the two-turn driver in `balanced_campaign.py` or move `lifecycle` out of `test` until it runs, so the held-out split reflects executable coverage.
- **Acceptance test:** a benchmark assertion that every family in `validation` and `test` produced at least one non-`harness` `failure_owner` result.
- **What would change my mind:** a separate runner that handles drivers — `balanced_campaign.py` is the only consumer of `benchmark.py` output I found.

---

### 9. One child session can emit two different `session.id` values

- **Severity:** medium · **Category:** observability correctness · **Confidence:** medium-high
- **Evidence:** `src/mapper.ts:98` — `'session.id': digest([3, project, origin, this.ownership.get(id)?.rootSession ?? id])`. `presentation(id)` is called from `event()` (`mapper.ts:170`) and from `startCall` (`mapper.ts:303`). The live deferral gate at `mapper.ts:155-158` only defers when `event.type === 'turn/start' || this.deferred.has(id)`, and the `startCall` gate (`mapper.ts:282`) only fires when `deferred.has(id)` is already true. So a child's first non-`turn/start` event, or an auxiliary model call arriving before any turn opens, is mapped immediately with `ownership` still empty and hashes **its own id**; spans emitted after ownership resolves hash the **root** id.
- **Failure scenario:** a workflow child's conversation is split across two Phoenix sessions, which is the same class of defect the `session.id` addition was meant to fix. Silent — both sessions look well-formed.
- **Smallest useful change:** resolve `session.id` lazily at span end, or defer every live child event (not just `turn/start`) until ownership resolves or the session disposes.
- **Acceptance test:** a live-origin mapper spec that opens a child span before ownership and asserts one distinct `session.id` across all that child's spans.
- **What would change my mind:** proof that a child session's first mapped event is always `turn/start` in practice — the gate's own `|| this.deferred.has(id)` clause suggests the authors did not assume that.

---

### 10. Output durability and provenance anchoring

- **Severity:** medium · **Category:** lost work / reproducibility · **Confidence:** high
- **Evidence:** three related defects. (a) `audit-profile.ts:89` writes `candidates.jsonl`, `preferences.jsonl`, and `fireworks-sft.jsonl` with plain `writeFile`, while `atomicJson` is used at `:40`, `:69`, `:91`, `:93` — an interrupted write leaves truncated JSONL that still parses line-by-line. (b) `prepare-audit.py:30` creates `audit/` with the default mode and runs first, so `audit-profile.ts:34`'s `mode: 0o700` is a no-op on the existing directory; the files are `0600` but the directory holding canonical `*.session.json` is not. (c) `prepare-audit.py:48` still seeds the audit home from `artifacts/results/trace-discovery-20260908/.home`, matched by `**/.home/` in the results `.gitignore`, and `audit-profile.ts:55` hashes that untracked file as `configurationHash`.
- **Failure scenario:** a crash mid-write yields a silently short dataset; the campaign's asserted configuration identity points at a file that is not in version control and not backed up (949 MB of evidence under `results/` is untracked — `git ls-files` returns 150 files there).
- **Smallest useful change:** route all three JSONL writes through the atomic temp+rename path; pass `mode=0o700` at `prepare-audit.py:30`; commit the settings template, or embed its content in the manifest.
- **Acceptance test:** kill the audit during the final write and assert the JSONL is either absent or complete.

---

### Lower-severity, still worth fixing

- **`bash` arguments are ungraded.** `grading.ts:47-52` path-checks only `['read','write','edit']`. No current benchmark task allows `bash` (`benchmark.py:24,30,36,40`), so this is latent — but the sandbox-escalation path (`sandbox_permissions`) is exactly what raises an approval prompt, and `campaign.py`'s UAT cases do use bash. Add an argument check before any task allows it.
- **`requiredEvents` has only minimums.** `grading.ts:59-61` counts `>= minimum`. There is no way to assert "no approval was asked" or "no escalation occurred". Add `forbiddenEvents` or exact counts to `TaskEvidence`.
- **Approval audit lives on a 128-event budget and 30-day retention.** `config.ts:20` `maxEventsPerSpan: 128`, re-enforced at `transport.ts:107`; `attach` silently increments `dropped` past it. `Production-Ready_AI_Agents_2026.md` §9 asks for ≥1y retention on approval and human-intervention signals.
- **`campaign.py` remains index-derived.** `campaign.py:41-42` still computes family and seed from the trial index with no campaign salt, so any two campaigns overlap exactly on their first `min(N,M)` tasks. `balanced_campaign.py` supersedes it with pinned `task_id`s; retire `campaign.py` or salt it so old and new evidence cannot be conflated.
- **`duplicateOf` chains.** `curation.ts:138` overwrites `seen` on every candidate, so the third duplicate points at the second rather than the first. Counts are right; the provenance chain is misleading.

## Repaired since revision 1

Confirmed fixed in the working tree — not active defects:

| Revision-1 finding | Now |
|---|---|
| `environment` derived from exit code; fixture hashes never compared | `grading.ts:62` → `reward.ts:79-95` compares a pre-inference inventory; exit code moved to `grade.execution` (`curation.ts:17`) |
| Splits recomputed from a hardcoded list; new families silently trained | Assignments supplied externally; unassigned or conflicting groups get `split: null` and cannot promote (`curation.ts:134-139`) |
| `task` recorded but never a union key | `task:` joined at `curation.ts:128` |
| Privacy gate was a hardcoded constant | Review bound to `contentHash` + `transformationHash` (`curation.ts:92`, verified at `audit-profile.ts:53`) |
| One replay failure discarded the whole audit | Per-session `checkpoint()` plus a caught replay (`audit-profile.ts:66-70`) |
| No `session.id`, so Phoenix showed one session | Set at `mapper.ts:98` (see finding 9 for the remaining edge) |
| Live child capture rescanned the full ancestor log per event | Incremental via `ownershipProgress` / `ownershipOffset` (`mapper.ts:88-95`) |
| Validation and test were one template each | 12 families × 4 instances × 3 repetitions (`benchmark.py:7-14`) |
| DPO "rejected" side could be merely non-eligible | Now requires an actual `fail` observation (`audit-profile.ts:82`) |
| **`weight: 0` might mean skipped from rendering** | **Not a defect.** Fireworks' multi-turn example keeps a `weight: 0` assistant turn *with* `reasoning_content` before a trained turn — it is loss masking, not removal. Withdrawn. |

## C. Minimal target design

```
                     ┌──────────────────────────────────────────┐
                     │  AUTHORITATIVE: session JSONL generations│
                     │  (upstream-owned, immutable, append-only)│
                     └───────────────┬──────────────────────────┘
                                     │ sessionQuery / readArtifactSnapshot
            ┌────────────────────────┼──────────────────────────┐
            │                        │                          │
   ┌────────▼─────────┐   ┌──────────▼───────────┐   ┌──────────▼──────────┐
   │ live OTel spans  │   │ replay OTel spans    │   │ curateSession        │
   └────────┬─────────┘   └──────────┬───────────┘   └──────────┬──────────┘
            └─────────────┬──────────┘                          │
                    ┌─────▼─────┐                         ┌─────▼──────┐
                    │  Phoenix  │  review + ledger MIRROR │  candidate │
                    │ (30d, NOT │  ── not on the ────────►│  + grade   │
                    │  evidence)│      dataset path       │  + prov.   │
                    └───────────┘                         └─────┬──────┘
                                                                │
   AUTHORITATIVE: task dataset (benchmark.py → phoenix_dataset) │ GATE 1  admission
   prompt, fixtures, expected, groupKeys, split — pre-inference │ complete capture,
                                                                │ bound review,
   AUTHORITATIVE: receipt file  ──────────────────────────────► │ owned final answer
   datasetId + version + rowHashes + splitSnapshot + groupKeys  │
   (durable local copy — finding 5)                             │ GATE 2  split
                                                                │ ledger-assigned,
   AUTHORITATIVE: recproxy body log ──────────────────────────► │ immovable
   exact provider bytes + sha256                                │
                                                                │ GATE 3  fidelity
                                                                │ reconstructed ==
                                                                │ serialized actual
                                                                ▼
                                                         ┌──────────────┐
                                                         │ GATE 4       │
                                                         │ renderer     │ ← blocks
                                                         │ tokens+mask  │   everything
                                                         └──────┬───────┘
                                                                ▼
                                                       dataset manifest
```

**Authoritative records:** session JSONL generations; the pinned task dataset; the **receipt file** (which must carry the split snapshot — finding 5); the proxy body log. Phoenix is review surface and ledger mirror, never the ledger of record.

**Promotion gates:** admission → split (ledger-assigned, immovable) → fidelity (reconstruction equals the recorded provider body) → renderer (tokens and mask observed on the real backend). Gates 1 and 2 exist but gate 2 is unwired (finding 2); gates 3 and 4 do not exist yet.

**What stays:** the whole `src/` seam as written — `content`, `curation`, `fireworks`, `grading`, `reward`, `checkpoint`, `snapshot`, `stream`, `transport`, `mapper`, `replay`. `phoenix_dataset.py`'s publish/verify/assignments design is right; it just needs a caller and a durable receipt.

**What changes:** wire `assignments` into `prepare-audit.py`; add `splitSnapshot`/`groupKeys` to the receipt; drop `output:` from the union keys; separate deterministic from operational checkpoint rejections; add `recordsDropped` to the replay predicate; carry approval decisions into `sourceEvidence`; make the three JSONL writes atomic.

**What can be deleted:** `campaign.py` (superseded by `balanced_campaign.py`, and its index-derived tasks contaminate cross-campaign accounting); the managed-DPO path unless a real preference source appears — it is structurally incapable of expressing agent behaviour.

## D. Next three bounded experiments

### E1 — Reconstruction fidelity against the wire

- **Hypothesis:** the adapter serialization of `curateSession`'s reconstructed `request` is byte-identical to the provider body the engine received.
- **Decision:** whether reconstructed harness input is admissible as training input at all. If not, gates 3 and 4 are moot.
- **Workload:** ~20 already-recorded trials — no new inference — including ≥4 tool trajectories, ≥1 `recovery`, ≥1 `delegation` child session, ≥1 compacted session, and ≥1 cancelled-then-resumed session.
- **Controls:** a corrupted request must fail; an adapter-defaulted `reasoningEffort` must be distinguishable from a requested one (`curation.ts:99` hardcodes `adapterDefaults: null` while `EpochHeader.adapterDefaults` carries the fact — one-line fill); auxiliary title calls must be excluded, not silently matched.
- **Evidence:** per-trial `{reconstructed_sha256, recorded_sha256, first_divergence_json_path}`.
- **Pass/fail:** ≥95 % exact match on tool-free turns; 100 % of divergences explained by a named field. Any unexplained `messages` or `tools` divergence fails.
- **Resources / stop:** ~2 h, no paid inference. Stop at the first unexplained `messages` divergence.

### E2 — Finish the renderer check

- **Hypothesis:** with the real Qwen3.8 chat template, a weight-0 assistant turn renders with its `tool_calls` intact and loss covers exactly the trained answer — and the trained turn's missing `reasoning_content` produces an empty thinking region.
- **Decision:** whether any candidate is training-ready, and whether finding 1's target policy must flip. `experiments/render_qwen.py` already reports `'request-token-parity; training renderer approval pending'` — this finishes it.
- **Workload:** one tool-bearing row and one tool-free row; apply the engine's own tokenizer and template locally and print token IDs plus the mask. No training job, no upload.
- **Controls:** a row with only a final answer (renders identically minus the prefix); a row whose weight-0 message is removed (must render *differently* — the vendor docs say it should, so this now checks our renderer, not theirs); a target with `reasoning_content` restored, to size the difference finding 1 predicts.
- **Evidence:** rendered token IDs, decoded text, boolean mask, saved beside the row hash.
- **Pass/fail:** pass iff weight-0 turns appear in the prompt with their tool calls, loss is nonzero only on target tokens, and the thinking region matches the declared policy.
- **Resources / stop:** ~3 h. Binary — stop when either control fires.

### E3 — Close the ledger loop, then measure repeatability

- **Hypothesis:** the residual failures are format/prompt failures, not capability failures, and are cheaper to fix in the prompt than by training.
- **Decision:** whether to train at all, and what any future checkpoint must beat. Also the first end-to-end proof that gate 2 works.
- **Workload:** wire `assignments` (finding 2), publish the 48-task benchmark, run `balanced_campaign.py`'s 144 rollouts (48 instances × 3), audit, and confirm a nonzero `eligibleTargets` with every row traceable to a pinned version.
- **Controls:** an arm with a strengthened output-format instruction only, no training — the free-fix control. A deliberately broken grader must yield 0 % (a 0 % pass@k usually means a broken task, per `Production-Ready_AI_Agents_2026.md` §8). Interleave arms on the same engine.
- **Evidence:** per-instance pass^3 and pass@3, per-family Wilson intervals over *instances* not trials, and a failure taxonomy separating model / harness / infrastructure / capture — `balanced_campaign.py:73` already reserves `failure_owner`.
- **Pass/fail:** if the format-only arm closes ≥60 % of the gap, defer training. If per-instance pass^3 variance dominates the between-arm difference, the benchmark is too small to detect any training effect and must grow *before* training.
- **Resources / stop:** ~2 h engine time at concurrency 4. Stop early if the format-only control closes the gap.

## E. Training go/no-go criteria

**Stage 1 — Observable and reconstructable.** *Largely met.* Canonical events, upstream projection, deterministic span IDs, idempotent reimport, interrupted turns provably non-eligible, incremental ownership indexing. **Missing:** the wire comparison (E1); `adapterDefaults` (`curation.ts:99`); compaction, cancellation/resume, and approval-change reconstruction tests; `recordsDropped` in the replay predicate (finding 7).

**Stage 2 — Eligible curated candidate.** *Partially met, currently blocked.* Real environment grading, bound privacy review, resumable checkpoints, fail-closed splits. **Missing:** the ledger writer (finding 2, blocking); a durable ledger (finding 5); approval awareness (finding 4); the `output:` merge fix (finding 6); an executable `lifecycle` family (finding 8).

**Stage 3 — Compatible training input.** *Not met.* No rendered tokens, no observed loss mask, no checkpoint identity — `curation.ts:102` still records `renderer: null, tokenizer: null, checkpoint: null`, and `summary.json` reports `rendererValidated: false, tokenRlReady: false`. That honesty is correct; E2 is the whole gate.

**Stage 4 — Demonstrated agent improvement.** *Not met.* No repeatability baseline, no checkpoint comparison. The benchmark can now support one; it has not been run end to end.

**Held-out baseline that separates training from harness changes.** Freeze one harness revision and one settings hash and record both per result. Run three arms against the same pinned task dataset, interleaved on the same engine in one window: **(A)** base checkpoint, current prompts; **(B)** base checkpoint, changed prompts/tools only; **(C)** tuned checkpoint, arm-A prompts. B−A attributes harness gains, C−A attributes training gains, C−B is the residual. Report per-instance pass^k with a paired bootstrap over **instances**, never over trials — 48 instances with 3 correlated repetitions will manufacture significance if pooled. Every touch of a held-out family goes in the ledger; repeated exposure to those results is itself contamination.

## F. Questions and dissent

Only these change the recommendation:

1. **Is the training destination the self-hosted Qwen3.8 route or a Fireworks-hosted model?** `fireworks.ts` shapes the export to a managed-SFT subset. If the destination is your own engine, that subset is a detour and the format should be whatever your trainer consumes.
2. **Is the production agent's route thinking or non-thinking?** If thinking, finding 1 disqualifies the current target policy.
3. **What is the real production workload?** The benchmark's 12 families are a good synthetic spread, but if real work is repository-scale agentic editing, E3's task set should be drawn from real sessions instead.
4. **Is there an off-repo backup of the 949 MB under `results/`, and of the Phoenix volume?** If not, findings 5 and 10 are already load-bearing.

**Strongest disagreement.** The pipeline optimizes the weakest available training signal. Your assets are deterministic code graders (`grading.ts`), resettable fixtures with real integrity checks (`reward.ts`), and a pinned 48-instance benchmark with 3 repetitions — precisely the inputs a verifier-driven method wants. Fireworks' own training overview puts RFT at "prompts, plus an evaluator that can tell a good outcome from a bad one" and "dozens to thousands of prompts, often fewer than 100 is enough", against SFT's "hundreds of examples, or roughly 10M+ tokens" and DPO's "hundreds to thousands of pairs". You are one wiring fix away from a working verifier loop and an order of magnitude away from a viable SFT corpus — and the SFT objective structurally cannot touch the `delegation`, `workflow`, `recovery`, and `scoped-edit` families you just built.

I would treat the benchmark as a **verifier-driven prompt set** — pinned tasks, reset fixtures, independent graders, no exported transcripts — and keep final-answer SFT as, at most, a small format-repair dataset for a non-thinking route.

What would convince me the current design is right: E2 showing the renderer preserves weight-0 tool trajectories intact **and** E3 showing the residual failures survive a prompt fix. That combination would make final-answer SFT both mechanically sound and pointed at the actual gap. Absent either, I would not spend another campaign on it.
