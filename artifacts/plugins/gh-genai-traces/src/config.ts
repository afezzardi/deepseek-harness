/** Explicit configuration for capture, redaction, memory bounds, and local export. */
import { z } from 'zod'

const positive = z.number().int().positive().max(2_147_483_647)
/** Validated deployment fields; endpoint credentials must use headers. */
export const configSchema = z.object({
  endpoint: z.url().refine(value => {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
  }, 'endpoint must be HTTP(S) without credentials, query, or fragment').default('http://127.0.0.1:4318/v1/traces'),
  project: z.string().min(1).default('gh-genai-traces'),
  headers: z.record(z.string(), z.string()).default({}),
  content: z.enum(['rich-redacted', 'metadata']).default('metadata'),
  secretEnv: z.array(z.string().min(1)).default(['DEEPSEEK_API_KEY', 'FIREWORKS_API_KEY', 'LITELLM_MASTER_KEY']),
  redactKeys: z.array(z.string().min(1)).default(['authorization', 'api_key', 'apikey', 'password', 'secret', 'access_token', 'refresh_token']),
  maxContentBytes: positive.default(65_536),
  maxStreamBytes: positive.default(262_144),
  maxEventsPerSpan: positive.default(128),
  maxPendingRecords: positive.default(1024),
  maxActiveSpans: positive.default(4096),
  maxTurnEvents: positive.default(8192),
  maxQueueSize: positive.default(2048),
  maxExportBatchSize: positive.default(128),
  scheduledDelayMillis: positive.default(1000),
  exportTimeoutMillis: positive.default(3000),
  shutdownTimeoutMillis: positive.default(5000),
  replaySessionIds: z.array(z.string().min(1)).default([]),
}).strict().refine(c => c.maxExportBatchSize <= c.maxQueueSize, 'maxExportBatchSize must not exceed maxQueueSize')
/** Fully resolved plugin settings. */
export type Settings = z.infer<typeof configSchema>
/** Accepted deployment settings before defaults are materialized. */
export type Config = z.input<typeof configSchema>

/** Resolve deployment defaults and validate before mounting effects.
 * @param input - configuration from Cordis or a test.
 * @returns complete settings.
 */
export function resolveConfig(input: Config): Settings { return configSchema.parse(input) }
