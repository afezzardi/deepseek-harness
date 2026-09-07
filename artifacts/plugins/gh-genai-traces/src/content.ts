/** Redaction of exported copies; canonical sessions remain untouched. */
import type { Attributes } from '@opentelemetry/api'
import type { ContentBlock, Message, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { Settings } from './config.ts'

/** Sanitizes content and retains explicit byte/completeness metadata. */
export class ContentPolicy {
  private readonly secrets: string[]
  private readonly keys: Set<string>
  constructor(private readonly settings: Settings, env: NodeJS.ProcessEnv) {
    this.secrets = settings.secretEnv.map(key => env[key]).filter((value): value is string => Boolean(value)).sort((a, b) => b.length - a.length)
    this.keys = new Set(settings.redactKeys.map(key => key.toLowerCase()))
  }

  /** Remove configured literal secrets and common credential assignments.
   * @param value - exported string.
   * @returns sanitized string.
   */
  text(value: string): string {
    let result = value
    for (const secret of this.secrets) result = result.split(secret).join('[REDACTED]')
    return result
      .replace(/\bBearer\s+[^\s"'\\]+/gi, 'Bearer [REDACTED]')
      .replace(/\b(api[_-]?key|password|access[_-]?token|refresh[_-]?token|secret)\s*[:=]\s*(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/gi, '$1=[REDACTED]')
  }

  /** Serialize one bounded content field. Failed serialization withholds its content.
   * @param key - OTEL or gh content attribute name.
   * @param value - JSON-compatible captured value.
   * @returns attributes including capture disposition and original byte count.
   */
  attributes(key: string, value: unknown): Attributes {
    if (this.settings.content === 'metadata') return { [`gh.content.${key}.status`]: 'omitted' }
    try {
      const encoded = JSON.stringify(value, (name, member: unknown) => {
        if (this.keys.has(name.toLowerCase())) return '[REDACTED]'
        return typeof member === 'string' ? this.text(member) : member
      })
      if (encoded === undefined) return {}
      const size = Buffer.byteLength(encoded)
      // Keep structured attributes valid JSON. Oversized data is referenced by
      // source identity instead of publishing a broken JSON prefix.
      if (size > this.settings.maxContentBytes) return {
        [`gh.content.${key}.status`]: 'truncated', [`gh.content.${key}.bytes`]: size,
      }
      return { [key]: encoded, [`gh.content.${key}.status`]: 'redacted', [`gh.content.${key}.bytes`]: size }
    } catch {
      // Only JSON serialization and the local redaction policy run in this try.
      return { [`gh.content.${key}.status`]: 'withheld' }
    }
  }
}

/** Map DSH blocks to GenAI message parts while retaining unsupported content as text.
 * @param blocks - model-visible content, with provider-emitted reasoning separate.
 * @returns GenAI-compatible parts.
 */
export function parts(blocks: readonly ContentBlock[]): unknown[] {
  return blocks.map(block => {
    switch (block.type) {
      case 'text': return { type: 'text', content: block.text }
      case 'reasoning': return { type: 'reasoning', content: block.text }
      case 'tool-call': return { type: 'tool_call', id: block.id, name: block.name, arguments: block.arguments }
      case 'tool-result': return { type: 'tool_call_response', id: block.toolCallId, response: parts(block.content) }
      default: return { type: 'text', content: JSON.stringify(block) }
    }
  })
}

/** Preserve tool-role attribution from DSH's user-role tool-result messages.
 * @param messages - ordered harness input messages.
 * @returns GenAI input messages.
 */
export function inputMessages(messages: readonly Message[]): unknown[] {
  return messages.map(message => ({ role: message.source.kind === 'tool' ? 'tool' : message.role, parts: parts(message.content) }))
}

/** Map only provable provider counts; reasoning remains an output subset.
 * @param usage - final provider sample for one call.
 * @returns token attributes; absent aggregate input remains unknown.
 */
export function usageAttributes(usage: TokenUsage | undefined): Attributes {
  if (!usage) return {}
  const count = (n: number | undefined): n is number => n !== undefined && Number.isSafeInteger(n) && n >= 0
  const attributes: Attributes = {}
  if (count(usage.inputTokens)) attributes['gh.usage.uncached_input_tokens'] = usage.inputTokens
  if (count(usage.outputTokens)) attributes['gen_ai.usage.output_tokens'] = usage.outputTokens
  if (count(usage.cacheReadTokens)) attributes['gen_ai.usage.cache_read.input_tokens'] = usage.cacheReadTokens
  if (count(usage.cacheWriteTokens)) attributes['gen_ai.usage.cache_write.input_tokens'] = usage.cacheWriteTokens
  if (count(usage.reasoningTokens) && usage.reasoningTokens <= usage.outputTokens) attributes['gen_ai.usage.reasoning.output_tokens'] = usage.reasoningTokens
  const known = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
  const totalInput = count(usage.totalTokens) ? usage.totalTokens - usage.outputTokens
    : count(usage.cacheReadTokens) && count(usage.cacheWriteTokens) ? known : undefined
  if (count(usage.inputTokens) && count(usage.outputTokens) && count(totalInput) && totalInput >= known
    && (!(count(usage.cacheReadTokens) && count(usage.cacheWriteTokens)) || totalInput === known)) {
    attributes['gen_ai.usage.input_tokens'] = totalInput
  }
  return attributes
}
