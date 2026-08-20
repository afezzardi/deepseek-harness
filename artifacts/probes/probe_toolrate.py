#!/usr/bin/env python3
"""Tool-call reliability per surface, same body, sequential (concurrency cap 5)."""
import json, os, urllib.request, urllib.error
KEY = os.environ["LITELLM_MASTER_KEY"]
TOOLS = [{"type": "function", "function": {"name": "read", "description": "Read a file.",
    "parameters": {"type": "object", "properties": {"file_path": {"type": "string"}}, "required": ["file_path"]}}}]
BODY = {"model": "chat-model",
        "messages": [{"role": "system", "content": "You are a coding agent."},
                     {"role": "user", "content": "Read /etc/hostname using the tool."}],
        "tools": TOOLS, "max_tokens": 2048,
        "chat_template_kwargs": {"enable_thinking": True, "reasoning_effort": "medium",
                                 "preserve_thinking": False}}
N = 6
for base, label in (("http://100.108.76.12:4000/v1", "managed /v1"),
                    ("http://100.108.76.12:4000/engine/v1", "raw /engine/v1")):
    out = []
    for _ in range(N):
        req = urllib.request.Request(base + "/chat/completions", data=json.dumps(BODY).encode(),
            headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}, method="POST")
        try:
            j = json.loads(urllib.request.urlopen(req, timeout=600).read().decode())
            ch = j["choices"][0]
            out.append("tool" if ch["message"].get("tool_calls") else f"TEXT({ch['finish_reason']})")
        except urllib.error.HTTPError as e:
            out.append(f"HTTP{e.code}")
    n = sum(1 for o in out if o == "tool")
    print(f"{label:<18} tool_calls {n}/{N}   {out}")
