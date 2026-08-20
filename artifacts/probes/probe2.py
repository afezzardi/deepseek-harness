#!/usr/bin/env python3
import json, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe import post, WEATHER, show_msg

def combo():
    print("=" * 70, "\nCOMBO: chat_template_kwargs + top-level reasoning_effort\n", "=" * 70)
    cases = [
        ("enable_thinking=False alone", {"chat_template_kwargs": {"enable_thinking": False}}),
        ("enable_thinking=True + effort=low", {"chat_template_kwargs": {"enable_thinking": True}, "reasoning_effort": "low"}),
        ("ctk.reasoning_effort=medium (no top-level)", {"chat_template_kwargs": {"reasoning_effort": "medium"}}),
        ("ctk{enable_thinking,preserve_thinking:False} + effort=medium",
         {"chat_template_kwargs": {"enable_thinking": True, "preserve_thinking": False}, "reasoning_effort": "medium"}),
        ("conflict: ctk.reasoning_effort=low + top-level xhigh",
         {"chat_template_kwargs": {"reasoning_effort": "low"}, "reasoning_effort": "xhigh"}),
    ]
    for tag, extra in cases:
        body = {"model": "chat-model",
                "messages": [{"role": "user", "content": "Reply with exactly: OK"}],
                "max_tokens": 1024, **extra}
        r = post("/chat/completions", body)
        if "_body" in r:
            print(f"\n{tag}\n  HTTP {r['_http']}  {r['_body'][:300]}")
        else:
            m = r["_json"]["choices"][0]["message"]
            rc = m.get("reasoning_content")
            print(f"\n{tag}\n  HTTP 200 content={repr(m.get('content'))[:60]} "
                  f"reasoning={'ABSENT' if rc is None else f'len={len(rc)}'} "
                  f"completion_tokens={r['_json']['usage']['completion_tokens']}")

def streaming():
    print("\n" + "=" * 70, "\nSTREAMING with tools\n", "=" * 70)
    r = post("/chat/completions", {
        "model": "chat-model", "reasoning_effort": "medium",
        "messages": [{"role": "user", "content": "What is the weather in Milan and in Rome? Use the tool for each."}],
        "tools": WEATHER, "tool_choice": "auto", "max_tokens": 2048,
        "stream": True, "stream_options": {"include_usage": True},
    }, stream=True)
    if "_events" not in r:
        print("  ERROR:", r.get("_body", "")[:500]); return
    ev = r["_events"]
    print(f"  HTTP {r['_http']}  events={len(ev)}  {r['_elapsed']:.1f}s")
    reasoning_deltas = content_deltas = 0
    tool_frag = {}
    order = []
    for e in ev:
        if e == "[DONE]":
            order.append("[DONE]"); continue
        if e.get("usage") and not e.get("choices"):
            order.append("usage-only-chunk"); continue
        if not e.get("choices"):
            continue
        c = e["choices"][0]
        d = c.get("delta") or {}
        if d.get("reasoning_content"): reasoning_deltas += 1
        if d.get("content"): content_deltas += 1
        for tc in (d.get("tool_calls") or []):
            i = tc.get("index", 0)
            slot = tool_frag.setdefault(i, {"name": "", "args": "", "id": None, "chunks": 0})
            slot["chunks"] += 1
            if tc.get("id"): slot["id"] = tc["id"]
            fn = tc.get("function") or {}
            if fn.get("name"): slot["name"] += fn["name"]
            if fn.get("arguments"): slot["args"] += fn["arguments"]
        if c.get("finish_reason"):
            order.append(f"finish_reason={c['finish_reason']}")
        if e.get("usage"):
            order.append("usage-with-choices")
    print(f"  reasoning_content deltas: {reasoning_deltas}")
    print(f"  content deltas          : {content_deltas}")
    print(f"  tail event order        : {order}")
    print(f"  tool calls assembled    : {len(tool_frag)}")
    for i, s in sorted(tool_frag.items()):
        ok = True
        try: json.loads(s["args"])
        except Exception as ex: ok = f"INVALID: {ex}"
        print(f"    [{i}] id={s['id']} name={s['name']!r} chunks={s['chunks']} args={s['args'][:120]!r} json_valid={ok}")

def multistep():
    print("\n" + "=" * 70, "\nMULTI-STEP: assistant tool_calls + tool result -> next turn\n", "=" * 70)
    first = post("/chat/completions", {
        "model": "chat-model", "reasoning_effort": "medium",
        "messages": [{"role": "user", "content": "What is the weather in Milan? Use the tool."}],
        "tools": WEATHER, "tool_choice": "auto", "max_tokens": 2048,
    })
    m = first["_json"]["choices"][0]["message"]
    tc = m["tool_calls"][0]
    for tag, include_reasoning in (("WITHOUT reasoning_content", False), ("WITH reasoning_content", True)):
        assistant = {"role": "assistant", "content": m.get("content"), "tool_calls": [tc]}
        if include_reasoning and m.get("reasoning_content"):
            assistant["reasoning_content"] = m["reasoning_content"]
        r = post("/chat/completions", {
            "model": "chat-model", "reasoning_effort": "medium",
            "messages": [
                {"role": "user", "content": "What is the weather in Milan? Use the tool."},
                assistant,
                {"role": "tool", "tool_call_id": tc["id"], "content": "18C, partly cloudy"},
            ],
            "tools": WEATHER, "max_tokens": 2048,
        })
        if "_body" in r:
            print(f"\n  {tag}: HTTP {r['_http']}  {r['_body'][:400]}")
        else:
            mm = r["_json"]["choices"][0]["message"]
            print(f"\n  {tag}: HTTP 200 finish={r['_json']['choices'][0]['finish_reason']} "
                  f"content={repr(mm.get('content'))[:150]}")

if __name__ == "__main__":
    for name in (sys.argv[1:] or ["combo", "streaming", "multistep"]):
        {"combo": combo, "streaming": streaming, "multistep": multistep}[name]()
