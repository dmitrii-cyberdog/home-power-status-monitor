import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createHomeMonitor } from '../../src/services/homeMonitor.js'
import { openMonitorStore } from '../../src/services/monitorStore.js'
import { createPowerMonitor } from '../../src/services/powerMonitor.js'
import { createPowerNotifications } from '../../src/services/powerNotifications.js'

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

  await Promise.all([
    coordinator.check({ onlyIfStale: true }),
    coordinator.check(),
  ])
  assert.equal(calls, 1)
  assert.equal(store.readHome('1').pendingDeliveries.length, 2)
  let fail = true
  const sent = []
  const notifications = createPowerNotifications({
    store,
    access,
    homes,
    translate: () => key => key,
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

test('scheduled checks use persisted sample freshness; explicit checks always refresh', async t => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'monitor-freshness-'),
  )

  let store = await openMonitorStore({ directory, homeIds: ['1'] })

  t.after(async () => {
    await store.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  let now = 0

  let calls = 0

  const create = () =>
    createHomeMonitor({
      store,
      homes: [{ id: '1', name: 'Home' }],
      access: { recipients: () => [] },
      monitor: {
        check: async () => {
          calls++

          return {
            homes: [
              {
                id: '1',
                status: 'unknown',
                observedAt: new Date(now).toISOString(),
              },
            ],
          }
        },
      },
      runId: String(calls),
      intervalSeconds: 60,
      now: () => now,
    })

  let coordinator = create()

  await coordinator.check({ onlyIfStale: true })
  assert.equal(calls, 1)
  now = 59999
  await coordinator.check({ onlyIfStale: true })
  assert.equal(calls, 1)
  now = 60000
  await coordinator.check({ onlyIfStale: true })
  assert.equal(calls, 2)
  now = 60001
  await coordinator.check()
  assert.equal(calls, 3)
  assert.equal(
    store.readHome('1').sample.observedAt,
    new Date(now).toISOString(),
  )
  await store.close()
  store = await openMonitorStore({ directory, homeIds: ['1'] })
  coordinator = create()
  await coordinator.check({ onlyIfStale: true })
  assert.equal(calls, 3)
  now += 60000
  await coordinator.check({ onlyIfStale: true })
  assert.equal(calls, 4)
  now -= 1000
  await coordinator.check({ onlyIfStale: true })
  assert.equal(calls, 5)
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
