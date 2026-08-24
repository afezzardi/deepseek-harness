# artifacts/

Assessment, bring-up, and remediation of Qwen3.8-27B on DeepSeek Harness, against the self-hosted
inference stack on `srvhapeda`.

Nothing here is upstream material. It is this fork's evaluation record plus the deployment
configuration that came out of it.

## Where the authority sits

**Everything engine-side lives on the inference host, not here.** `kb-mastra-infra/docs/TUNING.md` owns
block accounting, prefix-cache geometry, fp8, the shipped shape, and — in its §6 — the single
retraction ledger for both sessions. `kb-mastra-infra/MESSAGE.md` is the two-way exchange. Do not copy
their content back into this directory; reference the section.

What is ours, and has no other home: the harness-side configuration and its rationale, the measured
workload profile, the sandbox and approval findings, and the probes.

| File | What it is |
|---|---|
| `AGENTS.md` (+ `CLAUDE.md` symlink) | Scoped guidance for future sessions: the reference repos and how to reach them, verification discipline, the live-config sync rule, the git rule. |
| `NEXT-SESSION.md` | **Start here.** Current state, the four claims this fork retracted, the measured workload, the config we run, the ranked queue, the E2 regression gate, and the traps. |
| `UAT.md` | The user acceptance suite and the regression suite for every future configuration change: 31 cases in eight blocks, the verdict vocabulary, the recorded results per run, and the false-pass shapes to watch for. Case ids are stable and permanent. Three sittings are recorded; B7.1, B3.3, B3.5 and B8.4 remain open. |
| `deepseek-harness-consolidated-assessment.md` | **Purge ledgers A and B** — the row groups, their measured package/dependency/LOC effect, and the ordering constraints. Re-verified against `0.1.1-rc.1`. **Ledger A3 is withdrawn**: the delegation rows it would remove are verified working (UAT B5, 2026-08-23), and no purge candidate replaced it. |
| `deepseek-harness-plugins-overview.md` | **The 138-row composition inventory** — id, package, intent, layer. How a ledger row group resolves to actual ids. **Still valid at `0.1.1-rc.2`**: that release added and removed no packages, so neither the 138 rows nor the 81-row `--dump-config` moved. |
| `deepseek-harness-foundation-assessment.md` | The benchmark matrix and its Pareto analysis, the pi-ai settings-layer risk register, and the adapter-justification criteria. Trimmed to those three on 2026-08-21; the four-phase evaluation plan it carried was executed and removed. |

The consumer guide to the inference stack is `kb-mastra-infra/HOW-TO.md` **on the host**. Read it there;
do not keep a copy here.

Deleted 2026-08-21: `qwen38-harness-bringup.html` and `qwen38-harness-remediation.html` (spent
transition artifacts) and `how-to.md` (a stale copy of the host guide, still claiming prefix caching was
off). What was still load-bearing moved rather than vanished — the reasoning-field root cause and the
`/engine/v1` requirement into `dsh-settings.yaml`, the sampler table and instruct-alias block into
NEXT-SESSION.md §E5, the two defect fixes into the `dsh-cordis.patch.yml` comments. Also retired
earlier: `deepseek-harness-assets-adversarial-review.md`.

## Working configuration

Copies of the live files under `$DSH_HOME` (`~/.dsh`), which sits outside this checkout. These are the
durable record, and they are in sync with the live files as of 2026-08-21.

| File | Deploys to | Carries |
|---|---|---|
| `dsh-settings.yaml` | `~/.dsh/settings.yaml` | the `local-qwen` thinking route and the `local-qwen-off` non-thinking route, both at `maxTokens: 16384` |
| `dsh-cordis.patch.yml` | `~/.dsh/cordis.patch.yml` | Typert rows off, compaction threshold 0.8, fan-out bound 4, both capped auxiliary calls routed off-thinking |

Credentials are referenced, never stored: `apiKeyEnv: LITELLM_MASTER_KEY` resolves per request. Put the
value in `./.env` at the repo root (gitignored) or the process environment.

## Instruments

| File | Use |
|---|---|
| `recproxy.py` | Recording reverse proxy. Logs each request body to JSONL and forwards upstream; streams SSE through with chunked framing. The only way to see sampling and `chat_template_kwargs`, since the session log records model-visible content only and the gateway runs `set_verbose: false`. |
| `read-session-log.mts` | Decodes `session.jsonl.zstd`. Required because the log is **concatenated zstd frames** — a single-frame decode returns only the session header and looks like an empty log. |
| `probes/` | The endpoint experiments behind every measured claim. Each reads `LITELLM_MASTER_KEY` from the environment, prints observations only, and writes nothing to the endpoint's state. |
| `harness-tests/` | The UAT instruments (below). |

`harness-tests/` measures and checks a UAT sitting. Nothing in it contacts the endpoint except the
metric sampler, which only scrapes counters.

