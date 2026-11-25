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
    record.lastDecisiveStatus = 'on'
    record.stateSince = new Date(0).toISOString()
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
    ['1', '<b>⚡ ✅ ru:monitor_restored</b>'],
    ['1', '<b>⚡ ❌ ru:monitor_outage</b>'],
    ['2', '<b>⚡ ✅ en:monitor_restored</b>'],
    ['2', '<b>⚡ ❌ en:monitor_outage</b>'],
  ])
  assert.deepEqual(store.readHome('1').pendingDeliveries, [])
})

for (const [notificationMode, expected] of [
  [1, ['on']],
  [2, ['off']],
]) {
  test(`mode ${notificationMode} discards excluded pending alerts even when delivery fails`, async t => {
    const store = await fixture(t)

    const dispatcher = createPowerNotifications({
      store,
      homes: [{ id: '1', notificationMode }],
      access: {
        recipients: () => [],
        isDeliveryAllowed: () => true,
        getLocale: () => 'en',
      },
      renderAlert: delivery => [delivery.state],
      send: async () => {
        throw new Error('Temporary network failure')
      },
    })

    await dispatcher.flush()

    assert.deepEqual(
      store.readHome('1').pendingDeliveries.map(delivery => delivery.state),
      [...expected, ...expected],
    )
  })
}

for (const [notificationIntervalMode, expected] of [
  [1, ['on', 'on']],
  [2, ['off']],
  [3, ['on', 'on', 'off', 'unknown']],
]) {
  test(`interval mode ${notificationIntervalMode} filters repeated status independently of alerts`, async t => {
    const store = await fixture(t)

    const alerts = []
    const updates = []

    let now = 0
    let status = 'on'

    const dispatcher = createPowerNotifications({
      store,
      homes: [{ id: '1', notificationMode: 1, notificationIntervalMode }],
      access: {
        recipients: () => [{ chatId: '1' }],
        getIntervalMinutes: () => 1,
        isDeliveryAllowed: delivery => delivery.chatId === '1',
        getLocale: () => 'en',
      },
      now: () => now,
      getStatuses: () => [{ id: '1', status }],
      renderAlert: delivery => [delivery.state],
      renderStatus: snapshot => ['status:' + snapshot.status],
      send: async (_chatId, body) => {
        if (body.startsWith('status:')) {
          updates.push(body.slice('status:'.length))
        } else {
          alerts.push(body)
        }
      },
    })

    await dispatcher.flush()

    for (const state of ['on', 'on', 'off', 'off', 'unknown']) {
      now += 60000

      if (state !== 'unknown' && state !== status) {
        await store.updateHome('1', record => {
          record.lastDecisiveStatus = state
          record.stateSince = new Date(now).toISOString()

          return record
        })
      }

      status = state

      await dispatcher.flush({ includeAlerts: false })
    }

    assert.deepEqual(alerts, ['on'])
    assert.deepEqual(updates, expected)
    assert.deepEqual(store.readHome('1').pendingDeliveries, [])
  })
}

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
      recipients: () => [],
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
      recipients: () => [],
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
      recipients: () => [],
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

test('shutdown reports a periodic write failure with a queued alert tick', async t => {
  const store = await fixture(t)

  const write = Promise.withResolvers()
  const started = Promise.withResolvers()

  let now = 0

  const dispatcher = createPowerNotifications({
    store,
    homes: [{ id: '1', notificationIntervalMinutes: 1 }],
    now: () => now,
    getStatuses: () => [{ id: '1' }],
    access: {
      recipients: () => [{ chatId: '1' }],
      getIntervalMinutes: () => 1,
      isDeliveryAllowed: () => true,
      getLocale: () => 'en',
      disableSubscriptions: () => {
        started.resolve()

        return write.promise
      },
    },
    renderStatus: () => ['status'],
    send: async () => {
      throw {
        error_code: 403,
        description: 'Forbidden: bot was blocked by the user',
      }
    },
  })

  await dispatcher.flush({ includeAlerts: false })
  now = 60000

  const periodic = dispatcher.flush({ includeAlerts: false })

  await started.promise

  const alertTick = dispatcher.flush()

  dispatcher.stop()

  const outcomes = Promise.allSettled([periodic, alertTick, dispatcher.drain()])

  write.reject(new Error('disk'))

  for (const result of await outcomes) {
    assert.equal(result.status, 'rejected')
    assert.match(result.reason.message, /Notification pass persistence failed/)
  }
})

