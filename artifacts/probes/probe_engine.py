#!/usr/bin/env python3
"""Can /engine/v1 carry the exact request shape dsh emits, and does the
reasoning round-trip close on it?"""
import json, os, urllib.request, urllib.error
KEY = os.environ["LITELLM_MASTER_KEY"]

def call(base, body, stream=False):
    req = urllib.request.Request(base + "/chat/completions", data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}, method="POST")
    try: r = urllib.request.urlopen(req, timeout=600)
    except urllib.error.HTTPError as e: return {"err": e.code, "body": e.read().decode()[:400]}
    if not stream: return {"json": json.loads(r.read().decode())}
    ev = []
    for raw in r:
        l = raw.decode().strip()
        if l.startswith("data:") and l[5:].strip() != "[DONE]": ev.append(json.loads(l[5:].strip()))
    return {"events": ev}

TOOLS = [{"type": "function", "function": {"name": "read", "description": "Read a file.",
    "parameters": {"type": "object", "properties": {"file_path": {"type": "string"}}, "required": ["file_path"]}}}]

# exactly the body shape captured from dsh on the wire
BODY = {
    "model": "chat-model",
    "messages": [{"role": "system", "content": "You are a coding agent."},
                 {"role": "user", "content": "Read /etc/hostname using the tool."}],
    "tools": TOOLS, "max_tokens": 2048, "stream": True,
    "stream_options": {"include_usage": True},
    "chat_template_kwargs": {"enable_thinking": True, "reasoning_effort": "medium",
                             "preserve_thinking": False},
}

for base, label in (("http://100.108.76.12:4000/v1", "managed /v1"),
                    ("http://100.108.76.12:4000/engine/v1", "raw /engine/v1")):
    r = call(base, BODY, stream=True)
    print(f"\n=== {label} ===")
    if "err" in r:
        print(f"  HTTP {r['err']}: {r['body'][:300]}"); continue
    rf, tools_seen, usage, finish = set(), {}, None, None
    for e in r["events"]:
        if e.get("usage"): usage = e["usage"]
        for c in (e.get("choices") or []):
            d = c.get("delta") or {}
            for k in ("reasoning_content", "reasoning", "reasoning_text"):
                if d.get(k): rf.add(k)
            for tc in (d.get("tool_calls") or []):
                s = tools_seen.setdefault(tc.get("index", 0), {"n": "", "a": "", "id": None})
                if tc.get("id"): s["id"] = tc["id"]
                fn = tc.get("function") or {}
                s["n"] += fn.get("name") or ""; s["a"] += fn.get("arguments") or ""
            if c.get("finish_reason"): finish = c["finish_reason"]
    print(f"  reasoning delta field(s): {sorted(rf) or 'NONE'}")
    print(f"  finish_reason           : {finish}")
    print(f"  usage in stream         : {json.dumps(usage)}")
    for i, s in sorted(tools_seen.items()):
        ok = True
        try: json.loads(s["a"])
        except Exception as ex: ok = f"INVALID ({ex})"
        print(f"  tool[{i}] id={s['id']} name={s['n']!r} args={s['a'][:70]!r} json_valid={ok}")
    print(f"  => pi-ai would echo thinking back as: {sorted(rf)[0] if rf else 'n/a'}"
          f"  -> {'ACCEPTED by vLLM input' if 'reasoning' in rf else 'IGNORED by vLLM input'}")
