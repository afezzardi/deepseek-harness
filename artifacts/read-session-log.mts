import { readFileSync, writeFileSync } from 'node:fs'
import { scanZstdFrames, decompressZstdFrame } from '../packages/session/session-persistence-jsonl/src/zstd.ts'
import { parseV2Log } from './harness-tests/v2-log.mts'

const file = process.argv[2]
if (!file || !process.argv[3]) throw new Error('usage: read-session-log.mts <session.v2.jsonl.zstd> <decoded.jsonl>')
const buf = readFileSync(file)
const { frames, tornStart } = scanZstdFrames(buf)
if (tornStart !== undefined && tornStart !== null) throw new Error('torn Zstandard frame; wait for the session to finish and retry')
const parts: string[] = []
for (const f of frames) parts.push((await decompressZstdFrame(buf.subarray(f.start, f.end))).toString())
process.stderr.write(`frames=${frames.length} torn=${tornStart ?? 'none'}\n`)
const text = parts.join('')
parseV2Log(text)
writeFileSync(process.argv[3], text)
