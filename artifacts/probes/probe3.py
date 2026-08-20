#!/usr/bin/env python3
import json, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe import post, WEATHER

r = post("/chat/completions", {
    "model": "chat-model", "reasoning_effort": "low",
    "messages": [{"role": "user", "content": "Reply with exactly: OK"}],
    "max_tokens": 512, "stream": True, "stream_options": {"include_usage": True},
}, stream=True)
ev = r["_events"]
print(f"total events={len(ev)}")
print("--- last 4 events verbatim ---")
for e in ev[-4:]:
    print(json.dumps(e)[:600])
