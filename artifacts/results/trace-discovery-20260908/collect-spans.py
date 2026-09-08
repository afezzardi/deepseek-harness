"""Persist paginated Phoenix observations and select canonical sessions for audit."""
import json
from pathlib import Path
import urllib.parse
import urllib.request

OUT = Path(__file__).resolve().parent
trials = json.loads((OUT / 'trials.json').read_text())
sessions = []
summary = []
for trial in trials:
    project = trial['project']
    spans = []
    cursor = None
    seen = set()
    while True:
        query = urllib.parse.urlencode(dict(limit=100, **({'cursor':cursor} if cursor else {})))
        url = f'http://127.0.0.1:6006/v1/projects/{project}/spans?{query}'
        with urllib.request.urlopen(url, timeout=20) as response:
            page = json.load(response)
        spans.extend(page['data'])
        cursor = page.get('next_cursor')
        if not cursor:
            break
        if cursor in seen:
            raise RuntimeError('Phoenix pagination repeated a cursor')
        seen.add(cursor)
    key = f"{trial['case']}-{trial['repetition']}"
    (OUT / f'{key}.spans.json').write_text(json.dumps(spans,indent=2)+'\n')
    roots = [s for s in spans if s['name']=='invoke_agent dsh']
    models = [s for s in spans if s['span_kind']=='LLM' and s['attributes'].get('gh.call.purpose')=='conversation']
    auxiliary = [s for s in spans if s['span_kind']=='LLM' and s['attributes'].get('gh.call.purpose')!='conversation']
    tools = [s for s in spans if s['span_kind']=='TOOL']
    if len(roots)!=1:
        raise RuntimeError(f'{key}: expected one root, got {len(roots)}')
    root = roots[0]
    sid = root['attributes']['gen_ai.conversation.id']
    sessions.append(sid)
    row = dict(key=key, project=project, session_id=sid, trace_id=root['context']['trace_id'], root_span_id=root['context']['span_id'],
               spans=len(spans), model_calls=len(models), auxiliary_calls=len(auxiliary), tool_calls=len(tools),
               tools=[s['attributes']['gen_ai.tool.name'] for s in tools],
               model_efforts=[s['attributes'].get('gen_ai.request.reasoning.level') for s in models],
               auxiliary_efforts=[s['attributes'].get('gen_ai.request.reasoning.level') for s in auxiliary],
               incomplete_spans=sum(s['attributes'].get('gh.capture.incomplete') is not False for s in spans),
               content_omissions=[{'span':s['context']['span_id'],'field':k,'status':v} for s in spans for k,v in s['attributes'].items() if k.endswith('.status') and v in ['omitted','truncated','withheld']],
               outcome=root['attributes'].get('gh.turn.outcome'),
               input_tokens=sum(s['attributes'].get('gen_ai.usage.input_tokens',0) for s in models+auxiliary),
               output_tokens=sum(s['attributes'].get('gen_ai.usage.output_tokens',0) for s in models+auxiliary),
               turn_usage={k:v for k,v in root['attributes'].items() if k.startswith('gh.turn.usage.')})
    summary.append(row)
(OUT / 'trace-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
(OUT / 'session-ids.json').write_text(json.dumps(sessions,indent=2)+'\n')
print(json.dumps({'trials':len(summary), 'spans':sum(x['spans'] for x in summary),'model_calls':sum(x['model_calls'] for x in summary),'efforts':sorted({e for x in summary for e in x['model_efforts']}),'omissions':sum(len(x['content_omissions']) for x in summary)}))
