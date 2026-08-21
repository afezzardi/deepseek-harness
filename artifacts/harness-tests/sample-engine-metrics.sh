#!/usr/bin/env bash
# Sample the vLLM engine counters every 10 s into a JSONL time series.
#
# Start it before a UAT sitting, stop it with Ctrl-C afterwards. Every row is
# timestamped, so it aligns to session-log event times without any per-case
# discipline from the operator.
#
# The vLLM containers publish no ports -- only the gateway does -- so the scrape
# goes through `docker exec` on the gateway container, which reaches the engine on
# the compose network. Read-only: it touches no engine state.
#
# Counters are CUMULATIVE. A per-scenario figure is the delta between the rows
# bracketing it, never a single reading.
set -uo pipefail

HOST="${INFERENCE_HOST:-afezzardi@100.108.76.12}"
OUT="${1:-artifacts/results/engine-metrics-$(date +%Y%m%d-%H%M%S).jsonl}"
INTERVAL="${SAMPLE_INTERVAL:-10}"

mkdir -p "$(dirname "$OUT")"
echo "sampling every ${INTERVAL}s -> $OUT   (Ctrl-C to stop)"

# The remote reader prints one JSON object per invocation. Metric names are the
# ones this deployment actually exposes, verified against the running engine;
# an absent name is simply omitted rather than defaulted, so a missing field
# means "the engine stopped exporting it", never "it was zero".
read -r -d '' REMOTE <<'PY'
import json, re, time, urllib.request
WANT = (
    "prefix_cache_hits_total", "prefix_cache_queries_total",
    "num_requests_waiting", "num_requests_running", "num_preemptions_total",
    "kv_cache_usage_perc", "generation_tokens_total", "prompt_tokens_total",
)
try:
    body = urllib.request.urlopen("http://vllm-chat:8000/metrics", timeout=8).read().decode()
except Exception as exc:
    print(json.dumps({"t": int(time.time() * 1000), "error": str(exc)[:200]}))
else:
    row = {"t": int(time.time() * 1000)}
    for name in WANT:
        m = re.search(r"^vllm:%s\{[^}]*\}\s+([0-9.e+-]+)$" % name, body, re.M)
        if m:
            row[name] = float(m.group(1))
    print(json.dumps(row))
PY

trap 'echo; echo "stopped; $(wc -l < "$OUT") samples in $OUT"; exit 0' INT TERM

while true; do
  # Each sample is an independent ssh round trip: a dropped connection costs one
  # row, never the series.
  ssh -o BatchMode=yes -o ConnectTimeout=8 "$HOST" \
    "docker exec -i kb-litellm python3 -c \"\$(cat)\"" <<<"$REMOTE" >>"$OUT" 2>/dev/null \
    || echo "{\"t\": $(date +%s000), \"error\": \"scrape failed\"}" >>"$OUT"
  sleep "$INTERVAL"
done
