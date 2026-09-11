import { expect, it } from 'vitest'
import { scoreRecordedRead } from '../examples/evaluation.ts'
it('scores the observation rather than a success claim', () => {
  expect(scoreRecordedRead([{ type: 'text', text: '42' }], '42').score).toBe(1)
  expect(scoreRecordedRead([{ type: 'text', text: 'success' }], '42').score).toBe(0)
  expect(scoreRecordedRead([{ type: 'text', text: '41' }], '42').score).toBe(0)
  expect(scoreRecordedRead(undefined, '42').score).toBe(0)
})
