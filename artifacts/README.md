# artifacts/

Assessment, bring-up, and remediation of Qwen3.8-27B on DeepSeek Harness, against the self-hosted
inference stack on `srvhapeda`.

Nothing here is upstream material. It is this fork's evaluation record plus the deployment
configuration that came out of it.

## Decision documents

Read top to bottom. Each layer supersedes named parts of the ones below it, and every document
carries a status header saying which parts.

| File | What it is |
|---|---|
| `NEXT-SESSION.md` | **Start here.** The ranked experiment queue with exact commands, boot gates, and pass/fail criteria. Operationalises the foundation assessment's Phases 2 and 3. |
| `qwen38-harness-remediation.html` | **Current.** Ranked remediation path: two defects fixed and wire-proven, three corrections to the bring-up report, one new concurrency defect, and the prefix-caching experiment that outranks the rest. |
| `qwen38-harness-bringup.html` | Wire-level verification: 11 endpoint gates, 6 route corrections, the reasoning-field root cause. Authoritative except for §Next, C6, and its prefix-caching claim. |
| `deepseek-harness-consolidated-assessment.md` | **Purge ledgers A and B** — the only home for the row groups, their measured package/dependency/LOC effect, and the ordering constraints. §9's route and ledger A4's titling row are superseded. |
| `deepseek-harness-plugins-overview.md` | **The 138-row composition inventory** — id, package, intent, layer. This is how a ledger row group resolves to actual ids. No equivalent elsewhere. |
| `deepseek-harness-foundation-assessment.md` | **The four-phase evaluation plan with go/no-go criteria**, plus the adapter-justification criteria. Phases 2 and 3 are the test plan nobody has run yet. |
| `how-to.md` | Consumer guide to the inference stack. Canonical home is `kb-mastra-infra/HOW-TO.md` on the host; this copy is for offline reference and carries one correction. |

Retired: `deepseek-harness-assets-adversarial-review.md`. All fourteen of its findings were accepted
and folded into the consolidated assessment's corrections; its one unique holding — field-by-field
schema validation of a candidate route — describes a route since corrected on the wire six times.

## Working configuration

Copies of the live files under `$DSH_HOME` (`~/.dsh`), which sits outside this checkout. These are
the durable record, and they are synced to the live files as of the remediation report.

| File | Deploys to | Carries |
|---|---|---|
| `dsh-settings.yaml` | `~/.dsh/settings.yaml` | the `local-qwen` thinking route and the `local-qwen-off` non-thinking route |
| `dsh-cordis.patch.yml` | `~/.dsh/cordis.patch.yml` | Typert rows off, compaction threshold 0.7, both capped auxiliary calls routed off-thinking |

Credentials are referenced, never stored: `apiKeyEnv: LITELLM_MASTER_KEY` resolves per request. Put
the value in `./.env` at the repo root (gitignored) or the process environment.

## Instruments

| File | Use |
|---|---|
| `recproxy.py` | Recording reverse proxy. Logs each request body to JSONL and forwards upstream; streams SSE through with chunked framing. The only way to see sampling and `chat_template_kwargs`, since the session log records model-visible content only and the gateway runs `set_verbose: false`. |
| `read-session-log.mts` | Decodes `session.jsonl.zstd`. Required because the log is **concatenated zstd frames** — a single-frame decode returns only the session header and looks like an empty log. |
| `probes/` | The endpoint experiments behind every measured claim. Each reads `LITELLM_MASTER_KEY` from the environment, prints observations only, and writes nothing to the endpoint's state. |

| Probe | Establishes |
|---|---|
| `probes/probe.py` | Tool calling and the top-level `reasoning_effort` path, including the HTTP 400 on `high` |
| `probes/probe2.py` | `chat_template_kwargs` combinations, streaming with parallel tool calls, the multi-step round trip |
| `probes/probe3.py` | Stream tail ordering — usage arrives after `finish_reason` |
| `probes/probe4.py` | Empty-output trap, cancellation, oversized `max_tokens` |
| `probes/probe5.py` | True context overflow and its error classification |
| `probes/probe_reasoning.py` | Which field carries reasoning on each surface — the root cause |
| `probes/probe_input.py` | Which assistant field the chat template accepts, via `/engine/tokenize` |
| `probes/probe_engine.py` | That `/engine/v1` carries the full dsh request shape |
| `probes/probe_toolrate.py` | Tool-call reliability per surface |
| `probes/tokenize.py` | Exact token cost of each prompt contributor |

## Reproducing

```sh
set -a && . ./.env && set +a

# the verified two-step task
pnpm dsh --profile headless "Read package.json and report the exact version field. \
  Then run 'git rev-parse --short HEAD' and report the commit. \
  Finally state how many entries the scripts object has."

# see the wire, including which route each call took
UPSTREAM=http://100.108.76.12:4000 RECLOG=/tmp/rec.jsonl RECPORT=4100 \
  python3 artifacts/recproxy.py &
#   then point both baseURLs at http://127.0.0.1:4100/engine/v1 for the run

# decode the durable log — concatenated zstd frames, not one frame
node --import tsx/esm artifacts/read-session-log.mts \
  "$(ls -t ~/.dsh/sessions/*/session-*/session.jsonl.zstd | head -1)" /tmp/s.jsonl
```

Expected from the two-step task: version `0.1.0-rc.8`, commit `141eb6fef8`, 128 scripts — in two
steps, the first returning `[reasoning, tool-call, tool-call]`.

A source-plane run needs the Typert rows disabled (they are, in the patch above) or a completed
`pnpm run build`; `typert-loader` resolves built `lib/typert.host.js` artifacts and boot fails
without them.
