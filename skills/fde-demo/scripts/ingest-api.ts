/**
 * ingest-api.ts — OpenAPI spec -> mock-first data layer for the demo app.
 *
 * Usage: npx tsx scripts/ingest-api.ts <openapi.json|yaml> <appDir>
 *
 * Emits:
 *   <appDir>/data/mock-data.json      keys "METHOD /path" -> synthesized sample
 *   <appDir>/lib/generated-client.ts  one fetch wrapper per operation;
 *                                     NEXT_PUBLIC_API_BASE unset -> /api/mock
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

type Schema = {
  type?: string
  format?: string
  enum?: unknown[]
  example?: unknown
  default?: unknown
  properties?: Record<string, Schema>
  items?: Schema
  required?: string[]
  $ref?: string
  allOf?: Schema[]
  oneOf?: Schema[]
  anyOf?: Schema[]
}

type OpenApiDoc = {
  paths?: Record<string, Record<string, Operation>>
  components?: { schemas?: Record<string, Schema> }
}

type Operation = {
  operationId?: string
  summary?: string
  responses?: Record<string, { content?: Record<string, { schema?: Schema }> }>
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const
const MOCK_LIST_LENGTH = 8
const MAX_DEPTH = 6

// Deterministic PRNG so mock data (and tests) are stable across runs.
function hashSeed(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NAME_POOL = ['王强', '李娜', '张伟', '刘洋', '陈静', '杨帆', '赵磊', '孙悦']
const WORD_POOL = ['华东', '华南', '华北', '西南', '旗舰', '标准', '加急', '常规']

function sampleValueFor(name: string, schema: Schema, rand: () => number): unknown {
  if (schema.example !== undefined) return schema.example
  if (schema.default !== undefined) return schema.default
  if (schema.enum?.length) return schema.enum[Math.floor(rand() * schema.enum.length)]

  const lower = name.toLowerCase()
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)]

  switch (schema.type) {
    case 'integer':
    case 'number': {
      if (/price|amount|revenue|cost/.test(lower)) return Math.round(rand() * 99000 + 1000) / 100
      if (/count|qty|quantity|num/.test(lower)) return Math.floor(rand() * 200)
      if (/rate|ratio|percent/.test(lower)) return Math.round(rand() * 1000) / 10
      return Math.floor(rand() * 1000)
    }
    case 'boolean':
      return rand() > 0.5
    case 'string': {
      if (schema.format === 'date-time') {
        const day = 1 + Math.floor(rand() * 27)
        return `2026-07-${String(day).padStart(2, '0')}T0${Math.floor(rand() * 9)}:30:00Z`
      }
      if (schema.format === 'date') return `2026-07-${String(1 + Math.floor(rand() * 27)).padStart(2, '0')}`
      if (schema.format === 'email' || /email/.test(lower)) return `user${Math.floor(rand() * 90 + 10)}@example.com`
      if (schema.format === 'uuid') return `00000000-0000-4000-8000-${String(Math.floor(rand() * 1e12)).padStart(12, '0')}`
      if (/phone|mobile/.test(lower)) return `138${String(Math.floor(rand() * 1e8)).padStart(8, '0')}`
      if (/name|owner|user|person/.test(lower)) return pick(NAME_POOL)
      if (/id|no|code$/.test(lower)) return `${lower.replace(/id$|no$|code$/, '').toUpperCase() || 'REC'}-${Math.floor(rand() * 9000 + 1000)}`
      if (/status|state/.test(lower)) return pick(['pending', 'active', 'done'])
      if (/url|link/.test(lower)) return 'https://example.com/item'
      return `${pick(WORD_POOL)}${name}`
    }
    default:
      return null
  }
}

function resolveRef(schema: Schema, doc: OpenApiDoc): Schema {
  if (!schema.$ref) return schema
  const name = schema.$ref.split('/').pop() ?? ''
  return doc.components?.schemas?.[name] ?? {}
}

export function synthesize(schema: Schema | undefined, doc: OpenApiDoc, name = 'root', depth = 0): unknown {
  if (!schema || depth > MAX_DEPTH) return null
  schema = resolveRef(schema, doc)
  if (schema.allOf) {
    const merged: Record<string, unknown> = {}
    for (const part of schema.allOf) Object.assign(merged, synthesize(part, doc, name, depth + 1) ?? {})
    return merged
  }
  if (schema.oneOf?.length || schema.anyOf?.length) {
    return synthesize((schema.oneOf ?? schema.anyOf)![0], doc, name, depth + 1)
  }
  if (schema.type === 'array' || schema.items) {
    const n = depth === 0 ? MOCK_LIST_LENGTH : 3
    return Array.from({ length: n }, (_, i) => synthesize(schema!.items, doc, `${name}[${i}]`, depth + 1))
  }
  if (schema.type === 'object' || schema.properties) {
    const out: Record<string, unknown> = {}
    for (const [key, prop] of Object.entries(schema.properties ?? {})) {
      out[key] = synthesize(prop, doc, `${name}.${key}`, depth + 1)
    }
    return out
  }
  return sampleValueFor(name.split(/[.[]/).pop() ?? name, schema, mulberry32(hashSeed(name)))
}

function successSchema(op: Operation): Schema | undefined {
  for (const code of ['200', '201', 'default']) {
    const content = op.responses?.[code]?.content
    if (!content) continue
    const json = content['application/json'] ?? Object.values(content)[0]
    if (json?.schema) return json.schema
  }
  return undefined
}

function toFnName(method: string, path: string, op: Operation): string {
  if (op.operationId) return op.operationId.replace(/[^a-zA-Z0-9_]/g, '_')
  const parts = path.split('/').filter((p) => p && !p.startsWith('{'))
  const tail = parts.map((p, i) => (i === 0 ? p : p[0].toUpperCase() + p.slice(1))).join('')
  return method.toLowerCase() + (tail ? tail[0].toUpperCase() + tail.slice(1) : 'Root')
}

export interface IngestResult {
  mockData: Record<string, unknown>
  clientSource: string
  operations: string[]
}

export function ingest(specText: string, specName: string): IngestResult {
  const doc: OpenApiDoc = specName.endsWith('.json') ? JSON.parse(specText) : parseYaml(specText)
  const mockData: Record<string, unknown> = {}
  const fns: string[] = []
  const operations: string[] = []

  for (const [path, methods] of Object.entries(doc.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = methods[method]
      if (!op) continue
      const key = `${method.toUpperCase()} ${path}`
      operations.push(key)
      mockData[key] = synthesize(successSchema(op), doc, path) ?? { ok: true }

      const fn = toFnName(method, path, op)
      const params = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1])
      const args = params.map((p) => `${p}: string | number`).join(', ')
      const urlExpr = '`' + path.replace(/\{([^}]+)\}/g, '${$1}') + '`'
      fns.push(
        `/** ${op.summary ?? key} */\n` +
          `export async function ${fn}(${args}) {\n` +
          `  return request('${method.toUpperCase()}', ${urlExpr})\n` +
          `}`,
      )
    }
  }

  const clientSource = `// Generated by fde-demo ingest-api.ts — do not edit by hand.
