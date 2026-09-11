/** Revalidate persisted local candidates without decoding or rewriting canonical sessions. */
import {readFile,writeFile} from 'node:fs/promises'
import {partitionCandidates,validateTrainingRow} from '../../plugins/gh-genai-traces/lib/curation.js'
const summary={}
for(const name of ['campaign','preferences','reward-reset']) {
 const lines=(await readFile(new URL(`./${name}/audit/candidates.jsonl`,import.meta.url),'utf8')).trim().split('\n').filter(Boolean)
 const candidates=lines.map(line=>JSON.parse(line))
 for(const candidate of candidates) validateTrainingRow(candidate.row)
 const rows=partitionCandidates(candidates,['heldout-filter'],['unicode'])
 summary[name]={validated:rows.length,sft:rows.filter(r=>r.sftEligible&&!r.duplicateOf).length,splits:Object.fromEntries(['train','validation','test'].map(s=>[s,rows.filter(r=>r.split===s&&r.sftEligible&&!r.duplicateOf).length]))}
}
await writeFile(new URL('./final-row-validation.json',import.meta.url),JSON.stringify(summary,null,2)+'\n')
console.log(JSON.stringify(summary))
