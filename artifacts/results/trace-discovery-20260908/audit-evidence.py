"""Cross-check Phoenix spans against snapshots read by upstream session-query."""
import collections
import json
from pathlib import Path
import urllib.parse
import urllib.request

OUT = Path(__file__).resolve().parent

def fetch_spans(project):
    spans, cursor, seen = [], None, set()
    while True:
        query = urllib.parse.urlencode(dict(limit=100, **({'cursor':cursor} if cursor else {})))
        with urllib.request.urlopen(f'http://127.0.0.1:6006/v1/projects/{project}/spans?{query}', timeout=20) as response:
            page = json.load(response)
        spans.extend(page['data'])
        cursor = page.get('next_cursor')
        if not cursor:
            return spans
        if cursor in seen:
            raise RuntimeError('Repeated Phoenix cursor')
        seen.add(cursor)


def parts(blocks):
    result = []
    for block in blocks:
        if block['type'] in ('text','reasoning'):
            result.append({'type':block['type'],'content':block['text']})
        elif block['type']=='tool-call':
            result.append(dict(type='tool_call',id=block['id'],name=block['name'],arguments=block['arguments']))
        else:
            raise ValueError(f"Unsupported audit block: {block['type']}")
    return result


if __name__ == '__main__':
    traces = json.loads((OUT/'trace-summary.json').read_text())
    replay = fetch_spans('gh-discovery-20260908-canonical-replay')
    (OUT/'replay.spans.json').write_text(json.dumps(replay,indent=2)+'\n')
    rows = []
    for trace in traces:
        sid, key = trace['session_id'], trace['key']
        snapshot = json.loads((OUT/f'{sid}.session.json').read_text())
        events = snapshot['events']
        live = json.loads((OUT/f'{key}.spans.json').read_text())
        models = sorted([s for s in live if s['span_kind']=='LLM' and s['attributes'].get('gh.call.purpose')=='conversation'],key=lambda s:s['start_time'])
        assistant = [e for e in events if e['type']=='assistant/message']
        tools = [e for e in events if e['type']=='tool/call']
        replay_models = {s['attributes']['gh.event.seq']:s for s in replay if s['span_kind']=='LLM' and s['attributes'].get('gen_ai.conversation.id')==sid}
        checks = dict(model_count=len(models)==len(assistant),tool_count=len(tools)==trace['tool_calls'],
                      completed=events[-1]['type']=='turn/end' and events[-1]['data']['reason']['kind']=='completed',
                      canonical_effort=all(e['data']['header']['config'].get('reasoningEffort')=='medium' for e in events if e['type']=='request/header'),
                      replay_count=len(replay_models)==len(assistant), live_output=True, replay_output=True, replay_request=True, replay_effort=True, tool_source=True)
        if checks['model_count'] and checks['replay_count']:
            for event, model in zip(assistant, models, strict=True):
                replay_model = replay_models[event['seq']]
                expected = parts(event['data']['message']['content'])
                checks['live_output'] &= json.loads(model['attributes']['gen_ai.output.messages'])[0]['parts']==expected
                checks['replay_output'] &= json.loads(replay_model['attributes']['gen_ai.output.messages'])[0]['parts']==expected
                checks['replay_request'] &= model['attributes']['gh.request.messages']==replay_model['attributes'].get('gh.request.messages')
                checks['replay_effort'] &= replay_model['attributes'].get('gen_ai.request.reasoning.level')=='medium'
        for tool in [s for s in live if s['span_kind']=='TOOL']:
            source = events[tool['attributes']['gh.event.seq']]
            checks['tool_source'] &= source['type']=='tool/call' and source['data']['callId']==tool['attributes']['gen_ai.tool.call.id'] and source['data']['arguments']==json.loads(tool['attributes']['gen_ai.tool.call.arguments'])
        rows.append(dict(key=key, session_id=sid, events=len(events), checks=checks,
                         errors=[e['data'].get('error') for e in events if e['type']=='tool/result' and e['data'].get('error')],
                         replay_model_spans=[s['context']['span_id'] for s in replay_models.values()]))
    (OUT/'canonical-audit.json').write_text(json.dumps(rows,indent=2)+'\n')
    edges = []
    for trial in json.loads((OUT/'edge-trials.json').read_text()):
        spans = fetch_spans(trial['project'])
        (OUT/f"{trial['case']}-1.spans.json").write_text(json.dumps(spans,indent=2)+'\n')
        edges.append(dict(case=trial['case'], spans=len(spans), answer=trial['output'],
                          session_ids=sorted({s['attributes']['gen_ai.conversation.id'] for s in spans if 'gen_ai.conversation.id' in s['attributes']}),
                          omissions=[{'source':s['attributes'].get('gh.source.id'),'field':k,'status':v} for s in spans for k,v in s['attributes'].items() if k.endswith('.status') and v in ['truncated','omitted','withheld']],
                          canary_exported='gh-synthetic-canary-20260908' in json.dumps(spans),
                          redaction_marker='[REDACTED]' in json.dumps(spans),
                          incomplete_spans=sum(s['attributes'].get('gh.capture.incomplete') is not False for s in spans),
                          model_efforts=[s['attributes'].get('gen_ai.request.reasoning.level') for s in spans if s['span_kind']=='LLM' and s['attributes'].get('gh.call.purpose')=='conversation'],
                          workflow_links=[s.get('links') for s in spans if s['name']=='invoke_agent dsh']))
    (OUT/'edge-summary.json').write_text(json.dumps(edges,indent=2)+'\n')
    print(json.dumps(dict(sessions=len(rows), replay_spans=len(replay), failures=[{'key':r['key'],'checks':[k for k,v in r['checks'].items() if not v]} for r in rows if not all(r['checks'].values())], edges=edges),indent=2))
