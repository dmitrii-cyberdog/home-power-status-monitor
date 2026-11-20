import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  createHomeMonitor,
  openMonitorStore,
  createPowerMonitor,
  createPowerNotifications,
  monitorMessages,
} from '../../src/services/index.js'

test('committed rounds coalesce and deliveries retry independently without replay', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'monitor-round-'))
  const store = await openMonitorStore({ directory, homeIds: ['1'] })

  t.after(async () => {
    await store.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  let calls = 0
  const homes = [{ id: '1', name: 'Home' }]
  const access = {
    recipients: () =>
      ['1', '2'].map(chatId => ({
        chatId,
        generation: 'g',
        subscriptionId: 's',
        locale: 'en',
      })),
    isDeliveryAllowed: () => true,
    getLocale: () => 'en',
  }
  const coordinator = createHomeMonitor({
    monitor: {
      check: async () => {
        calls++
        return {
          homes: [
            { id: '1', status: 'off', observedAt: new Date(0).toISOString() },
          ],
        }
      },
    },
    store,
    access,
    homes,
    runId: 'r',
    intervalSeconds: 60,
    now: () => 0,
  })

  await Promise.all([coordinator.check(), coordinator.check({ force: true })])
  assert.equal(calls, 1)
  assert.equal(store.readHome('1').pendingDeliveries.length, 2)
  let fail = true
  const sent = []
  const notifications = createPowerNotifications({
    store,
    access,
    homes,
    renderAlert: (delivery, home) =>
      monitorMessages.renderPowerAlert(delivery, home, key => key),
    send: async chatId => {
      if (chatId === '1' && fail) {
        throw new Error('temporary')
      }
      sent.push(chatId)
    },
  })

  await notifications.flush()
  assert.deepEqual(sent, ['2'])
  assert.equal(store.readHome('1').pendingDeliveries.length, 1)
  fail = false
  await notifications.flush()
  assert.equal(store.readHome('1').pendingDeliveries.length, 0)
  notifications.stop()
  await notifications.drain()
})

