# Fresh v2 acceptance

Accept this deployment only from fresh Session v2 logs. Run the required cases in order; record `PASS`, `FAIL`, `BLOCKED`, or `NOT RUN` per case in a dated [results](results/) directory. [Latest execution](results/uat-nvfp4-v2-20260905/RESULT.md).

## 1. Prepare

Run from the repository root. Supply `LITELLM_MASTER_KEY` through the environment or ignored root `.env`; never save credentials in results.

```sh
cmp artifacts/dsh-settings.yaml "${DSH_HOME:-$HOME/.dsh}/settings.yaml"
cmp artifacts/dsh-cordis.patch.yml "${DSH_HOME:-$HOME/.dsh}/cordis.patch.yml"
git rev-parse HEAD
pnpm dsh --profile headless --dump-config
node --import tsx/esm artifacts/harness-tests/v2-regression.mts
```

Require matching configuration, `maxConcurrentAgents: 8`, and a passing regression. Record revision and configuration hashes. The route is `local-qwen/chat-model`; the display name identifies NVFP4. [Inference ownership](AGENTS.md#inference-host-ownership) governs live build verification.

## 2. Run required cases

Run each command in a fresh session, one case at a time. Save output and the exact session path. Nonzero exits, timeouts, missing terminal events, and partial results cannot pass.

### E2 — Tools and sandbox

Verify both targets are absent, then run:

```sh
test ! -e artifacts/does-not-exist.md
test ! -e /home/andrea/dsh-gate-approval.txt
pnpm dsh --profile headless "$(cat artifacts/harness-tests/e2-prompt.txt)"
```

If a target exists, choose an absent target in the prompt. Keep the write target outside the workspace and temporary directories.

Verify logged results and the final answer: README heading, `FS_NOT_FOUND`, denied write, correct Git commit. The write target must remain absent. `B1.4` checks only denial.

### W9 — Nine agents and result collection

```sh
pnpm dsh --profile headless "$(cat artifacts/harness-tests/workflow9-prompt.txt)"
```

Require one successful workflow, nine distinct child sessions, nine successful reads, and ordered results numbered 1–9 with `# artifacts/`. Check each child log and the parent’s collected result. No null results, extra children, writes, or unfinished members may pass.

Count open members from paired `tool-workflow/agent-start` / `agent-end` records grouped by `runId` and member `seq`. Require peak overlap **8**, the ninth child starting after a slot is released, and a completed `run-end` after all members settle. A lower peak is incomplete concurrency evidence. This setting limits each workflow run; it does not reserve GPU memory or cap all sessions or plain subagent calls globally.

## 3. Verify and record

Substitute the exact completed session path and a unique output path:

```sh
node --import tsx/esm artifacts/read-session-log.mts /absolute/path/to/session.v2.jsonl.zstd /tmp/dsh-v2-uat.jsonl
node --import tsx/esm artifacts/harness-tests/metrics.mts /absolute/path/to/session.v2.jsonl.zstd
bash artifacts/harness-tests/check.sh B1.4 /absolute/path/to/e2/session.v2.jsonl.zstd
```

Require complete decoding, terminal outcomes, and positive token usage. Save metrics and checker output. The regression checks product timing parity. Count workflow tokens across parent **and all children**; summed model time is not elapsed time. Historical performance is not a pass threshold.

Optionally run [engine sampling](harness-tests/sample-engine-metrics.sh) around W9. Report counter deltas and sampled running/waiting peaks separately from child overlap; missing counters are unknown, and sampled peaks are lower bounds. Sharing results with the inference owner requires authorization.

## Interactive follow-up

The operator runs these cases in Web with the [Typert overlay](harness-tests/patches/web-typert.yml); keep them `NOT RUN` until observed.

```sh
pnpm dsh --profile web --patch artifacts/harness-tests/patches/web-typert.yml
```

| Case | Action | Pass evidence |
|---|---|---|
| Web | Open this workspace; send a message | UI activates and a real model turn completes |
| B3.1/B3.2 | With an approval-requesting preset, allow `OK` to `/home/andrea/uat-b31.txt`; reject `NO` to `/home/andrea/uat-b32.txt` | Visible prompts, matching decisions/results, exact allowed content, rejected file absent |
| B4.1 | Build useful history including a unique fact; `/compact`; ask for that fact | Non-empty replacement history, `local-qwen-off` summary, clean end, correct recall |
| Resume | Close and reopen the completed conversation; ask for an earlier fact | Same session, persisted history, correct recall |
| Cancel | Stop an active W9 workflow; then send a simple message | Cancelled run, all started members settled, no continuing child work, next turn completes |

Run `check.sh` for each B3/B4 case with its exact log; a third argument overrides B3’s target. Verify targets are absent before writes; inspect and remove only files this UAT created. Insufficient history cannot pass compaction. Resume checks conversation persistence; workflows cannot resume across process restarts.
