import { readFile, writeFile } from 'node:fs/promises'
import { gradeRewardEnvironment, resetRewardEnvironment } from '../../plugins/gh-genai-traces/lib/reward.js'
const trials = JSON.parse(await readFile(new URL('./reward-reset/trials.json', import.meta.url), 'utf8'))
const rows = []
for (const trial of trials) rows.push({ trial: trial.trial, inputHashes: trial.fixture_hashes, result: await gradeRewardEnvironment({ directory: trial.directory, inputHashes: trial.fixture_hashes }, trial.expected) })
const fresh = await resetRewardEnvironment(new URL('./reward-reset/.negative-controls', import.meta.url).pathname, { 'input.json': '{"value":10}\n' })
const absent = await gradeRewardEnvironment(fresh, { total: 10 })
await writeFile(fresh.directory+'/answer.json', '{"total":11}')
const wrong = await gradeRewardEnvironment(fresh, { total: 10 })
await writeFile(new URL('./reward-summary.json', import.meta.url), JSON.stringify({ rows, resetHashesEqual: rows.every(row=>JSON.stringify(row.inputHashes)===JSON.stringify(rows[0].inputHashes)), negativeControls: { absent, wrong } }, null, 2)+'\n')