const cadenceFixture = async (
  t,
  { intervalSeconds = 60, latency = 0, updateHome } = {},
) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'monitor-cadence-'))

  const clock = { wall: 0, monotonic: 0 }

  const state = {
    calls: 0,
    fail: false,
    powerStatus: 'unknown',
    store: await openMonitorStore({ directory, homeIds: ['1'] }),
  }

  t.after(async () => {
    await state.store.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  const create = (runId = 'r') =>
    createHomeMonitor({
      store: updateHome
        ? { readHome: id => state.store.readHome(id), updateHome }
        : state.store,
      homes: [{ id: '1', name: 'Home' }],
      access: { recipients: () => [] },
      monitor: {
        check: async () => {
          state.calls++

          if (state.fail) {
            throw new Error('provider unavailable')
          }

          // The provider stamps observations after its response latency.
          advance(latency)

          return {
            homes: [
              {
                id: '1',
                status: state.powerStatus,
                observedAt: new Date(clock.wall).toISOString(),
              },
            ],
          }
        },
      },
      runId,
      intervalSeconds,
      now: () => clock.wall,
      monotonicNow: () => clock.monotonic,
    })

  const advance = ms => {
    clock.wall += ms
    clock.monotonic += ms
  }

  const reopen = async () => {
    await state.store.close()
    state.store = await openMonitorStore({ directory, homeIds: ['1'] })
  }

  return { clock, state, create, advance, reopen }
}
//
//

test('concurrent status, cron and forced requests share one round', async t => {
  const { state, create } = await cadenceFixture(t)

  const coordinator = create()

  await Promise.all([
    coordinator.check(),
    coordinator.check(),
    coordinator.check({ force: true }),
  ])
  assert.equal(state.calls, 1)
})

test('ordinary requests wait for the 60-second floor; force bypasses it', async t => {
  const { state, create, advance } = await cadenceFixture(t)

  const coordinator = create()

  await coordinator.check()
  assert.equal(state.calls, 1)

  advance(58999)

  const [cached] = await coordinator.check()

  assert.equal(state.calls, 1)
  assert.equal(cached.observedAt, new Date(0).toISOString())

  advance(1)
  await coordinator.check()
  assert.equal(state.calls, 2)

  await coordinator.check({ force: true })
  assert.equal(state.calls, 3)
})

for (const intervalSeconds of [60, 120]) {
  test(`cron ticks every ${intervalSeconds} seconds poll each time despite latency and jitter`, async t => {
    const { clock, state, create } = await cadenceFixture(t, {
      intervalSeconds,
      latency: 1500,
    })

    const coordinator = create()

    for (let tick = 0; tick < 4; tick++) {
      const at = tick * intervalSeconds * 1000

      clock.wall = at
      clock.monotonic = Math.max(0, at - 0.5)

      await coordinator.check()
      assert.equal(state.calls, tick + 1)
    }
  })
}

test('short configured intervals use the poll floor for freshness and accounting', async t => {
  const { state, create, advance } = await cadenceFixture(t, {
    intervalSeconds: 10,
  })

  state.powerStatus = 'off'
  const coordinator = create()

  await coordinator.check()
  advance(45000)

  const [cached] = await coordinator.check()

  assert.equal(state.calls, 1)
  assert.equal(cached.status, 'off')

  advance(15000)

  const [next] = await coordinator.check()

  assert.equal(state.calls, 2)
  assert.equal(next.stats.offMs, 60000)
  assert.equal(next.durationMs, 60000)

  advance(120000)
  assert.equal(coordinator.getStatuses()[0].stale, false)

  advance(1)
  assert.equal(coordinator.getStatuses()[0].stale, true)
})

test('a longer configured interval sets the minimum cadence', async t => {
  const { state, create, advance } = await cadenceFixture(t, {
    intervalSeconds: 120,
  })

  const coordinator = create()

  await coordinator.check()
  advance(60000)
  await coordinator.check()
  assert.equal(state.calls, 1)

  advance(58999)
  await coordinator.check()
  assert.equal(state.calls, 1)

  advance(1)
  await coordinator.check()
  assert.equal(state.calls, 2)
})

test('the in-process cooldown holds even when wall-clock samples look stale', async t => {
  const { clock, state, create } = await cadenceFixture(t)

  const coordinator = create()

  await coordinator.check()
  clock.wall += 3600000
  clock.monotonic += 1000
  await coordinator.check()
  assert.equal(state.calls, 1)

  clock.wall -= 7200000
  await coordinator.check()
  assert.equal(state.calls, 1)
})

test('the first check after restart polls despite a recent saved sample', async t => {
  const { clock, state, create, advance, reopen } = await cadenceFixture(t)

  await create().check()
  assert.equal(state.calls, 1)

  await state.store.updateHome('1', record => ({
    ...record,
    lastDecisiveStatus: 'off',
    lastDecisiveAt: new Date(clock.wall).toISOString(),
    lastOff: {
      detectedAt: new Date(clock.wall - 60000).toISOString(),
      baseline: false,
    },
  }))

  const saved = state.store.readHome('1')

  await reopen()
  clock.monotonic = 0
  advance(30000)

  const coordinator = create('second-run')
  const [status] = await coordinator.check()

  assert.equal(state.calls, 2)
  assert.equal(status.observedAt, new Date(clock.wall).toISOString())
  assert.equal(status.lastInferredStatus, 'off')
  assert.equal(status.lastInferredAt, saved.lastDecisiveAt)
  assert.deepEqual(status.lastOff, saved.lastOff)

  await coordinator.check()
  assert.equal(state.calls, 2)

  await reopen()
  state.powerStatus = 'off'

  const [confirmed] = await create('third-run').check()

  assert.equal(state.calls, 3)
  assert.equal(confirmed.status, 'off')
  assert.equal(confirmed.lastInferredAt, new Date(clock.wall).toISOString())
  assert.deepEqual(confirmed.lastOff, saved.lastOff)
  assert.equal(confirmed.durationMs, null)
})

test('a failed provider round still applies the cooldown', async t => {
  const { state, create, advance } = await cadenceFixture(t)

  const coordinator = create()

  state.fail = true
  await assert.rejects(coordinator.check(), /provider unavailable/)

  const before = state.store.readHome('1')

  for (let index = 0; index < 5; index++) {
    advance(10000)
    await coordinator.check()
  }

  assert.equal(state.calls, 1)
  assert.deepEqual(state.store.readHome('1'), before)

  advance(10000)
  await assert.rejects(coordinator.check(), /provider unavailable/)
  assert.equal(state.calls, 2)
})

test('a failed store write still applies the cooldown', async t => {
  let writes = 0

  const { state, create, advance } = await cadenceFixture(t, {
    updateHome: async () => {
      writes++

      throw new Error('disk full')
    },
  })

  const coordinator = create()

  await assert.rejects(coordinator.check(), /persistence failed/)

  for (let index = 0; index < 5; index++) {
    advance(10000)
    await coordinator.check()
  }

  assert.equal(state.calls, 1)
  assert.equal(writes, 1)
  assert.equal(state.store.readHome('1').sample, null)
})

test('cached reads never advance inference or add another alert', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'monitor-cached-'))
  const store = await openMonitorStore({ directory, homeIds: ['1'] })

  t.after(async () => {
    await store.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  let now = 0

  let calls = 0

  const homes = [
    {
      id: '1',
      name: 'Home',
      offlineDeviceCount: 1,
      devices: [{ id: '1', name: 'Cam' }],
    },
  ]

  const monitor = createPowerMonitor(
    { failedChecks: 2, homes },
    {
      now: () => now,
      createClient: () => ({
        observeDevices: async () => {
          calls++

          return [{ status: calls === 1 ? 'online' : 'offline' }]
        },
      }),
    },
  )

  const coordinator = createHomeMonitor({
    monitor,
    store,
    homes,
    access: {
      recipients: () => [
        { chatId: '1', generation: 'g', subscriptionId: 's', locale: 'en' },
      ],
    },
    runId: 'r',
    intervalSeconds: 60,
    now: () => now,
    monotonicNow: () => now,
  })

  await coordinator.check()

  for (let round = 0; round < 2; round++) {
    now += 60000
    await coordinator.check()
  }

  const committed = store.readHome('1')

  assert.equal(committed.sample.status, 'off')
  assert.equal(committed.pendingDeliveries.length, 1)

  for (let index = 0; index < 5; index++) {
    now += 10000
    await coordinator.check()
  }

  assert.equal(calls, 3)
  assert.deepEqual(store.readHome('1'), committed)
})