const runtimeFixture = async (
  t,
  homeOptions = {},
  now,
  intervalSeconds = 60,
) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'monitor-guard-'))

  let store

  const errors = []

  const runtime = await createMonitorRuntime({
    config: {
      monitor: {
        homes: [{ id: '1', name: 'Home', ...homeOptions }],
        failedChecks: 3,
        intervalSeconds,
      },
      botSettings: { accessSecret: 'secret' },
    },
    directory,
    now,
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
    record.lastDecisiveStatus = 'off'
    record.stateSince = new Date(0).toISOString()
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
  assert.equal(sent[0].payload.parse_mode, 'HTML')
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

test('queued recurring updates use the current locale and discard an obsolete subscription', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })

  let now = 0

  const { access, errors, runtime, sent, store } = await runtimeFixture(
    t,
    { timeZone: 'GMT+2', notificationIntervalMinutes: 1 },
    () => now,
  )

  runtime.startNotifications()
  await runtime.drainNotifications()

  for (const change of [
    () => access.setLocale('7', 'ru'),
    async () => {
      await access.setSubscription('7', '1', false)
      await access.setSubscription('7', '1', true)
    },
  ]) {
    const release = blockQueue()

    try {
      now += 60000
      t.mock.timers.tick(60000)
      await new Promise(resolve => {
        setImmediate(resolve)
      })
      await change()
    } finally {
      await release()
    }

    await runtime.drainNotifications()
  }

  assert.equal(sent.length, 2)
  assert.equal(sent[1].payload.parse_mode, 'HTML')
  assert.match(sent[1].payload.text, /\p{Script=Cyrillic}/u)
  assert.deepEqual(store.readHome('1').pendingDeliveries, [])
  assert.deepEqual(errors, [])
})

test('recurring ticks leave durable alerts for their configured polling cadence', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })

  let now = 0

  const { runtime, sent, store } = await runtimeFixture(
    t,
    { notificationIntervalMinutes: 1 },
    () => now,
    300,
  )

  const [delivery] = store.readHome('1').pendingDeliveries

  runtime.startNotifications()
  await runtime.drainNotifications()

  await store.updateHome('1', record => {
    record.pendingDeliveries = [delivery]

    return record
  })

  now += 60000
  t.mock.timers.tick(60000)
  await runtime.drainNotifications()

  assert.equal(sent.length, 2)
  assert.equal(sent.at(-1).payload.parse_mode, 'HTML')
  assert.equal(store.readHome('1').pendingDeliveries.length, 1)
})

test('a full alert tick during a periodic send drains the pending alert', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })

  let now = 0

  const { runtime, sent, store } = await runtimeFixture(
    t,
    { notificationIntervalMinutes: 1 },
    () => now,
    90,
  )

  const [delivery] = store.readHome('1').pendingDeliveries

  runtime.startNotifications()
  await runtime.drainNotifications()

  await store.updateHome('1', record => {
    record.pendingDeliveries = [delivery]

    return record
  })

  const release = blockQueue()

  try {
    now = 60000
    t.mock.timers.tick(60000)

    now = 90000
    t.mock.timers.tick(30000)
  } finally {
    await release()
  }

  await runtime.drainNotifications()

  assert.deepEqual(sent.map(isTransitionAlert), [true, false, true])
  assert.deepEqual(store.readHome('1').pendingDeliveries, [])
})

const isTransitionAlert = call => call.payload.text.startsWith('<b>⚡ ')

const periodicSends = (sent, chatId) =>
  sent.filter(
    call =>
      !isTransitionAlert(call) &&
      String(call.payload.chat_id) === String(chatId),
  ).length

const advanceMinutes = async (t, minutes, clock, runtime) => {
  for (let minute = 0; minute < minutes; minute++) {
    clock.now += 60000
    t.mock.timers.tick(60000)
    await runtime.drainNotifications()
  }
}

