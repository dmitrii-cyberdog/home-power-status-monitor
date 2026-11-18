import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { Api } from 'grammy'

import {
  configureTelegramApi,
  createChatAccess,
  createMonitorRuntime,
  openMonitorStore,
  createPowerNotifications,
  monitorMessages,
  telegramApiThrottler,
} from '../../src/services/index.js'

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

test('pending outage and restoration alerts use each chat preference on retry', async t => {
  const store = await fixture(t)
  const homes = [{ id: '1', name: 'Home' }]
  const access = createChatAccess({ store, secret: 'secret', homes })
  const sent = []

  await access.initialize()

  for (const chatId of ['1', '2']) {
    await access.authorize(chatId, 'secret', 'en')
    await access.setSubscription(chatId, '1', true)
  }

  const recipients = access.recipients('1', store.readChats())

  await store.updateHome('1', record => {
    record.pendingDeliveries = record.pendingDeliveries.map(delivery => ({
      ...delivery,
      ...recipients.find(recipient => recipient.chatId === delivery.chatId),
    }))

    return record
  })

  let fail = true

  const dispatcher = createPowerNotifications({
    store,
    homes,
    access,
    renderAlert: (delivery, home, locale) =>
      monitorMessages.renderPowerAlert(
        delivery,
        home,
        key => `${locale}:${key}`,
      ),
    send: async (chatId, body) => {
      if (fail) {
        throw new Error('Temporary network failure')
      }

      sent.push([chatId, body.split('\n')[0]])
    },
  })

  await dispatcher.flush()
  assert.equal(store.readHome('1').pendingDeliveries.length, 4)

  await access.setLocale('1', 'ru')
  fail = false
  await dispatcher.flush()
  assert.deepEqual(sent.sort(), [
    ['1', 'Home: ru:monitor_outage'],
    ['1', 'Home: ru:monitor_restored'],
    ['2', 'Home: en:monitor_outage'],
    ['2', 'Home: en:monitor_restored'],
  ])
  assert.deepEqual(store.readHome('1').pendingDeliveries, [])
})

