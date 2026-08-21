#!/usr/bin/env python3
"""Does resuming a GDN layer from a cached checkpoint preserve what the cached
region contained?

align mode is experimental upstream, and GDN backends are not batch-invariant,
so cached and fresh generations are NOT bit-exact -- a token diff would report
failure on benign nondeterminism. The failure that matters is a bad state
resume, and its signature is information loss: the model still answers fluently
but can no longer recall a fact that lives inside the reused prefix.

Arms per trial, all against the same prefix:
  COLD-A    unique-salted prefix, no reuse possible -> ground truth
  WARM-A    identical prompt repeated -> maximum reuse, same question
  DIVERGE-B same prefix, DIFFERENT question -> resumes from the cached state and
            then feeds it new tokens; the arm that actually exercises the resume
  WARM-B    repeat of DIVERGE-B
  REPEAT-A  back to A after B, to catch a boundary clobbered by the B branch

Measured 2026-08-20 at 47,076 tokens, 3 trials: COLD 9.6s at 0% reuse, every
other arm 0.31s at 99.9% reuse, and 15/15 needle recalls exact. Tool-call
arguments were byte-identical across three repeats.

This does NOT cover long generations, many-turn chains, concurrent batching, or
eviction churn -- see probe_prefix_saturation.py for pressure, and treat a long
multi-turn corruption test as still open.
"""
import json, os, re, subprocess, sys, time, urllib.request

GW = "http://100.108.76.12:4000/engine/v1/chat/completions"
KEY = os.environ["LITELLM_MASTER_KEY"]
MET = ("docker exec kb-vllm-chat-fp8 curl -s http://127.0.0.1:8000/metrics "
       "| grep -E '^vllm:prefix_cache_(queries|hits)_total'")

A = ("The access code for vault 7 is MAGENTA-4417.", "MAGENTA-4417",
     "What is the access code for vault 7? Answer with the code only.")
B = ("The passphrase for locker 12 is TANGERINE-8830.", "TANGERINE-8830",
     "What is the passphrase for locker 12? Answer with the passphrase only.")


def metrics():
    out = subprocess.run(["ssh", "afezzardi@100.108.76.12", MET],
                         capture_output=True, text=True).stdout
    q = h = 0.0
    for l in out.splitlines():
        if "queries_total" in l:
            q = float(l.rsplit(" ", 1)[1])
        elif "hits_total" in l:
            h = float(l.rsplit(" ", 1)[1])
    return q, h


def prefix(salt, n_words=8000):
    """Filler carrying needle A at ~12% depth and needle B at ~62%."""
    w = [f"{salt}f{i % 971}" for i in range(n_words)]
    w.insert(int(n_words * 0.12), "\n" + A[0] + "\n")
    w.insert(int(n_words * 0.62), "\n" + B[0] + "\n")
    return " ".join(w)


def ask(content, tools=None, max_tokens=40):
    body = {"model": "chat-model",
            "messages": [{"role": "user", "content": content}],
            "max_tokens": max_tokens, "temperature": 0,
            "chat_template_kwargs": {"enable_thinking": False}}
    if tools:
        body |= {"tools": tools, "tool_choice": "auto"}
    req = urllib.request.Request(GW, data=json.dumps(body).encode(), headers={
        "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    t0 = time.monotonic()
    with urllib.request.urlopen(req, timeout=900) as r:
        d = json.load(r)
    return d, d["usage"]["prompt_tokens"], time.monotonic() - t0


def step(label, content, expect):
    q0, h0 = metrics()
    d, ptok, dt = ask(content)
    q1, h1 = metrics()
    q, h = q1 - q0, h1 - h0
    text = d["choices"][0]["message"].get("content") or ""
    ok = expect.lower() in text.lower()
    print(f"  {label:<9} {dt:6.2f}s ptok={ptok:6d} reuse={100 * h / q if q else 0:5.1f}% "
          f"{'OK ' if ok else 'BAD'} want={expect} "
          f"got={re.sub(r'\s+', ' ', text).strip()[:50]!r}")
    return ok


def tool_check(n=3):
    tools = [{"type": "function", "function": {
        "name": "get_weather", "description": "Get the weather for a city",
        "parameters": {"type": "object", "properties": {
            "city": {"type": "string"},
            "unit": {"type": "string", "enum": ["c", "f"]}},
            "required": ["city", "unit"]}}}]
    filler = " ".join(f"tf{i % 967}" for i in range(9000))
    seen, allok = [], True
    for i in range(n):
        d, _, _ = ask(filler + "\n\nIgnore the noise above. Use the tool to get "
                      "the weather in Bologna in celsius.", tools, 128)
        tc = d["choices"][0]["message"].get("tool_calls") or []
        if not tc:
            print(f"  tool run{i + 1}: NO TOOL CALL")
            allok = False
            continue
        fn = tc[0]["function"]
        try:
            args = json.loads(fn["arguments"])
        except json.JSONDecodeError as e:
            print(f"  tool run{i + 1}: UNPARSEABLE {fn['arguments']!r} ({e})")
            allok = False
            continue
        good = (fn["name"] == "get_weather" and args.get("unit") == "c"
                and "bologna" in str(args.get("city", "")).lower())
        allok &= good
        print(f"  tool run{i + 1}: {'OK ' if good else 'BAD'} {fn['name']}({args})")
        seen.append(json.dumps(args, sort_keys=True))
    consistent = len(set(seen)) <= 1
    print(f"  arguments identical across {n} runs: {consistent}")
    return allok and consistent


def main():
    trials = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    allok = True
    for t in range(trials):
        p = prefix(f"t{t}")
        a, b = f"{p}\n\n{A[2]}", f"{p}\n\n{B[2]}"
        print(f"\n--- trial {t} ---")
        allok &= step("COLD-A", a, A[1])
        allok &= step("WARM-A", a, A[1])
        allok &= step("DIVERGE-B", b, B[1])
        allok &= step("WARM-B", b, B[1])
        allok &= step("REPEAT-A", a, A[1])
    print("\n--- tool-call argument integrity ---")
    allok &= tool_check()
    print(f"\nCORRECTNESS: {'PASS' if allok else 'FAIL'}")


if __name__ == "__main__":
    main()
