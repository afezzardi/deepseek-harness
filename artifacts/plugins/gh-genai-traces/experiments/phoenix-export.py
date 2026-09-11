"""Paginate and persist Phoenix evidence; derive latency from execution roots."""
from datetime import datetime
import json
from pathlib import Path
import statistics
import sys
import urllib.parse
import urllib.request

out = Path(sys.argv[1])
projects = sys.argv[2:]
summary = {}
for project in projects:
    rows = []
    cursor = None
    while True:
        query = urllib.parse.urlencode({'limit':1000, **({'cursor':cursor} if cursor else {})})
        url = 'http://127.0.0.1:6006/v1/projects/'+urllib.parse.quote(project,safe='')+'/spans?'+query
        with urllib.request.urlopen(url, timeout=30) as response:
            page = json.load(response)
        rows.extend(page['data'])
        cursor = page.get('next_cursor')
        if not cursor:
            break
    (out/(project+'.spans.json')).write_text(json.dumps(rows)+'\n')
    def seconds(row):
        return (datetime.fromisoformat(row['end_time'])-datetime.fromisoformat(row['start_time'])).total_seconds()
    roots = [row for row in rows if row['name']=='invoke_agent dsh' and row['attributes'].get('gh.ownership.status')=='root']
    models = [row for row in rows if row['span_kind']=='LLM' and row['attributes'].get('gh.call.purpose')=='conversation']
    quantiles = lambda values: dict(count=len(values), p50=statistics.median(values),p95=sorted(values)[min(len(values)-1,int(len(values)*.95))]) if values else dict(count=0)
    workflow = [row for row in rows if row['name']=='invoke_workflow dsh']
    summary[project] = dict(spans=len(rows),traces=len({r['context']['trace_id'] for r in rows}),root_seconds=quantiles([seconds(r) for r in roots]),model_seconds=quantiles([seconds(r) for r in models]),zero_duration_spans=sum(seconds(r)==0 for r in rows),
      workflow=[dict(trace=r['context']['trace_id'],span=r['context']['span_id'],children=sum(c.get('parent_id')==r['context']['span_id'] for c in rows),kind=r['span_kind']) for r in workflow])
(out/'phoenix-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
