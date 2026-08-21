#!/usr/bin/env python3
"""How many near-full-context sequences does this shape ACTUALLY hold at once,
and does it preempt getting there?

The boot line `Maximum concurrency for 131,072 tokens per request: N.NNx` is a
nominal KV-capacity figure. It is not evidence that N sequences co-reside: a test
with short outputs finishes each request before the next has prefilled, so the
sequences never overlap. That test reads kv_cache_usage_perc near ONE request's
occupancy and reports zero preemptions while proving nothing.

This probe forces every request to generate thousands of tokens (min_tokens +
ignore_eos), so early requests are still decoding while the last one prefills.
Sampling runs inside the container so running/waiting/usage come from one scrape.

Measured 2026-08-20, chat-fp8 with --enable-prefix-caching (boot line 5.27x,
CHAT_MAX_NUM_SEQS=5), 5 x (117,708-token prompt + 8,000 forced output):
  kv_cache_usage_perc peaked 0.989, max num_requests_running 4 (never 5),
  one preemption, one request starved 684s vs ~487s for the rest. All five
  completed correctly.

So effective concurrency at ~125k tokens per sequence is 4, not 5. Preemption
here is a latency event, not a correctness one -- and with prefix caching a
preempted sequence resumes from its last cached block boundary rather than from
token 0.

num_preemptions_total is cumulative since engine start; read the delta.
"""
import json, os, subprocess, sys, threading, time, urllib.request

GW = "http://100.108.76.12:4000/engine/v1/chat/completions"
KEY = os.environ["LITELLM_MASTER_KEY"]
HOST = "afezzardi@100.108.76.12"

SAMPLER = r"""
rm -f /tmp/sat_metrics.log
for i in $(seq 1 %d); do
  docker exec kb-vllm-chat-fp8 curl -s http://127.0.0.1:8000/metrics \
    | grep -E '^vllm:(num_requests_running|num_requests_waiting|kv_cache_usage_perc|num_preemptions_total)' \
    | grep -v by_reason \
    | awk -v t="$(date +%%s.%%N)" '{split($0,a,"{"); printf "%%s %%s %%s\n", t, a[1], $NF}' >> /tmp/sat_metrics.log
  sleep 0.5
done
"""

results, lock = [], threading.Lock()


def worker(k, n_words, out_tokens):
    prompt = " ".join(f"s{k}q{i % 983}" for i in range(n_words))
    body = json.dumps({
        "model": "chat-model",
        "messages": [{"role": "user", "content": prompt + "\n\nWrite a long report."}],
        "max_tokens": out_tokens,
        "min_tokens": out_tokens,   # vLLM extra: forbid early stop
        "ignore_eos": True,         # vLLM extra: run to max_tokens
        "temperature": 0,
        "chat_template_kwargs": {"enable_thinking": False},
    }).encode()
    req = urllib.request.Request(GW, data=body, headers={
        "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=3600) as r:
            d = json.load(r)
        with lock:
            results.append((k, time.monotonic() - t0, d["usage"]["prompt_tokens"],
                            d["usage"]["completion_tokens"],
                            d["choices"][0].get("finish_reason")))
    except Exception as e:  # noqa: BLE001 - surfaced in the report
        with lock:
            results.append((k, time.monotonic() - t0, -1, -1,
                            f"ERROR {type(e).__name__}: {str(e)[:120]}"))


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    n_words = int(sys.argv[2]) if len(sys.argv) > 2 else 20000
    out_tokens = int(sys.argv[3]) if len(sys.argv) > 3 else 8000
    samples = int(sys.argv[4]) if len(sys.argv) > 4 else 1400

    print(f"{n} concurrent, ~{n_words} words (~{n_words * 5.885:,.0f} tok) prompt, "
          f"{out_tokens} forced output tokens each")
    samp = subprocess.Popen(["ssh", HOST, SAMPLER % samples],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2)
    t0 = time.monotonic()
    threads = [threading.Thread(target=worker, args=(k, n_words, out_tokens))
               for k in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    wall = time.monotonic() - t0
    time.sleep(2)
    samp.terminate()

    print(f"\nwall={wall:.1f}s")
    for r in sorted(results):
        print(f"  worker{r[0]}: {r[1]:7.1f}s prompt={r[2]:7d} completion={r[3]:6d} "
              f"finish={r[4]}")

    raw = subprocess.run(["ssh", HOST, "cat /tmp/sat_metrics.log"],
                         capture_output=True, text=True).stdout
    by_t = {}
    for line in raw.splitlines():
        p = line.split()
        if len(p) == 3:
            by_t.setdefault(p[0], {})[p[1]] = float(p[2])

    run_key, use_key = "vllm:num_requests_running", "vllm:kv_cache_usage_perc"
    pre_key = "vllm:num_preemptions_total"
    peak = max(by_t.values(), key=lambda m: (m.get(run_key, 0), m.get(use_key, 0)),
               default={})
    pres = [m.get(pre_key, 0) for m in by_t.values()]
    print(f"\nsamples: {len(by_t)}")
    print("peak single scrape (one instant, not independent maxima):")
    print(f"  running={peak.get(run_key, 0):.0f} "
          f"waiting={peak.get('vllm:num_requests_waiting', 0):.0f} "
          f"kv_usage={peak.get(use_key, 0):.3f}")
    print(f"  max kv_cache_usage_perc = {max((m.get(use_key, 0) for m in by_t.values()), default=0):.3f}")
    print(f"  max num_requests_running = {max((m.get(run_key, 0) for m in by_t.values()), default=0):.0f}")
    print(f"  preemptions_total {min(pres, default=0):.0f} -> {max(pres, default=0):.0f} "
          f"(delta {max(pres, default=0) - min(pres, default=0):.0f})")


if __name__ == "__main__":
    main()
