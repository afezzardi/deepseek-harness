#!/usr/bin/env python3
"""Which prompt geometries actually benefit from align-mode caching here?

Align mode keeps a per-request checkpoint of each GDN layer's recurrent state at
the last completed prompt-block boundary. Whether a later request can resume
from it depends on where that boundary sits relative to the shared prefix, so
geometry -- not just prefix length -- decides the payoff.

  APPEND  each request = previous prompt + a new chunk (an agent tool loop).
          The previous request's boundary always lies inside the next request's
          shared prefix. Measured 0%, 76.8%, 80.8%, 83.7%, 85.9% across a chain
          growing 31k -> 62k tokens; each step's hit count equals exactly the
          previous request's full-block count x 1568.

  BRANCH  a fixed shared prefix plus a long request-UNIQUE suffix. Measured 0%,
          43.1%, 54.6%, 54.6% at 54,569 tokens.

vLLM issue #45238 predicts BRANCH collapses to exactly 0%, because a mamba miss
vetoes matched attention blocks. That is NOT this build: 0.27.1's MambaManager
sets supports_fine_grained_hash_lookup and tracks _producer_partial_tail_reqs /
last_state_block_idx, so boundaries accumulate across requests and partial reuse
survives. (VLLM_PREFIX_CACHE_RETENTION_INTERVAL is NOT the mechanism -- envs.py
says it applies to sliding-window attention, not Mamba/linear attention.)
"""
import json, os, subprocess, sys, time, urllib.request

GW = "http://100.108.76.12:4000/engine/v1/chat/completions"
KEY = os.environ["LITELLM_MASTER_KEY"]
BLOCK = 1568
MET = ("docker exec kb-vllm-chat-fp8 curl -s http://127.0.0.1:8000/metrics "
       "| grep -E '^vllm:(prefix_cache_queries_total|prefix_cache_hits_total|"
       "num_preemptions_total)'")


def metrics():
    out = subprocess.run(["ssh", "afezzardi@100.108.76.12", MET],
                         capture_output=True, text=True).stdout
    return {l.split("{", 1)[0]: float(l.rsplit(" ", 1)[1])
            for l in out.splitlines() if "{" in l and " " in l}


def words(n, salt=""):
    return " ".join(f"{salt}w{i % 991}" for i in range(n))


def call(content):
    body = json.dumps({
        "model": "chat-model",
        "messages": [{"role": "user", "content": content}],
        "max_tokens": 4, "temperature": 0,
        "chat_template_kwargs": {"enable_thinking": False},
    }).encode()
    req = urllib.request.Request(GW, data=body, headers={
        "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    t0 = time.monotonic()
    with urllib.request.urlopen(req, timeout=900) as r:
        d = json.load(r)
    return time.monotonic() - t0, d["usage"]["prompt_tokens"]


def run(name, prompts):
    print(f"\n=== {name} ===")
    prev = metrics()
    for i, p in enumerate(prompts, 1):
        dt, ptok = call(p)
        cur = metrics()
        q = cur["vllm:prefix_cache_queries_total"] - prev["vllm:prefix_cache_queries_total"]
        h = cur["vllm:prefix_cache_hits_total"] - prev["vllm:prefix_cache_hits_total"]
        pre = cur["vllm:num_preemptions_total"] - prev["vllm:num_preemptions_total"]
        print(f"  req{i}: prompt={ptok:6d}tok ({ptok // BLOCK:2d} full blocks) "
              f"{dt:6.2f}s queries={q:6.0f} hits={h:6.0f} "
              f"rate={100 * h / q if q else 0:5.1f}% preempt+{pre:.0f}")
        prev = cur


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "both"
    if which in ("append", "both"):
        cur, chain = words(8000, "a"), []
        for _ in range(5):
            chain.append(cur + "\n\nReply ACK.")
            cur = cur + "\n\n" + words(2000, "a")
        run("APPEND (agent tool-loop shape)", chain)
    if which in ("branch", "both"):
        shared = words(8000, "s")
        run("BRANCH (shared prefix + long unique suffix)",
            [shared + "\n\n" + words(4000, f"u{k}") + "\n\nReply ACK."
             for k in range(4)])


if __name__ == "__main__":
    main()