| File | Use |
|---|---|
| `harness-tests/metrics.mts` | Folds a decoded session log into per-step tokens, model/tool wall time, tool names, turn outcomes, error codes, approvals and compactions. Timing definitions are `sessionStats`' own (`packages/session/session-stats/src/projection.ts`), and packed chunk rows expand through the product's `decodeStorageRecord`, so both storage layouts fold identically. `--all` folds every session under `$DSH_HOME` and reports an undecodable one instead of omitting it. |
| `harness-tests/check.sh` | PASS/FAIL for one UAT case's **log-level** criteria: `check.sh <B1.4\|B3.1\|B3.2\|B4.1> [log.zstd]`, newest session by default. Those four are the cases a screen cannot distinguish — a declined write leaves the same screen as a fenced one, and `/compact` reports success having replaced nothing. Exit status is the verdict. |
| `harness-tests/check-case.mts` | The criteria `check.sh` asserts, one function per case. |
| `harness-tests/sample-engine-metrics.sh` | Samples the vLLM counters every 10 s into a timestamped JSONL series, for aligning engine behaviour to session times afterwards. Counters are cumulative: a per-scenario figure is the delta between bracketing rows. |
| `harness-tests/patches/web-typert.yml` | Re-enables the three `typert` rows purge ledger A1 disables. **Required for `--profile web`**: `dsh-client-runtime` injects `typert` and provides `remote` and `slots`, so without it all 37 client UI rows stall in `pending` and the browser shows *"Failed to load plugins"* while the server still answers HTTP 200. |

**The probes print to stdout and persist nothing.** Four published reuse figures were purged for
exactly that reason (`TUNING.md` §6 row 18). Redirect to a file and cite the file, or do not quote the
number.

| Probe | Establishes |
|---|---|
| `probes/probe.py` | Tool calling and the top-level `reasoning_effort` path, including the HTTP 400 on `high` |
| `probes/probe2.py` | `chat_template_kwargs` combinations, streaming with parallel tool calls, the multi-step round trip |
| `probes/probe3.py` | Stream tail ordering — usage arrives after `finish_reason` |
| `probes/probe4.py` | Empty-output trap, cancellation, oversized `max_tokens` |
| `probes/probe5.py` | True context overflow and its error classification |
| `probes/probe_reasoning.py` | Which field carries reasoning on each surface — the root cause behind the `/engine/v1` requirement |
| `probes/probe_input.py` | Which assistant field the chat template accepts, via `/engine/tokenize` |
| `probes/probe_engine.py` | That `/engine/v1` carries the full dsh request shape |
| `probes/probe_toolrate.py` | Tool-call reliability per surface |
| `probes/tokenize.py` | Exact token cost of each prompt contributor |
| `probes/probe_prefix_cache.py` | That align-mode prefix caching produces real hits here, and that `cached_tokens` is unavailable in vLLM itself rather than stripped by the gateway |
| `probes/probe_prefix_geometry.py` | Which prompt geometries benefit — append-only agent chains vs a shared prefix with long unique suffixes |
| `probes/probe_prefix_correctness.py` | That a GDN state resume preserves the cached region's content, tested by needle recall rather than by token diff — GDN backends are not batch-invariant, so a token diff is the wrong test |
| `probes/probe_prefix_saturation.py` | Co-residency of near-full-context sequences. **Has no seed**, so a repeat invocation replays byte-identical prompts and measures a warm run |
| `probes/probe_head_composition.py` | Which messages make up the per-session prompt constant, and where the reusable prefix ends. Takes a `recproxy.py` log; persists to `results/` |
| `probes/probe_image.py` | **That the model sees images**, on both surfaces and in thinking mode, with a no-image control and the prompt-token cost per image size. Answers what harness config cannot: dsh refuses image reads locally before any request is made |

`results/` holds the persisted artifacts. `head-composition-20260821.json` and
`e2-gate-wire-20260821.jsonl` are the measured prompt composition and the recorded wire bodies for the
E2 gate run that produced it. **Both were recorded on `0.1.1-rc.1`**, and rc.2 grew the `read_image`
schema, so the 7,455-token prefix they establish is now an underestimate by roughly 64 tokens — see
NEXT-SESSION.md. `uat-20260821/`, `uat-20260823/` and `uat-20260824/` hold the three UAT sittings' analyses and folded
session metrics; `engine-metrics-*.jsonl` are the engine counter series, cumulative, one per sitting.
`image-capability-20260824.txt` is the evidence that the model accepts and understands images, which
retracted a purge recommendation built on our own config instead of on the endpoint.

## Reproducing

```sh
set -a && . ./.env && set +a

# the deployment regression gate (E2). Verify from the DECODED log, never stdout.
# Criteria and results: NEXT-SESSION.md, section E2.
pnpm dsh --profile headless "Read artifacts/README.md and report its first heading. \
  Then try to read artifacts/does-not-exist.md and report exactly what happened. \
  Then write the single line OK to the absolute path /home/andrea/dsh-gate-approval.txt and report \
  exactly what happened, including any error text verbatim. Do not retry with a different path and \
  do not attempt any sandbox escalation. \
  Finally run 'git rev-parse --short HEAD' and report the commit."

# see the wire, including which route each call took
UPSTREAM=http://100.108.76.12:4000 RECLOG=/tmp/rec.jsonl RECPORT=4100 \
  python3 artifacts/recproxy.py &
#   then point both baseURLs at http://127.0.0.1:4100/engine/v1 for the run

# decode the durable log — concatenated zstd frames, not one frame
node --import tsx/esm artifacts/read-session-log.mts \
  "$(ls -t ~/.dsh/sessions/*/session-*/session.jsonl.zstd | head -1)" /tmp/s.jsonl
```

The gate's write step **must** target a path outside the workspace *and* outside `/tmp` and
`os.tmpdir()`: `workspace-write` grants all three, so a `/tmp` target asserts nothing about approval.
`/tmp` is also unusable as a handoff between the fs tools and bash on Linux (D6 in `NEXT-SESSION.md`) —
stage such files inside the workspace.

A source-plane run needs the Typert rows disabled (they are, in the patch above) or a completed
`pnpm run build`; `typert-loader` resolves built `lib/typert.host.js` artifacts and boot fails without
them.
