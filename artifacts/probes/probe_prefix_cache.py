#!/usr/bin/env python3
"""Does align-mode prefix caching actually produce hits on this checkpoint, and
is the reuse visible to a client?

Measured 2026-08-20, chat-fp8 with --enable-prefix-caching:
  identical 38,102-token prompt twice -> 7.32s then 0.28s, 37,632/38,102 hits
  (98.8%). The 470-token shortfall is 38,102 mod 1568 -- the trailing partial
  block, which is never cacheable.

  prompt_tokens_details stays null, so cached_tokens is NOT client-visible. That
  is vLLM, not the gateway: a direct authenticated call to the engine's own
  /v1/chat/completions returns null too. Read the engine metrics instead.

Run with the flag OFF to see the contrast: prefix_cache_queries_total does not
even increment, and the second call is as slow as the first.
"""
import json, os, subprocess, sys, time, urllib.request

GW = "http://100.108.76.12:4000/engine/v1/chat/completions"
KEY = os.environ["LITELLM_MASTER_KEY"]
MET = ("docker exec kb-vllm-chat-fp8 curl -s http://127.0.0.1:8000/metrics "
       "| grep -E '^vllm:(prefix_cache_queries_total|prefix_cache_hits_total|"
       "num_preemptions_total)'")


def metrics():
    out = subprocess.run(["ssh", "afezzardi@100.108.76.12", MET],
                         capture_output=True, text=True).stdout
    return {l.split("{", 1)[0]: float(l.rsplit(" ", 1)[1])
            for l in out.splitlines() if "{" in l and " " in l}


def call(prompt, tag):
    body = json.dumps({
        "model": "chat-model",
        "messages": [{"role": "user", "content": prompt + "\n\nReply with exactly: ACK"}],
        "max_tokens": 8, "temperature": 0,
        "chat_template_kwargs": {"enable_thinking": False},
    }).encode()
    req = urllib.request.Request(GW, data=body, headers={
        "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    t0 = time.monotonic()
    with urllib.request.urlopen(req, timeout=900) as r:
        d = json.load(r)
    dt = time.monotonic() - t0
    u = d["usage"]
    print(f"  [{tag}] {dt:6.2f}s prompt_tokens={u['prompt_tokens']} "
          f"finish={d['choices'][0]['finish_reason']}")
    print(f"        prompt_tokens_details={u.get('prompt_tokens_details')!r}")
    return dt


def main():
    n_blocks = int(sys.argv[1]) if len(sys.argv) > 1 else 6
    # >= n_blocks * 1568 tokens; a shared prefix under one block can never hit
    prompt = " ".join(f"item{i % 977}" for i in range(n_blocks * 1568 + 400))
    m0 = metrics()
    d1 = call(prompt, "cold")
    m1 = metrics()
    d2 = call(prompt, "identical")
    m2 = metrics()
    q = m2["vllm:prefix_cache_queries_total"] - m1["vllm:prefix_cache_queries_total"]
    h = m2["vllm:prefix_cache_hits_total"] - m1["vllm:prefix_cache_hits_total"]
    print(f"\ncall-2 reuse: queries={q:.0f} hits={h:.0f} "
          f"rate={100 * h / q if q else 0:.1f}%")
    print(f"preemptions: {m0['vllm:num_preemptions_total']:.0f} -> "
          f"{m2['vllm:num_preemptions_total']:.0f}")
    print(f"latency {d1:.2f}s -> {d2:.2f}s ({d1 / d2 if d2 else 0:.1f}x)")


if __name__ == "__main__":
    main()
