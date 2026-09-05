# Upstream update audit — 2026-09-05

## Selected revision

The fork is rebased onto upstream `d347e703908d0406b7a7ef80e3a0e594d86b2215`, tagged `dsh-v0.1.3-alpha.1`. Local deployment adaptations remain under `artifacts/`. [NEXT-SESSION.md](../NEXT-SESSION.md) owns the operational runbook.

## Metric patch finding

The pre-update history audit inspected fork tip `ac3725188141d744953e4467795bc302f42dacb3` against base `76fda729799fe9b3848dbe2c211d4b231032b81e`. All 21 fork-only commits touched only `artifacts/`; the diff outside that directory was empty. The remembered metric changes were in the local extractor, not product metric source.

The introducing commits were `a6da1d142a` (extractor), `6d38679990` (timing and packed-row handling), and `ac37251881` (local token-delta predicate). The product projection supplied timing definitions but was not patched by the fork.

## V2 adoption

Session format v2 embeds assistant streams in `assistant/attempt` and `assistant/message` records. The deleted `core/session/src/chunk-rows.ts` import cannot support this format. The local instruments target v2 directly; historical compatibility and migration of old UAT logs are outside the requested scope.

The current [UAT](../UAT.md) requires a fresh session. Retained August evidence describes only its dated run. Superseded assessment reports and their plugin/package inventories are removed from the active documentation.

All 16 scripts under `artifacts/probes/` were retired after confirming that the current instruments and UAT do not depend on them. They and the three removed assessment documents remain recoverable from Git history. Configuration commentary was reduced to current deployment instructions.

## Verification status

The fork checkout is updated, and all local file changes remain under `artifacts/`. No commit or push of these adaptations was made. Local `master` remains at the previous base; only the fork branch was rebased.

- `pnpm install --frozen-lockfile`: completed with host access, including the native `fs-ext` dependency.
- `pnpm dsh --profile headless --dump-config`: completed with host access. The sandboxed attempt could not write the profile's generated configuration under `~/.dsh`.
- `node --import tsx/esm artifacts/harness-tests/v2-regression.mts`: passed known timing values, product-projection parity, direct embedded streams, and rejection of old, empty, corrupt, and out-of-sequence input.
- The same regression checks concatenated compressed frames against raw JSONL and rejects a torn frame. `metrics.mts --all` reads compressed v2 logs in process through upstream's decoder: 1 v2 log, 0 decode errors, and 0 completed sessions. Old generations are excluded.
- Focused lint through `node --import tsx/esm scripts/run-oxlint.ts` on the five changed instrument files: passed. `git diff --check`: passed.
- Configuration comparison: non-comment lines of both versioned YAML files equal their live counterparts. Stale comments were removed from the versioned copies; no configuration values were changed or redeployed.
- `pnpm run build`: started with host access after sandbox IPC denial. The process handle was lost during the environment refresh, and the retained log has no definitive completion result; a successful full build is not claimed.
- `pnpm run test:docs`: 13 checks passed and 2 failed in the first post-update run. Markdown wrapping hit Node's `fs.glob` `ENOTDIR` in an upstream snapshot path. Translation pairing required an artifacts README counterpart; its repair is tracked separately below.
- `artifacts/README.zh.md` supplies the missing counterpart with matching line count and navigation. The scoped pairing-record generator produced no result during this session and was interrupted; its consistency record and recheck remain pending.
- `pnpm run doc-sync`: the host-access attempt did not start. Automatic approval review rejected it because workspace credits were exhausted. Full documentation and repository lint validation remain incomplete.

## Fresh live session

The headless E2 command created `/home/andrea/.dsh/sessions/--home-andrea-management-deepseek-harness--/session-94e3d3d4-8bbd-425c-aeb5-1204744b6dc3/session.v2.jsonl.zstd` at fork revision `bb0c3b16c0`. The captured log decodes as 11 complete Zstandard frames and passes the v2 physical reader. Its route is `local-qwen` / `chat-model`, with `maxTokens: 16384` and reasoning effort `medium`.

The captured session is incomplete: one closed step, two `read` calls and one `bash` call, a recorded `FS_NOT_FOUND`, no `write` call, and no `turn/end`. The [metrics](uat-v2-20260905/metrics.jsonl) and [B1.4 check output](uat-v2-20260905/checks.txt) preserve that observation. B1.4 fails 3 of 5 criteria; this is not an E2 pass and does not establish a product sandbox defect. Rerun the fresh UAT to completion before accepting the deployment. Optional interactive Web checks were not run.
