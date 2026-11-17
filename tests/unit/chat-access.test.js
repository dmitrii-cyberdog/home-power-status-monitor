import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createChatAccess } from '../../src/services/chatAccess.js'
import { openMonitorStore } from '../../src/services/monitorStore.js'

test('grants survive restart; rotation and subscription identities prevent replay', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'monitor-access-'))
  const store = await openMonitorStore({ directory, homeIds: ['1'] })

  t.after(async () => {
    await store.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  const make = secret =>
    createChatAccess({ store, secret, homes: [{ id: '1' }], now: () => 0 })
  let access = make(' exact secret ')

  await access.initialize()
  assert.equal(await access.authorize('-1007', 'exact secret', 'en'), 'invalid')
  assert.equal(
    await access.authorize('-1007', ' exact secret ', 'ru'),
    'authorized',
  )
  await access.setSubscription('-1007', '1', true, 'ru')
  const recipient = access.recipients('1', store.readChats())[0]
  const delivery = { ...recipient, eventId: '1:1' }

  assert.equal(access.isDeliveryAllowed(delivery), true)
  await access.setSubscription('-1007', '1', true, 'ru')
  assert.deepEqual(access.recipients('1', store.readChats())[0], recipient)
  access = make(' exact secret ')
  await access.initialize()
  assert.equal(access.isAuthorized('-1007'), true)
  await access.setSubscription('-1007', '1', false, 'ru')
  await access.setSubscription('-1007', '1', true, 'ru')
  assert.equal(access.isDeliveryAllowed(delivery), false)
  access = make('new')
  await access.initialize()
  access = make(' exact secret ')
  await access.initialize()
  assert.equal(access.isAuthorized('-1007'), false)
  assert.doesNotMatch(JSON.stringify(store.readChats()), /exact secret/)
})

test('exact authentication is limited per chat and empty secrets disable grants', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'monitor-limit-'))
  const store = await openMonitorStore({ directory, homeIds: [] })

  t.after(async () => {
    await store.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  let now = 0
  const access = createChatAccess({
    store,
    secret: 'secret',
    homes: [],
    now: () => now,
  })

  await access.initialize()

  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal(await access.authorize('1', 'wrong', 'en'), 'invalid')
  }

  assert.equal(await access.authorize('1', 'secret', 'en'), 'rate_limited')
  assert.equal(await access.authorize('2', 'secret', 'en'), 'authorized')
  assert.equal(await access.authorize('2', 'wrong', 'en'), 'invalid')
  assert.equal(access.isAuthorized('2'), true)
  now = 60000
  assert.equal(await access.authorize('1', 'secret', 'en'), 'authorized')
  const disabled = createChatAccess({ store, secret: '', homes: [] })

  await disabled.initialize()
  assert.equal(disabled.isAuthorized('1'), false)
  assert.equal(await disabled.authorize('1', '', 'en'), 'disabled')
})
