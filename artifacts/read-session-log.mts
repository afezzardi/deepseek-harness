import { readFileSync, writeFileSync } from 'node:fs'
import { scanZstdFrames, decompressZstdFrame } from '../packages/session/session-persistence-jsonl/src/zstd.ts'

const file = process.argv[2]
const buf = readFileSync(file)
const { frames, tornStart } = scanZstdFrames(buf)
const parts: string[] = []
for (const f of frames) parts.push((await decompressZstdFrame(buf.subarray(f.start, f.end))).toString())
process.stderr.write(`frames=${frames.length} torn=${tornStart ?? 'none'}\n`)
writeFileSync(process.argv[3], parts.join(''))
