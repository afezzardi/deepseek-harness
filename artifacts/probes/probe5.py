#!/usr/bin/env python3
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe import post

print("=== OVERFLOW, escalating until the window is actually exceeded ===")
for words in (60000, 140000, 300000):
    body = {"model": "chat-model-off",
            "messages": [{"role": "user", "content": "lorem ipsum dolor " * words}],
            "max_tokens": 16}
    r = post("/chat/completions", body)
    if "_json" in r:
        u = r["_json"]["usage"]
        print(f"  words={words:>6}: HTTP 200 prompt_tokens={u['prompt_tokens']} "
              f"finish={r['_json']['choices'][0]['finish_reason']!r}")
    else:
        msg = r.get("_body", "")
        print(f"  words={words:>6}: HTTP {r['_http']}")
        print(f"      {msg[:400]}")
