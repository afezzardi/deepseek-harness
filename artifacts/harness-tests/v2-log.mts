/** Strict physical JSONL reader for the deployment's v2-only instruments. */
import { readFileSync } from 'node:fs'
import { releasedV2SessionFormatCodec } from '../../packages/session/session-format-v1-to-v2/src/codec.ts'
import { createZstdFrameDecoder, scanZstdFrames } from '../../packages/session/session-persistence-jsonl/src/zstd.ts'

/** Fields consumed by the offline deployment checks. */
export interface Event {
  type: string
  seq?: number
  time?: number
  id?: string
  createdAt?: number
  data?: Record<string, unknown>
}

/**
 * Validate physical v2 rows and expand storage-encoded event references.
 * @param text - Complete, decompressed JSONL text.
 * @returns Header followed by validated logical events.
 */
export function parseV2Log(text: string): Event[] {
  const rows: unknown[] = text.split('\n').filter(line => line.trim() !== '').map((line, index) => {
    try { return JSON.parse(line) as unknown }
    catch { throw new Error(`invalid JSON on non-empty line ${index + 1}; decode compressed logs first`) }
  })
  const header = rows.shift()
  if (typeof header !== 'object' || header === null || !('version' in header) || header.version !== 2) {
    throw new Error('expected Session format v2; start a fresh UAT session on the v2 deployment')
  }
  const artifact = releasedV2SessionFormatCodec.decodeArtifact(header, rows)
  return [{ type: 'session', id: artifact.header.id, createdAt: artifact.header.createdAt }, ...artifact.events]
}

/**
 * Read a complete v2 log, refusing empty, old, or corrupt input.
 * @param file - Physical JSONL or .jsonl.zstd path.
 * @returns Header followed by validated logical events.
 */
export function readV2Log(file: string): Event[] {
  return parseV2Log(readV2Text(file))
}

/**
 * Read raw or compressed JSONL without writing temporary files.
 * @param file - JSONL path, with a .zstd suffix when compressed.
 * @returns Complete plaintext; torn or corrupt frames throw.
 */
export function readV2Text(file: string): string {
  if (!file.endsWith('.zstd')) return readFileSync(file, 'utf8')
  const buffer = readFileSync(file)
  const { frames, tornStart } = scanZstdFrames(buffer)
  if (tornStart !== undefined && tornStart !== null) throw new Error('torn Zstandard frame; wait for the session to finish and retry')
  const decoder = createZstdFrameDecoder()
  try {
    const parts: string[] = []
    for (const part of decoder.decode(buffer, frames)) parts.push(part.toString())
    return parts.join('')
  } finally {
    decoder.close()
  }
}