test('online baseline commits decisive fields; unknown diagnostics stay transient', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'monitor-online-'))
  const store = await openMonitorStore({ directory, homeIds: ['1'] })

  t.after(async () => {
    await store.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  let status = 'online'
  let now = 0
  const warnings = []
  const homes = [
    {
      id: '1',
      name: 'Home',
      offlineDeviceCount: 1,
      devices: [{ id: '1', name: 'Camera' }],
    },
  ]
  const monitor = createPowerMonitor(
    { failedChecks: 3, homes },
    {
      now: () => now,
      createClient: () => ({
        observeDevices: async () => [
          {
            status,
            errorCode: status === 'unknown' ? 'auth_failed' : undefined,
          },
        ],
      }),
    },
  )
  const coordinator = createHomeMonitor({
    monitor,
    store,
    homes,
    access: { recipients: () => [] },
    runId: 'r',
    intervalSeconds: 60,
    now: () => now,
    monotonicNow: () => now,
    log: { warning: (...args) => warnings.push(args) },
  })

  await coordinator.check()
  const baseline = store.readHome('1')

  assert.equal(baseline.lastDecisiveStatus, 'on')
  assert.equal(baseline.lastDecisiveAt, new Date(0).toISOString())
  assert.deepEqual(baseline.lastOn, {
    detectedAt: new Date(0).toISOString(),
    baseline: true,
  })
  assert.equal(baseline.stateSince, new Date(0).toISOString())
  assert.equal(baseline.lastOff, null)
  status = 'unknown'
  now = 60000
  const [unknown] = await coordinator.check()

  assert.equal(unknown.status, 'unknown')
  assert.equal(unknown.devices[0].errorCode, 'auth_failed')
  assert.equal(coordinator.getStatuses()[0].devices[0].errorCode, 'auth_failed')
  assert.deepEqual(warnings, [
    [
      'Device observation unavailable',
      { homeId: '1', deviceId: '1', errorCode: 'auth_failed' },
    ],
  ])
  assert.equal(store.readHome('1').lastDecisiveStatus, 'on')
  assert.equal(Object.hasOwn(store.readHome('1'), 'devices'), false)
  status = 'offline'

  for (let index = 0; index < 3; index++) {
    now += 60000
    await coordinator.check()
    assert.equal(
      store.readHome('1').sample.status,
      index === 2 ? 'off' : 'unknown',
    )
  }

  assert.equal(
    store.readHome('1').lastOff.detectedAt,
    new Date(now).toISOString(),
  )
  status = 'online'
  now += 60000
  await coordinator.check()
  assert.equal(store.readHome('1').lastDecisiveStatus, 'on')
})
