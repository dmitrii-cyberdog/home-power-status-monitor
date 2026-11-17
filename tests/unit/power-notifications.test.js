import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

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
