import assert from 'node:assert/strict'
import test from 'node:test'
import { validateClientMessage } from '../src/protocol.js'

test('accepts valid join and chat messages', () => {
  const joinRes = validateClientMessage(
    JSON.stringify({ v: 0, type: 'join', room: 'sector-alpha', name: 'GENIY' }),
  )
  assert.equal(joinRes.ok, true)

  const chatRes = validateClientMessage(JSON.stringify({ v: 0, type: 'chat', text: 'Target hit!' }))
  assert.equal(chatRes.ok, true)
})

test('rejects unknown message types and oversize payloads', () => {
  const badType = validateClientMessage(JSON.stringify({ v: 0, type: 'hack' }))
  assert.equal(badType.ok, false)

  const huge = 'x'.repeat(3000)
  const oversize = validateClientMessage(huge, 1024)
  assert.equal(oversize.ok, false)
  assert.equal(oversize.code, 1009)
})
