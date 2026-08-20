#!/usr/bin/env python3
"""Exact token cost of each prompt contributor, via the raw vLLM /engine/tokenize route."""
import json, os, sys, urllib.request

KEY = os.environ["LITELLM_MASTER_KEY"]
BASE = "http://100.108.76.12:4000/engine"

def ntok(text):
    req = urllib.request.Request(
        BASE + "/tokenize",
        data=json.dumps({"model": "chat-model", "prompt": text}).encode(),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
        method="POST")
    return json.load(urllib.request.urlopen(req, timeout=120))["count"]

ev = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
rows = []

hdr = next(e for e in ev if e["type"] == "request/header")
rows.append(("system prompt", "system-prompt plugin", ntok(hdr["data"]["header"]["system"])))

for e in ev:
    if e["type"] != "user/message":
        continue
    m = e["data"].get("message", e["data"])
    src = m.get("source") or {}
    kind = src.get("kind", "?")
    label = src.get("plugin") or src.get("form") or kind
    text = "".join(b.get("text", "") for b in m.get("content", []) if b.get("type") == "text")
    if not text:
        continue
    rows.append((kind, label, ntok(text)))

total = sum(r[2] for r in rows)
print(f"{'contributor':<24} {'source':<34} {'tokens':>8}   share")
print("-" * 82)
for kind, label, n in sorted(rows, key=lambda r: -r[2]):
    print(f"{kind:<24} {str(label)[:34]:<34} {n:>8}   {100*n/total:5.1f}%")
print("-" * 82)
print(f"{'measured total':<24} {'':<34} {total:>8}")
print(f"\n(session log reported inputTokens=13310 for step 1; the gap is chat-template")
print(" scaffolding, tool schemas, and role markers, which tokenize separately)")
