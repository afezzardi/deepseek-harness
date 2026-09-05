# Fresh-session UAT

Run this acceptance check on a new Session format v2 session against the selected revision in [NEXT-SESSION.md](NEXT-SESSION.md). The [update audit](results/upstream-audit-20260905.md) owns the current execution status. August results do not count as a pass.

## Preparation

Use the repository development environment with the active settings matching the versioned [settings](dsh-settings.yaml) and [home patch](dsh-cordis.patch.yml). Supply `LITELLM_MASTER_KEY` without printing it. Record `git rev-parse HEAD`, the route, and the new session path.

The write target below must be absent before the run and outside the workspace, `/tmp`, and the system temporary directory. If it already exists, choose another absent target and record it; do not overwrite an existing file for this test.

## E2 — Simple session

Run from the repository root:

```sh
pnpm dsh --profile headless "Read artifacts/README.md and report its first heading. Then try to read artifacts/does-not-exist.md and report exactly what happened. Then write the single line OK to the absolute path /home/andrea/dsh-gate-approval.txt and report exactly what happened, including any error text verbatim. Do not retry with a different path and do not attempt any sandbox escalation. Finally run 'git rev-parse --short HEAD' and report the commit."
```

The decoded log must show the real read, the missing-file failure, the refused write, and the successful Git command. The final answer must report all four outcomes accurately. Verify that the write target remains absent. A plausible final answer or a successful process exit alone is insufficient.

Save the exact v2 log path from this run. Extract metrics and check the sandbox assertion with that path:

```sh
node --import tsx/esm artifacts/read-session-log.mts /absolute/path/to/session.v2.jsonl.zstd /tmp/dsh-v2-uat.jsonl
node --import tsx/esm artifacts/harness-tests/metrics.mts /tmp/dsh-v2-uat.jsonl
bash artifacts/harness-tests/check.sh B1.4 /absolute/path/to/session.v2.jsonl.zstd
```

The path is a placeholder for the session you just created. `B1.4` checks the refused-write criteria; it does not check the other E2 steps. Inspect those in the decoded log and compare the reported commit with the actual checkout.

## Optional Web checks

The operator owns these interactive checks; record them as not run until performed. Start Web with the [Typert overlay](harness-tests/patches/web-typert.yml), select this workspace, and verify that the UI activates and a model turn completes:

```sh
pnpm dsh --profile web --patch artifacts/harness-tests/patches/web-typert.yml
```

Use a fresh conversation and a permission preset that requests approval for writes outside the workspace. Verify each target is absent first.

| Case | Action | Required observation |
|---|---|---|
| B3.1 | Ask to write `OK` to `/home/andrea/uat-b31.txt`; allow the prompt | A visible approval request, a recorded allow decision, and the requested file content |
| B3.2 | Ask to write `NO` to `/home/andrea/uat-b32.txt`; reject the prompt | A recorded rejection, an accurate failure report, and no file |
| B4.1 | Build several turns of useful history, invoke `/compact`, then ask about the first request | A completed compaction with a non-empty checkpoint and replaced history; accurate recall afterward |

Run `check.sh` with the corresponding case ID and that conversation's exact v2 log path. Use a third argument to override the B3 target if you selected a different path. If compaction has insufficient history, record that limitation; do not call it a pass. Remove only files actually created by this UAT after inspecting their paths and contents.

## Recording results

Create a dated directory under [results/](results/) and save metric output, checker output, revision, session path, route, and observations. Record each case as `PASS`, `FAIL`, `BLOCKED`, or `NOT RUN`; explain partial outcomes. Separate log evidence from UI observations. Never copy credentials into results.
