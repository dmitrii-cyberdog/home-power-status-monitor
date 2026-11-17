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

test('chat clears persist and revoke subscriptions without touching home records', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'monitor-clear-'))

  let store = await openMonitorStore({ directory, homeIds: ['1'] })

  t.after(async () => {
    await store.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  const make = () =>
    createChatAccess({ store, secret: 'secret', homes: [{ id: '1' }] })

  let access = make()

  await access.initialize()
  await access.authorize('-1007', 'secret', 'en')
  await access.authorize('8', 'secret', 'ru')
  await access.setSubscription('-1007', '1', true, 'en')

  const previous = store.readChats()

  const home = await store.updateHome('1', record => {
    record.eventSequence = 2

    return record
  })

  const clear = access.clearChats('-1007')

  const denied = assert.rejects(
    access.setSubscription('-1007', '1', true, 'en'),
    /Access denied/,
  )

  assert.equal(await clear, 1)
  await denied
  assert.equal(access.isAuthorized('-1007'), false)
  assert.equal(access.isSubscribed('-1007', '1'), false)
  assert.equal(access.isAuthorized('8'), true)
  assert.equal(await access.clearChats('-1007'), 0)
  assert.equal(await access.clearChats('all'), 1)
  await store.close()
  store = await openMonitorStore({ directory, homeIds: ['1'] })
  access = make()
  await access.initialize()
  assert.deepEqual(store.readChats(), { ...previous, chats: {} })
  assert.deepEqual(store.readHome('1'), home)
  assert.equal(await access.authorize('-1007', 'secret', 'en'), 'authorized')
  assert.equal(access.isSubscribed('-1007', '1'), false)
})

test('group approval shares the grant write, keeps subscriptions and honors disabled access', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'monitor-group-'))
  const store = await openMonitorStore({ directory, homeIds: ['1'] })

  t.after(async () => {
    await store.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  const access = createChatAccess({
    store,
    secret: 'secret',
    homes: [{ id: '1' }],
  })

  assert.equal(await access.authorizeGroup('-1007', 'en'), 'disabled')
  await access.initialize()
  assert.equal(access.isAuthorized('-1007'), false)
  assert.equal(await access.authorizeGroup('-1007', 'ru'), 'authorized')
  assert.equal(access.isAuthorized('-1007'), true)
  assert.equal(store.readChats().chats['-1007'].locale, 'ru')

  await access.setSubscription('-1007', '1', true, 'ru')

  const subscription = store.readChats().chats['-1007'].subscriptions['1']

  assert.equal(await access.authorizeGroup('-1007', 'en'), 'authorized')
  assert.deepEqual(
    store.readChats().chats['-1007'].subscriptions['1'],
    subscription,
  )
  assert.equal(store.readChats().chats['-1007'].locale, 'en')
  assert.equal(access.isSubscribed('-1007', '1'), true)

  const disabled = createChatAccess({ store, secret: '', homes: [] })

  await disabled.initialize()
  assert.equal(await disabled.authorizeGroup('-1008', 'en'), 'disabled')
  assert.equal(store.readChats().chats['-1008'], undefined)
})

test('grant IDs separate a cleared grant from a later approval and legacy registries backfill', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'monitor-grant-'))

  let store = await openMonitorStore({ directory, homeIds: ['1'] })

  t.after(async () => {
    await store.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  const make = (secret = 'secret') =>
    createChatAccess({ store, secret, homes: [{ id: '1' }] })

  let access = make()

  await access.initialize()
  await access.authorize('7', 'secret', 'ru')
  await access.authorizeGroup('-1007', 'en')
  await access.setSubscription('7', '1', true, 'ru')
  await store.close()

  //
  //

  const file = path.join(directory, 'chats.json')

  const legacy = JSON.parse(await fs.readFile(file, 'utf8'))

  for (const chat of Object.values(legacy.chats)) {
    delete chat.grantId
  }

  legacy.chats['8'] = {
    authorizedGeneration: null,
    locale: 'en',
    subscriptions: {},
  }
  await fs.writeFile(file, JSON.stringify(legacy))

  store = await openMonitorStore({ directory, homeIds: ['1'] })
  access = make()
  assert.deepEqual(store.readChats(), legacy)
  assert.equal(access.captureGrant('7'), null)
  await access.initialize()

  const migrated = store.readChats()

  assert.equal(access.isAuthorized('7'), true)
  assert.equal(access.isAuthorized('-1007'), true)
  assert.equal(access.isAuthorized('8'), false)
  assert.equal(access.isSubscribed('7', '1'), true)
  assert.deepEqual(
    migrated.chats['7'].subscriptions,
    legacy.chats['7'].subscriptions,
  )
  assert.equal(migrated.chats['7'].locale, 'ru')
  assert.match(migrated.chats['7'].grantId, /^[0-9a-f-]{36}$/)
  assert.match(migrated.chats['-1007'].grantId, /^[0-9a-f-]{36}$/)
  assert.notEqual(migrated.chats['7'].grantId, migrated.chats['-1007'].grantId)
  assert.equal(migrated.chats['8'].grantId, null)

  //
  //

  const grant = access.captureGrant('7')

  assert.deepEqual(grant, {
    generation: migrated.generation,
    grantId: migrated.chats['7'].grantId,
  })
  assert.equal(access.isGrantCurrent('7', grant), true)
  assert.equal(access.isGrantCurrent('-1007', grant), false)
  assert.equal(access.captureGrant('9'), null)

  const group = access.captureGrant('-1007')

  await access.authorize('7', 'secret', 'en')
  await access.authorizeGroup('-1007', 'ru')
  assert.equal(access.isGrantCurrent('7', grant), true)
  assert.equal(access.isGrantCurrent('-1007', group), true)

  await access.clearChats('7')
  assert.equal(access.captureGrant('7'), null)
  assert.equal(access.isGrantCurrent('7', grant), false)
  await access.authorize('7', 'secret', 'en')
  assert.equal(access.isAuthorized('7'), true)
  assert.equal(access.isGrantCurrent('7', grant), false)
  assert.notEqual(access.captureGrant('7').grantId, grant.grantId)

  await access.clearChats('-1007')
  await access.authorizeGroup('-1007', 'en')
  assert.equal(access.isGrantCurrent('-1007', group), false)

  const current = access.captureGrant('7')

  access = make('rotated')
  await access.initialize()
  assert.equal(access.isGrantCurrent('7', current), false)
  assert.equal(store.readChats().chats['7'].grantId, null)
})
