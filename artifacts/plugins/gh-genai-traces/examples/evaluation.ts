/** Explicit example: evaluate a recorded read fixture and retain Phoenix provenance. */
import { z } from 'zod'

const spanSchema = z.object({
  name: z.string(), span_kind: z.string(),
  context: z.object({ trace_id: z.string(), span_id: z.string() }),
  start_time: z.string(), end_time: z.string(),
  attributes: z.record(z.string(), z.unknown()),
})
const idResponse = z.object({ data: z.object({ id: z.string() }) })
/** Evaluate the observed fixture value, independent of the assistant's success claim.
 * @param content - recorded tool-result blocks.
 * @param expected - value established by the fixture owner.
 * @returns code-evaluator result; unsupported observations fail closed.
 */
export function scoreRecordedRead(content: unknown, expected: string) {
  const blocks = z.array(z.object({ type: z.literal('text'), text: z.string() })).safeParse(content)
  const actual = blocks.success ? blocks.data.map(block => block.text).join('') : undefined
  const score = Number(actual === expected)
  return { score, label: score ? 'pass' : 'fail', explanation: 'Compare the recorded read observation with the fixture-owned expected value.' }
}

/** Create an evaluated dataset example from the plugin's single-turn read fixture.
 * This example checks recorded observations, not arbitrary real-world task success.
 * @param baseURL - explicit Phoenix HTTP endpoint.
 * @param project - project containing one completed two-call read fixture.
 * @param expected - independently specified expected fixture value.
 * @returns created dataset, experiment, run, annotation, and evaluation identifiers.
 */
export async function evaluateReadFixture(baseURL: string, project: string, expected: string) {
  const request = async (path: string, body?: unknown): Promise<unknown> => {
    const response = await fetch(new URL(path, baseURL), body === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`Phoenix ${path}: HTTP ${response.status}`)
    return response.json()
  }
  const { data: spans } = z.object({ data: z.array(spanSchema) }).parse(await request(`/v1/projects/${encodeURIComponent(project)}/spans?limit=100`))
  const roots = spans.filter(span => span.name === 'invoke_agent dsh')
  const tools = spans.filter(span => span.span_kind === 'TOOL')
  const models = spans.filter(span => span.span_kind === 'LLM').sort((a, b) => a.start_time.localeCompare(b.start_time))
  const [root] = roots
  const [tool] = tools
  const [first] = models
  if (roots.length !== 1 || tools.length !== 1 || models.length !== 2 || !root || !tool || !first) throw Error('Expected exactly one turn, one read tool, and two model calls')
  if (root.attributes['gh.capture.incomplete'] !== false) throw Error('The fixture trace is incomplete')
  const parseAttribute = (attributes: Record<string, unknown>, key: string): unknown => JSON.parse(z.string().parse(attributes[key]))
  const result = scoreRecordedRead(parseAttribute(tool.attributes, 'gen_ai.tool.call.result'), expected)
  const metadata = { evaluator_version: '1', source_session: first.attributes['gen_ai.conversation.id'], source_trace_id: root.context.trace_id, capture_origin: first.attributes['gh.capture.origin'], verification: 'recorded-fixture-observation' }
  const annotations = await request('/v1/trace_annotations?sync=true', { data: [{
    name: 'fixture_tool_outcome', annotator_kind: 'CODE', trace_id: root.context.trace_id, identifier: 'gh-fixture-v1', result, metadata,
  }] })
  const dataset = z.object({ data: z.object({ dataset_id: z.string(), version_id: z.string(), num_created_examples: z.number() }) }).parse(await request('/v1/datasets/upload?sync=true', {
    name: `${project}-evaluated`, action: 'create',
    inputs: [{ messages: parseAttribute(first.attributes, 'gh.request.messages'), system: parseAttribute(first.attributes, 'gen_ai.system_instructions'), tools: parseAttribute(first.attributes, 'gen_ai.tool.definitions') }],
    outputs: [{ expected_value: expected }], metadata: [metadata], span_ids: [root.context.span_id],
  })).data
  const examples = z.object({ data: z.object({ examples: z.array(z.object({ id: z.string() })) }) }).parse(await request(`/v1/datasets/${dataset.dataset_id}/examples`))
  const example = examples.data.examples[0]
  if (!example) throw Error('Phoenix returned no dataset example')
  const experiment = idResponse.parse(await request(`/v1/datasets/${dataset.dataset_id}/experiments`, { name: 'recorded-read-v1', version_id: dataset.version_id, metadata })).data
  const run = idResponse.parse(await request(`/v1/experiments/${experiment.id}/runs`, {
    dataset_example_id: example.id, output: parseAttribute(tool.attributes, 'gen_ai.tool.call.result'), repetition_number: 1,
    start_time: root.start_time, end_time: root.end_time, trace_id: root.context.trace_id,
  })).data
  const now = new Date().toISOString()
  const evaluation = await request('/v1/experiment_evaluations', {
    experiment_run_id: run.id, name: 'fixture_tool_outcome', annotator_kind: 'CODE', start_time: now, end_time: now, result, metadata, trace_id: root.context.trace_id,
  })
  return { dataset, experiment, run, annotations, evaluation, result }
}
