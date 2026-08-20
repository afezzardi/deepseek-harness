#!/usr/bin/env python3
"""Failure-mode rows: overflow, empty output, cancellation."""
import json, os, sys, time, urllib.request, urllib.error, socket
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe import post, BASE, KEY

print("=== OVERFLOW: prompt beyond the 131,072 window ===")
r = post("/chat/completions", {
    "model": "chat-model",
    "messages": [{"role": "user", "content": "x " * 90000}],  # ~180k tokens
    "max_tokens": 16,
})
print(f"  HTTP {r['_http']}")
print("  body:", (r.get("_body") or json.dumps(r.get("_json"))[:300])[:500])

print("\n=== OVERFLOW: max_tokens beyond the 32,768 output cap ===")
r = post("/chat/completions", {
    "model": "chat-model", "messages": [{"role": "user", "content": "hi"}],
    "max_tokens": 40000,
})
print(f"  HTTP {r['_http']}")
print("  body:", (r.get("_body") or json.dumps(r.get("_json"))[:200])[:400])

print("\n=== EMPTY OUTPUT: tiny max_tokens with thinking on (the content:null trap) ===")
for mt in (16, 64):
    r = post("/chat/completions", {
        "model": "chat-model", "reasoning_effort": "medium",
        "messages": [{"role": "user", "content": "Explain the CAP theorem."}],
        "max_tokens": mt,
    })
    if "_json" in r:
        ch = r["_json"]["choices"][0]
        m = ch["message"]
        print(f"  max_tokens={mt}: finish={ch['finish_reason']!r} content={m.get('content')!r} "
              f"reasoning_len={len(m.get('reasoning_content') or '')}")
    else:
        print(f"  max_tokens={mt}: HTTP {r['_http']} {r.get('_body','')[:200]}")

print("\n=== CANCELLATION: abort mid-stream, then check the engine still serves ===")
req = urllib.request.Request(
    BASE.rstrip("/") + "/chat/completions",
    data=json.dumps({"model": "chat-model", "reasoning_effort": "xhigh",
                     "messages": [{"role": "user", "content": "Write a 3000 word essay on distributed consensus."}],
                     "max_tokens": 8000, "stream": True}).encode(),
    headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}, method="POST")
t0 = time.time()
resp = urllib.request.urlopen(req, timeout=120)
got = 0
for raw in resp:
    got += len(raw)
    if got > 2000:
        break
resp.close()
print(f"  aborted after {got} bytes in {time.time()-t0:.1f}s")
t1 = time.time()
r = post("/chat/completions", {"model": "chat-model-off",
                               "messages": [{"role": "user", "content": "Reply with exactly: ALIVE"}],
                               "max_tokens": 32})
print(f"  follow-up after abort: HTTP {r['_http']} in {time.time()-t1:.1f}s "
      f"content={r.get('_json',{}).get('choices',[{}])[0].get('message',{}).get('content')!r}")
