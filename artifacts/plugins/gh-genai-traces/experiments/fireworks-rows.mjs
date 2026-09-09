/** Serialize validated neutral candidates from stdin with the built destination library. */
import { validateCandidate } from '../lib/curation.js'
import { exportFireworksSft, exportFireworksOutcomeSft } from '../lib/fireworks.js'

let input = ''
for await (const chunk of process.stdin) input += chunk
const { candidates, objective } = JSON.parse(input)
if (!['final-answer-format', 'outcome-reasoning'].includes(objective)) throw Error('Unsupported SFT objective')
const rows = candidates.map(value => objective === 'outcome-reasoning'
  ? exportFireworksOutcomeSft(value) : exportFireworksSft(validateCandidate(value)))
process.stdout.write(JSON.stringify(rows) + '\n')