// Mock-first: NEXT_PUBLIC_API_BASE unset -> /api/mock (serves data/mock-data.json).
const BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api/mock'

async function request(method: string, path: string) {
  const res = await fetch(BASE + path, { method, headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(\`\${method} \${path} -> \${res.status}\`)
  return res.json()
}

${fns.join('\n\n')}
`
  return { mockData, clientSource, operations }
}

export function ingestToApp(specPath: string, appDir: string): IngestResult {
  const result = ingest(readFileSync(specPath, 'utf8'), specPath)
  mkdirSync(join(appDir, 'data'), { recursive: true })
  mkdirSync(join(appDir, 'lib'), { recursive: true })
  writeFileSync(join(appDir, 'data', 'mock-data.json'), JSON.stringify(result.mockData, null, 2))
  writeFileSync(join(appDir, 'lib', 'generated-client.ts'), result.clientSource)
  return result
}

const isCli = process.argv[1]?.endsWith('ingest-api.ts')
if (isCli) {
  const [specPath, appDir] = process.argv.slice(2)
  if (!specPath || !appDir) {
    console.error('usage: npx tsx scripts/ingest-api.ts <openapi.json|yaml> <appDir>')
    process.exit(1)
  }
  const { operations } = ingestToApp(specPath, appDir)
  console.log(`ingested ${operations.length} operations:`)
  for (const op of operations) console.log('  ' + op)
}