test('each chat follows its own recurring interval', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })

  const clock = { now: 0 }

  const { access, runtime, sent } = await runtimeFixture(
    t,
    { notificationIntervalMinutes: 1 },
    () => clock.now,
  )

  await access.authorize('8', 'secret', 'en')
  await access.setSubscription('8', '1', true)
  await access.setInterval('8', '1', 5)

  runtime.startNotifications()
  await runtime.drainNotifications()

  await advanceMinutes(t, 5, clock, runtime)

  assert.equal(periodicSends(sent, 7), 5)
  assert.equal(periodicSends(sent, 8), 1)
})

test('changing an interval keeps the schedule anchored to the home state', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })

  const clock = { now: 0 }

  const { access, runtime, sent } = await runtimeFixture(
    t,
    { notificationIntervalMinutes: 1 },
    () => clock.now,
  )

  runtime.startNotifications()
  await runtime.drainNotifications()

  await advanceMinutes(t, 1, clock, runtime)

  assert.equal(periodicSends(sent, 7), 1)

  await access.setInterval('7', '1', 5)

  await advanceMinutes(t, 3, clock, runtime)

  assert.equal(periodicSends(sent, 7), 1)

  await advanceMinutes(t, 1, clock, runtime)

  assert.equal(periodicSends(sent, 7), 2)
})

test('reminders follow the saved state across restoration and worker restart', async t => {
  const store = await fixture(t)
  const sent = []

  const minute = 60000

  let now = 0

  const createDispatcher = () =>
    createPowerNotifications({
      store,
      homes: [{ id: '1' }],
      access: {
        recipients: () => [{ chatId: '1' }],
        getIntervalMinutes: () => 1440,
        isDeliveryAllowed: () => true,
        getLocale: () => 'en',
      },
      now: () => now,
      getStatuses: () => [
        { id: '1', status: store.readHome('1').lastDecisiveStatus },
      ],
      renderStatus: status => [status.status],
      send: async (_chatId, body) => sent.push(body),
    })

  let dispatcher = createDispatcher()

  const flushAt = async minutes => {
    now = minutes * minute

    await dispatcher.flush({ includeAlerts: false })
  }

  const changeState = (state, minutes) =>
    store.updateHome('1', record => {
      record.lastDecisiveStatus = state
      record.stateSince = new Date(minutes * minute).toISOString()

      return record
    })

  await flushAt(0)
  await changeState('off', 1309)
  await flushAt(1309)
  await flushAt(1440)
  assert.deepEqual(sent, [])

  await flushAt(2749)
  assert.deepEqual(sent, ['off'])

  dispatcher = createDispatcher()

  await flushAt(2750)
  assert.deepEqual(sent, ['off'])

  await flushAt(4189)
  assert.deepEqual(sent, ['off', 'off'])

  await changeState('on', 4190)
  await flushAt(4190)
  await flushAt(5629)
  assert.deepEqual(sent, ['off', 'off'])

  await flushAt(5630)
  assert.deepEqual(sent, ['off', 'off', 'on'])
})

test('interval zero stops recurring updates but keeps alerts', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })

  const clock = { now: 0 }

  const { access, runtime, sent, store } = await runtimeFixture(
    t,
    { notificationIntervalMinutes: 1 },
    () => clock.now,
  )

  await access.setInterval('7', '1', 0)

  runtime.startNotifications()
  await runtime.drainNotifications()

  await advanceMinutes(t, 3, clock, runtime)

  assert.equal(sent.length, 1)
  assert.equal(periodicSends(sent, 7), 0)
  assert.deepEqual(store.readHome('1').pendingDeliveries, [])
})

test('a chat interval enables recurring status in restoration-only mode', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })

  const clock = { now: 0 }

  const { access, runtime, sent, store } = await runtimeFixture(
    t,
    { notificationMode: 1 },
    () => clock.now,
    300,
  )

  await access.setInterval('7', '1', 5)

  runtime.startNotifications()
  await runtime.drainNotifications()

  assert.deepEqual(sent, [])
  assert.deepEqual(store.readHome('1').pendingDeliveries, [])

  await advanceMinutes(t, 5, clock, runtime)

  assert.equal(periodicSends(sent, 7), 1)
})
