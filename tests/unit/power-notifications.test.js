import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createChatAccess } from '../../src/services/chatAccess.js'
import { openMonitorStore } from '../../src/services/monitorStore.js'
import { createPowerNotifications } from '../../src/services/powerNotifications.js'

const fixture = async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'monitor-alert-'))
  const store = await openMonitorStore({ directory, homeIds: ['1'] })

  t.after(async () => {
    await store.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  await store.updateHome('1', record => {
    record.eventSequence = 2
    record.pendingDeliveries = [1, 2].flatMap(sequence =>
      ['1', '2'].map(chatId => ({
        eventId: `1:${sequence}`,
        sequence,
        chatId,
        generation: 'g',
        subscriptionId: 's',
        state: sequence === 1 ? 'off' : 'on',
        detectedAt: new Date(sequence * 60000).toISOString(),
        baseline: false,
        uncertain: false,
        locale: 'en',
      })),
    )

    return record
  })

  return store
}

test('cleared chat deliveries are discarded even after reauthorization and resubscription', async t => {
  const store = await fixture(t)
  const homes = [{ id: '1', name: 'Home' }]
  const access = createChatAccess({ store, secret: 'secret', homes })
  const sent = []

  await access.initialize()
  await access.authorize('1', 'secret', 'en')
  await access.setSubscription('1', '1', true, 'en')

  const [recipient] = access.recipients('1', store.readChats())

  await store.updateHome('1', record => {
    record.pendingDeliveries = record.pendingDeliveries
      .filter(delivery => delivery.chatId === '1')
      .map(delivery => ({ ...delivery, ...recipient }))

    return record
  })
  await access.clearChats('1')
  await access.authorize('1', 'secret', 'en')
  await access.setSubscription('1', '1', true, 'en')

  const dispatcher = createPowerNotifications({
    store,
    homes,
    access,
    translate: () => key => key,
    send: async chatId => sent.push(chatId),
  })

  await dispatcher.flush()
  assert.deepEqual(sent, [])
  assert.deepEqual(store.readHome('1').pendingDeliveries, [])
  assert.equal(access.isSubscribed('1', '1'), true)
})

test('a delayed delivery refusal cannot disable a subscription created after a clear', async t => {
  const store = await fixture(t)
  const homes = [{ id: '1', name: 'Home' }]
  const access = createChatAccess({ store, secret: 'secret', homes })

  await access.initialize()
  await access.authorize('1', 'secret', 'en')
  await access.setSubscription('1', '1', true, 'en')

  const [recipient] = access.recipients('1', store.readChats())

  await store.updateHome('1', record => {
    record.pendingDeliveries = [
      { ...record.pendingDeliveries[0], ...recipient },
    ]

    return record
  })

  const started = Promise.withResolvers()
  const result = Promise.withResolvers()

  const dispatcher = createPowerNotifications({
    store,
    homes,
    access,
    translate: () => key => key,
    send: () => {
      started.resolve()

      return result.promise
    },
  })

  const flushing = dispatcher.flush()

  await started.promise
  await access.clearChats('1')
  await access.authorize('1', 'secret', 'en')
  await access.setSubscription('1', '1', true, 'en')
  result.reject({
    error_code: 403,
    description: 'Forbidden: bot was blocked by the user',
  })
  await flushing
  assert.equal(access.isSubscribed('1', '1'), true)
})

test('failed earlier events block only their home/chat; revoked entries are removed', async t => {
  const store = await fixture(t)
  const sent = []
  const dispatcher = createPowerNotifications({
    store,
    homes: [{ id: '1', name: 'Home' }],
    access: { isDeliveryAllowed: delivery => delivery.chatId === '1' },
    translate: () => key => key,
    send: async (chatId, text) => {
      sent.push(text)
      throw new Error(chatId)
    },
  })

  await dispatcher.flush()
  assert.equal(sent.length, 1)
  assert.ok(
    store
      .readHome('1')
      .pendingDeliveries.every(delivery => delivery.chatId === '1'),
  )
})

test('stop drains the acknowledgement of a send already accepted', async t => {
  const store = await fixture(t)
  let accept
  let started
  const submitted = new Promise(resolve => {
    started = resolve
  })
  const dispatcher = createPowerNotifications({
    store,
    homes: [{ id: '1', name: 'Home' }],
    access: { isDeliveryAllowed: delivery => delivery.chatId === '1' },
    translate: () => key => key,
    send: () => {
      started()
      return new Promise(resolve => {
        accept = resolve
      })
    },
  })
  const flushing = dispatcher.flush()

  await submitted
  dispatcher.stop()
  accept()
  await flushing
  await dispatcher.drain()
  assert.ok(
    !store
      .readHome('1')
      .pendingDeliveries.some(
        delivery => delivery.chatId === '1' && delivery.sequence === 1,
      ),
  )
  assert.ok(
    store
      .readHome('1')
      .pendingDeliveries.some(
        delivery => delivery.chatId === '1' && delivery.sequence === 2,
      ),
  )
})

test('a failed subscription write cannot let drain abandon other accepted sends', async t => {
  const store = await fixture(t)
  let finish
  let entered
  const sending = new Promise(resolve => {
    entered = resolve
  })
  let drained = false
  const dispatcher = createPowerNotifications({
    store,
    homes: [{ id: '1', name: 'Home' }],
    access: {
      isDeliveryAllowed: () => true,
      disableSubscriptions: async () => {
        throw new Error('disk')
      },
    },
    translate: () => key => key,
    send: async chatId => {
      if (chatId === '1') {
        throw {
          error_code: 403,
          description: 'Forbidden: bot was blocked by the user',
        }
      }

      entered()
      await new Promise(resolve => {
        finish = resolve
      })
    },
  })
  const flushing = dispatcher.flush().catch(() => {})

  await sending
  const draining = dispatcher
    .drain()
    .catch(() => {})
    .then(() => {
      drained = true
    })

  await new Promise(resolve => {
    setImmediate(resolve)
  })
  assert.equal(drained, false)
  dispatcher.stop()
  finish()
  await flushing
  await draining
})
