"""Publish local canonical campaign grades with retained trace provenance."""
from datetime import datetime, timezone
import json
from pathlib import Path
import urllib.request

OUT = Path(__file__).resolve().parent
EVIDENCE = OUT/'phoenix-evaluation.json'
BASE = 'http://127.0.0.1:6006'
def request(path,body=None):
    data=None if body is None else json.dumps(body).encode()
    with urllib.request.urlopen(urllib.request.Request(BASE+path,data=data,headers={'Content-Type':'application/json'}),timeout=30) as response:
        return json.load(response)

if EVIDENCE.exists():
    raise RuntimeError('Publication evidence already exists; do not duplicate evaluated records')
trials={t['trial']:t for t in json.loads((OUT/'campaign/trials.json').read_text())}
grades=json.loads((OUT/'campaign/audit/grades.json').read_text())
spans=json.loads((OUT/'gh-training-replay.spans.json').read_text())
roots={s['attributes']['gen_ai.conversation.id']:s for s in spans if s['name']=='invoke_agent dsh' and s['attributes'].get('gh.ownership.status')=='root'}
candidates={c['provenance']['session']:c for c in (json.loads(line) for line in (OUT/'campaign/audit/candidates.jsonl').read_text().splitlines())}
inputs=[];outputs=[];metadata=[];span_ids=[]
for g in grades:
    t=trials[g['trial']];c=candidates.get(g['session']);root=roots[g['session']]
    inputs.append({'task':t['prompt']});outputs.append({'expected':t['expected']})
    metadata.append(dict(trial=g['trial'],family=g['family'],source_session=g['session'],source_trace_id=root['context']['trace_id'],split=c['split'] if c else t['split'],capture_eligible=c is not None,sft_eligible=c['sftEligible'] if c else False,renderer_validated=False,grade=g['grade']))
    span_ids.append(root['context']['span_id'])
dataset=request('/v1/datasets/upload?sync=true',dict(name='gh-training-20260908-canonical',action='create',inputs=inputs,outputs=outputs,metadata=metadata,span_ids=span_ids))['data']
saved=dict(dataset=dataset,experiment=None,runs=[])
EVIDENCE.write_text(json.dumps(saved,indent=2)+'\n')
examples=[];cursor=None
while True:
    from urllib.parse import urlencode
    page=request(f"/v1/datasets/{dataset['dataset_id']}/examples"+('?' + urlencode({'cursor':cursor}) if cursor else ''))
    examples.extend(page['data']['examples']);cursor=page.get('next_cursor')
    if not cursor:break
by_key={e['metadata']['trial']:e for e in examples}
if len(by_key)!=len(grades):raise RuntimeError('Incomplete dataset example lookup')
experiment=request(f"/v1/datasets/{dataset['dataset_id']}/experiments",dict(name='medium-canonical-v1',version_id=dataset['version_id'],metadata={'grader':'canonical-deterministic-v1','reasoning_effort':'medium'}))['data']
saved['experiment']=experiment;EVIDENCE.write_text(json.dumps(saved,indent=2)+'\n')
for g in grades:
    t=trials[g['trial']];root=roots[g['session']]
    passed=all(value for key,value in g['grade'].items() if key!='version')
    result=dict(score=int(passed),label='pass' if passed else 'fail',explanation='Independent syntax, expected value, canonical tool trajectory, and final file-state criteria.')
    start=datetime.fromtimestamp(t['started'],timezone.utc).isoformat();end=datetime.fromtimestamp(t['ended'],timezone.utc).isoformat()
    run=request(f"/v1/experiments/{experiment['id']}/runs",dict(dataset_example_id=by_key[g['trial']]['id'],output=t['output'],repetition_number=1,start_time=start,end_time=end,trace_id=root['context']['trace_id']))['data']
    evaluation=request('/v1/experiment_evaluations',dict(experiment_run_id=run['id'],name='task_outcome',annotator_kind='CODE',start_time=end,end_time=end,result=result,metadata=g,trace_id=root['context']['trace_id']))
    saved['runs'].append(dict(trial=g['trial'],run=run,result=result,evaluation=evaluation))
    EVIDENCE.write_text(json.dumps(saved,indent=2)+'\n')
print(json.dumps(dict(dataset=dataset,experiment=experiment,runs=len(saved['runs']))))