test('cleared chat deliveries are discarded even after reauthorization and resubscription', async t => {
  const store = await fixture(t)
  const homes = [{ id: '1', name: 'Home' }]
  const access = createChatAccess({ store, secret: 'secret', homes })
  const sent = []

  await access.initialize()
  await access.authorize('1', 'secret', 'en')
  await access.setSubscription('1', '1', true)

  const [recipient] = access.recipients('1', store.readChats())

  await store.updateHome('1', record => {
    record.pendingDeliveries = record.pendingDeliveries
      .filter(delivery => delivery.chatId === '1')
      .map(delivery => ({ ...delivery, ...recipient }))

    return record
  })
  await access.clearChats('1')
  await access.authorize('1', 'secret', 'en')
  await access.setSubscription('1', '1', true)

  const dispatcher = createPowerNotifications({
    store,
    homes,
    access,
    renderAlert: (delivery, home) =>
      monitorMessages.renderPowerAlert(delivery, home, key => key),
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
  await access.setSubscription('1', '1', true)

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
    renderAlert: (delivery, home) =>
      monitorMessages.renderPowerAlert(delivery, home, key => key),
    send: () => {
      started.resolve()

      return result.promise
    },
  })

  const flushing = dispatcher.flush()

  await started.promise
  await access.clearChats('1')
  await access.authorize('1', 'secret', 'en')
  await access.setSubscription('1', '1', true)
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
    access: {
      isDeliveryAllowed: delivery => delivery.chatId === '1',
      getLocale: () => 'en',
    },
    renderAlert: (delivery, home) =>
      monitorMessages.renderPowerAlert(delivery, home, key => key),
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
    access: {
      isDeliveryAllowed: delivery => delivery.chatId === '1',
      getLocale: () => 'en',
    },
    renderAlert: (delivery, home) =>
      monitorMessages.renderPowerAlert(delivery, home, key => key),
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
      getLocale: () => 'en',
      disableSubscriptions: async () => {
        throw new Error('disk')
      },
    },
    renderAlert: (delivery, home) =>
      monitorMessages.renderPowerAlert(delivery, home, key => key),
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

const runtimeFixture = async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'monitor-guard-'))

  let store

  const errors = []

  const runtime = await createMonitorRuntime({
    config: {
      monitor: {
        homes: [{ id: '1', name: 'Home' }],
        failedChecks: 3,
        intervalSeconds: 60,
      },
      botSettings: { accessSecret: 'secret' },
    },
    directory,
    monitor: {},
    log: { error: message => errors.push(message) },
    openStore: async options => {
      store = await openMonitorStore(options)

      return store
    },
  })

  t.after(async () => {
    runtime.stopNotifications()
    await runtime.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  const { access } = runtime

  await access.authorize('7', 'secret', 'en')
  await access.setSubscription('7', '1', true)

  const [recipient] = access.recipients('1', store.readChats())

  await store.updateHome('1', record => {
    record.eventSequence = 1
    record.pendingDeliveries = [
      {
        eventId: '1:1',
        sequence: 1,
        state: 'off',
        detectedAt: new Date(60000).toISOString(),
        baseline: false,
        uncertain: false,
        ...recipient,
      },
    ]

    return record
  })

  const sent = []

  const api = new Api('1:fake')

  api.config.use(async (_previous, method, payload) => {
    sent.push({ method, payload })

    return {
      ok: true,
      result: { message_id: 1, date: 0, chat: { id: 7, type: 'private' } },
    }
  })
  configureTelegramApi(api)
  runtime.setTelegramApi(api)

  return { access, errors, runtime, sent, store }
}

const blockQueue = () => {
  const blockers = Array.from({ length: 10 }, () => Promise.withResolvers())

  const calls = blockers.map(blocker =>
    telegramApiThrottler(() => blocker.promise, 'sendMessage', {}),
  )

  return async () => {
    for (const blocker of blockers) {
      blocker.resolve()
    }

    await Promise.all(calls)
  }
}

for (const [name, revoke] of [
  ['a grant clear', access => access.clearChats('7')],
  [
    'a grant clear followed by a new grant and subscription',
    async access => {
      await access.clearChats('7')
      await access.authorize('7', 'secret', 'en')
      await access.setSubscription('7', '1', true)
    },
  ],
  [
    'an unsubscribe followed by a new subscription',
    async access => {
      await access.setSubscription('7', '1', false)
      await access.setSubscription('7', '1', true)
    },
  ],
]) {
  test(`a queued alert is dropped at dispatch after ${name}`, async t => {
    const { access, errors, runtime, sent, store } = await runtimeFixture(t)

    const release = blockQueue()

    runtime.startNotifications()
    await new Promise(resolve => {
      setImmediate(resolve)
    })
    await revoke(access)
    await release()
    await runtime.drainNotifications()

    assert.deepEqual(sent, [])
    assert.deepEqual(store.readHome('1').pendingDeliveries, [])
    assert.deepEqual(errors, [])
    assert.equal(access.isSubscribed('7', '1'), name !== 'a grant clear')
  })
}

test('an eligible alert is still delivered through the guarded queue', async t => {
  const { errors, runtime, sent, store } = await runtimeFixture(t)

  runtime.startNotifications()
  await runtime.drainNotifications()

  assert.equal(sent.length, 1)
  assert.equal(sent[0].method, 'sendMessage')
  assert.deepEqual(Object.keys(sent[0].payload).sort(), ['chat_id', 'text'])
  assert.equal(sent[0].payload.chat_id, '7')
  assert.deepEqual(store.readHome('1').pendingDeliveries, [])
  assert.deepEqual(errors, [])
})

test('an alert waiting in the Telegram queue uses a newly selected chat language', async t => {
  const { access, errors, runtime, sent, store } = await runtimeFixture(t)
  const release = blockQueue()

  runtime.startNotifications()
  await new Promise(resolve => {
    setImmediate(resolve)
  })

  try {
    await access.setLocale('7', 'ru')
  } finally {
    await release()
  }

  await runtime.drainNotifications()

  assert.equal(sent.length, 1)
  assert.match(sent[0].payload.text, /\p{Script=Cyrillic}/u)
  assert.deepEqual(store.readHome('1').pendingDeliveries, [])
  assert.deepEqual(errors, [])
})
