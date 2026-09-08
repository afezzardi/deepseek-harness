"""Dated candidate export; no uploads to training providers or token-level claims."""
import collections
import hashlib
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def message(role, blocks, target=False):
    text, reasoning, calls = [], [], []
    for part in blocks:
        if part['type']=='text':
            text.append(part['content'])
        elif part['type']=='reasoning':
            reasoning.append(part['content'])
        elif part['type']=='tool_call':
            args = part['arguments']
            if isinstance(args,str):
                json.loads(args)
            else:
                args = json.dumps(args,separators=(',',':'))
            calls.append(dict(id=part['id'],type='function',function=dict(name=part['name'],arguments=args)))
        elif part['type']=='tool_call_response':
            if len(blocks)!=1 or role!='tool' or any(p['type']!='text' for p in part['response']):
                raise ValueError('Unsupported tool-result arrangement')
            return dict(role='tool',tool_call_id=part['id'],content=''.join(p['content'] for p in part['response']))
        else:
            raise ValueError(f"Unsupported content {part['type']}")
    value = dict(role=role,content=''.join(text))
    if reasoning:
        value['reasoning_content']=''.join(reasoning)
    if calls:
        value['tool_calls']=calls
    if role=='assistant':
        value['weight']=int(target)
    return value


def candidate(span):
    a=span['attributes']
    required=['gen_ai.system_instructions','gen_ai.input.messages','gen_ai.tool.definitions','gen_ai.output.messages']
    if a.get('gh.capture.incomplete') is not False or a.get('gh.stream.truncated') is not False:
        raise ValueError('Incomplete generation')
    if any(a.get('gh.content.'+k+'.status')!='redacted' or k not in a for k in required):
        raise ValueError('Missing required content')
    if any('[REDACTED]' in a[k] for k in required):
        raise ValueError('Content changed by credential redaction')
    system=json.loads(a['gen_ai.system_instructions'])
    if any(p['type']!='text' for p in system):
        raise ValueError('Unsupported system content')
    messages=[dict(role='system',content=''.join(p['content'] for p in system))]
    messages += [message(m['role'],m['parts']) for m in json.loads(a['gen_ai.input.messages'])]
    output=json.loads(a['gen_ai.output.messages'])
    if len(output)!=1 or output[0]['finish_reason']!='stop':
        raise ValueError('Expected one complete final answer')
    target=message('assistant',output[0]['parts'],True)
    definitions=json.loads(a['gen_ai.tool.definitions'])
    tools=[dict(type='function',function={k:v for k,v in tool.items() if k!='type'}) for tool in definitions]
    return dict(messages=messages+[target],tools=tools)


if __name__=='__main__':
    trials=json.loads((OUT/'trials.json').read_text())
    traces={t['key']:t for t in json.loads((OUT/'trace-summary.json').read_text())}
    audits={t['key']:t for t in json.loads((OUT/'canonical-audit.json').read_text())}
    rows, provenance, rejections, groups = [], [], [], collections.defaultdict(list)
    evaluations=[]
    for trial in trials:
        key=f"{trial['case']}-{trial['repetition']}"
        trace=traces[key]
        snapshot=json.loads((OUT/f"{trace['session_id']}.session.json").read_text())
        events=snapshot['events']
        calls=[e for e in events if e['type']=='tool/call']
        tool_names=[e['data']['name'] for e in calls]
        observations=[e for e in events if e['type']=='tool/result']
        trajectory='read' in tool_names
        if trial['case']=='recover':
            trajectory &= any(e['data'].get('error',{}).get('code')=='FS_NOT_FOUND' for e in observations)
            trajectory &= any('fallback.json' in str(e['data']['arguments']) for e in calls if e['data']['name']=='read')
        if trial['case']=='write':
            writes=[e for e in calls if e['data']['name'] in ['write','edit']]
            trajectory &= bool(writes) and any(e['seq']>writes[-1]['seq'] and 'outputs/' in str(e['data']['arguments']) for e in calls if e['data']['name']=='read')
        else:
            trajectory &= not any(n in ['write','edit'] for n in tool_names)
        score=int(trial['answer_pass'] and trial['state_pass'] is not False and trajectory and not trial['timed_out'] and trial['exit_code']==0 and all(audits[key]['checks'].values()))
        evaluations.append(dict(key=key,score=score,answer_pass=trial['answer_pass'],state_pass=trial['state_pass'],trajectory_pass=trajectory,canonical_verified=all(audits[key]['checks'].values())))
        spans=json.loads((OUT/f'{key}.spans.json').read_text())
        models=sorted([s for s in spans if s['span_kind']=='LLM' and s['attributes'].get('gh.call.purpose')=='conversation'],key=lambda s:s['start_time'])
        final=models[-1]
        try:
            row=candidate(final)
        except ValueError as error:
            rejections.append(dict(key=key,reason=str(error)))
            continue
        prefix=dict(messages=row['messages'][:-1],tools=row['tools'])
        groups[digest(prefix)].append(dict(key=key,score=score,output=row['messages'][-1]))
        if not score:
            rejections.append(dict(key=key,reason='Failed strict task or trajectory grading'))
            continue
        rows.append(row)
        provenance.append(dict(line=len(rows),key=key,source_session=trace['session_id'],source_trace=trace['trace_id'],source_span=final['context']['span_id'],source_event_seq=[e['seq'] for e in events if e['type']=='assistant/message'][-1],request_sha256=digest(prefix),row_sha256=digest(row),reasoning_effort=final['attributes']['gen_ai.request.reasoning.level'],target_policy='final-assistant-only; earlier assistant messages have weight 0',status='candidate; renderer and privacy review pending'))
    pairs=[]
    for request_hash, group in groups.items():
        good=[g for g in group if g['score']]
        bad=[g for g in group if not g['score']]
        if good and bad:
            pairs.append(dict(request_sha256=request_hash,preferred=good[0],rejected=bad[0]))
    (OUT/'sft.candidates.jsonl').write_text(''.join(json.dumps(row,ensure_ascii=False)+'\n' for row in rows))
    (OUT/'sft-provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
    (OUT/'evaluations.json').write_text(json.dumps(evaluations,indent=2)+'\n')
    (OUT/'curation-summary.json').write_text(json.dumps(dict(sft_candidates=len(rows),rejections=rejections,exact_request_groups=len(groups),dpo_pairs=pairs,rl_token_ready=False),indent=2)+'\n')
    seeds=[]
    for case in sorted({t['case'] for t in trials}):
        t=next(t for t in trials if t['case']==case)
        seeds.append(dict(task_id=case,messages=[dict(role='user',content=t['prompt'])],ground_truth=t['expected'],fixture_hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (OUT/'fixtures').iterdir()},environment='DSH headless, pinned repository revision, synthetic fixture files; write target must be allocated per rollout',evaluator='strict JSON or exact heading + recorded tool evidence + file state for writes',status='RFT task seed; requires a rollout environment adapter'))
    (OUT/'rft-task-seeds.jsonl').write_text(''.join(json.dumps(row)+'\n' for row in seeds))
    print(json.dumps(dict(sft_candidates=len(rows),dpo_pairs=len(pairs),rft_task_seeds=len(seeds),evaluated_pass=sum(e['score'] for e in evaluations),rejections=rejections)))
