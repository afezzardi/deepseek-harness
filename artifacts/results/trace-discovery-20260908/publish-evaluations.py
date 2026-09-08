"""Publish this discovery's recorded evaluations to the local Phoenix instance."""
from datetime import datetime, timezone
import json
from pathlib import Path
import urllib.request

OUT = Path(__file__).resolve().parent
BASE = 'http://127.0.0.1:6006'


def request(path, body=None):
    payload = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE+path, data=payload, headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


if __name__=='__main__':
    evidence = OUT/'phoenix-evaluation.json'
    if evidence.exists():
        raise RuntimeError('This dated publication already has evidence; inspect it before creating more records')
    trials=json.loads((OUT/'trials.json').read_text())
    traces={r['key']:r for r in json.loads((OUT/'trace-summary.json').read_text())}
    scores={r['key']:r for r in json.loads((OUT/'evaluations.json').read_text())}
    inputs, outputs, metadata, span_ids = [], [], [], []
    for trial in trials:
        key=f"{trial['case']}-{trial['repetition']}"
        trace=traces[key]
        inputs.append({'task':trial['prompt'],'fixture_set':'trace-discovery-20260908'})
        outputs.append({'expected':trial['expected']})
        metadata.append(dict(trial_key=key,source_session=trace['session_id'],source_trace_id=trace['trace_id'],reasoning_effort='medium',evaluator_version='discovery-v1',purpose='recorded-run evaluation; synthetic tasks, not a held-out benchmark'))
        span_ids.append(trace['root_span_id'])
    dataset=request('/v1/datasets/upload?sync=true',dict(name='gh-discovery-20260908-evaluated',action='create',inputs=inputs,outputs=outputs,metadata=metadata,span_ids=span_ids))['data']
    saved=dict(dataset=dataset,experiment=None,runs=[])
    evidence.write_text(json.dumps(saved,indent=2)+'\n')
    examples=request(f"/v1/datasets/{dataset['dataset_id']}/examples")['data']['examples']
    by_key={e['metadata']['trial_key']:e for e in examples}
    if len(by_key)!=len(trials):
        raise RuntimeError('Dataset example lookup is incomplete')
    experiment=request(f"/v1/datasets/{dataset['dataset_id']}/experiments",dict(name='recorded-discovery-v1',version_id=dataset['version_id'],metadata={'reasoning_effort':'medium','grader':'strict final answer + canonical tool evidence + written file state'}))['data']
    saved['experiment']=experiment
    evidence.write_text(json.dumps(saved,indent=2)+'\n')
    for trial in trials:
        key=f"{trial['case']}-{trial['repetition']}"
        trace, score = traces[key], scores[key]
        start=datetime.fromtimestamp(trial['started_at'],timezone.utc).isoformat()
        end=datetime.fromtimestamp(trial['started_at']+trial['elapsed_seconds'],timezone.utc).isoformat()
        result=dict(score=score['score'],label='pass' if score['score'] else 'fail',explanation='Strict final-output syntax and expected value, recorded tool criteria, and file contents for write tasks.')
        meta=dict(trial_key=key,evaluator_version='discovery-v1',criteria=score)
        annotation=request('/v1/trace_annotations?sync=true',{'data':[dict(name='discovery_task_outcome',annotator_kind='CODE',trace_id=trace['trace_id'],identifier='gh-discovery-v1',result=result,metadata=meta)]})
        run=request(f"/v1/experiments/{experiment['id']}/runs",dict(dataset_example_id=by_key[key]['id'],output=trial['output'],repetition_number=1,start_time=start,end_time=end,trace_id=trace['trace_id']))['data']
        evaluation=request('/v1/experiment_evaluations',dict(experiment_run_id=run['id'],name='discovery_task_outcome',annotator_kind='CODE',start_time=end,end_time=end,result=result,metadata=meta,trace_id=trace['trace_id']))
        saved['runs'].append(dict(key=key,run=run,result=result,annotation=annotation,evaluation=evaluation))
        evidence.write_text(json.dumps(saved,indent=2)+'\n')
    print(json.dumps(dict(dataset=dataset,experiment=experiment,recorded_runs=len(saved['runs']))))
