import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ingest, ingestToApp } from '../scripts/ingest-api.ts'

const SPEC = {
  openapi: '3.0.0',
  info: { title: 'tickets', version: '1' },
  paths: {
    '/tickets': {
      get: {
        operationId: 'listTickets',
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Ticket' } },
              },
            },
          },
        },
      },
    },
    '/tickets/{id}': {
      get: {
        responses: {
          '200': {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Ticket' } },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Ticket: {
        type: 'object',
        properties: {
          ticketNo: { type: 'string' },
          ownerName: { type: 'string' },
          priority: { type: 'string', enum: ['P0', 'P1', 'P2'] },
          createdAt: { type: 'string', format: 'date-time' },
          amount: { type: 'number' },
          done: { type: 'boolean' },
        },
      },
    },
  },
}

test('ingest synthesizes mock data for every operation', () => {
  const { mockData, operations } = ingest(JSON.stringify(SPEC), 'spec.json')
  assert.deepEqual(operations.sort(), ['GET /tickets', 'GET /tickets/{id}'])

  const list = mockData['GET /tickets'] as Array<Record<string, unknown>>
  assert.equal(Array.isArray(list), true)
  assert.equal(list.length, 8)
  const first = list[0]
  assert.equal(typeof first.ticketNo, 'string')
  assert.equal(['P0', 'P1', 'P2'].includes(first.priority as string), true)
  assert.match(String(first.createdAt), /^2026-07-\d{2}T\d{2}:30:00Z$/)
  assert.equal(typeof first.amount, 'number')
  assert.equal(typeof first.done, 'boolean')

  const single = mockData['GET /tickets/{id}'] as Record<string, unknown>
  assert.equal(typeof single.ticketNo, 'string')
})

test('ingest is deterministic across runs', () => {
  const a = ingest(JSON.stringify(SPEC), 'spec.json')
  const b = ingest(JSON.stringify(SPEC), 'spec.json')
  assert.deepEqual(a.mockData, b.mockData)
})

test('generated client has one function per operation, mock-first base', () => {
  const { clientSource } = ingest(JSON.stringify(SPEC), 'spec.json')
  assert.match(clientSource, /export async function listTickets\(\)/)
  assert.match(clientSource, /export async function getTickets\(id: string \| number\)/)
  assert.match(clientSource, /NEXT_PUBLIC_API_BASE \?\? '\/api\/mock'/)
  assert.match(clientSource, /`\/tickets\/\$\{id\}`/)
})

test('ingestToApp writes mock-data.json and generated-client.ts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fde-ingest-'))
  const specPath = join(dir, 'spec.json')
  writeFileSync(specPath, JSON.stringify(SPEC))
  ingestToApp(specPath, join(dir, 'app'))
  assert.equal(existsSync(join(dir, 'app', 'data', 'mock-data.json')), true)
  assert.equal(existsSync(join(dir, 'app', 'lib', 'generated-client.ts')), true)
  const mock = JSON.parse(readFileSync(join(dir, 'app', 'data', 'mock-data.json'), 'utf8'))
  assert.equal(Object.keys(mock).length, 2)
})
