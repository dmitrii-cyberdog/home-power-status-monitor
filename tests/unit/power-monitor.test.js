import assert from 'node:assert/strict'
import test from 'node:test'

import { createPowerMonitor } from '../../src/services/index.js'

test('offline streaks, unknown reset, identity replacement and coalescing', async () => {
  let status = 'offline'
  let serial = 'a'
  let calls = 0
  const monitor = createPowerMonitor(
    {
      failedChecks: 3,
      homes: [
        {
          id: '1',
          name: 'Home',
          offlineDeviceCount: 1,
          devices: [{ id: '1', name: 'Camera' }],
        },
      ],
    },
    {
      now: () => 0,
      createClient: () => ({
        observeDevices: async () => {
          calls++

          return [{ status, resolvedSerial: serial }]
        },
      }),
    },
  )

  const first = (await monitor.check()).homes[0]

  assert.equal(first.status, 'unknown')
  assert.equal(first.devices[0].offlineStreak, 1)
  assert.equal(first.devices[0].offlineChecks, 3)
  await Promise.all([monitor.check(), monitor.check()])
  assert.equal(calls, 2)
  const off = (await monitor.check()).homes[0]

  assert.equal(off.status, 'off')
  serial = 'b'
  assert.equal((await monitor.check()).homes[0].status, 'unknown')
  status = 'online'
  assert.equal((await monitor.check()).homes[0].status, 'on')
  status = 'unknown'
  assert.equal((await monitor.check()).homes[0].lastInferredStatus, 'on')
  assert.equal(off.status, 'off')
})

test('thresholds and recovery use complementary online evidence', async () => {
  for (const threshold of [1, 2, -1]) {
    let observations = ['offline', 'online']
    const monitor = createPowerMonitor(
      {
        failedChecks: 1,
        homes: [
          {
            id: '1',
            name: 'Home',
            offlineDeviceCount: threshold,
            devices: [
              { id: '1', name: 'A' },
              { id: '2', name: 'B' },
            ],
          },
          { id: '2', name: 'Empty', devices: [], offlineDeviceCount: 1 },
        ],
      },
      {
        createClient: () => ({
          observeDevices: async () => observations.map(status => ({ status })),
        }),
        now: () => 0,
      },
    )
    const first = (await monitor.check()).homes

    assert.equal(first[0].status, threshold === 1 ? 'off' : 'on')
    assert.equal(first[1].status, 'unknown')
    observations = ['unknown', 'online']
    assert.equal(
      (await monitor.check()).homes[0].status,
      threshold === 1 ? 'unknown' : 'on',
    )
    observations = ['offline', 'offline']
    assert.equal((await monitor.check()).homes[0].status, 'off')
  }
})

test('unknown observations preserve only allowlisted device diagnostics', async () => {
  let errorCode = 'auth_failed'
  let reject = false

  const monitor = createPowerMonitor(
    {
      failedChecks: 3,
      homes: [
        {
          id: '1',
          name: 'Home',
          offlineDeviceCount: 1,
          devices: [{ id: '1', name: 'Camera' }],
        },
      ],
    },
    {
      now: () => 0,
      createClient: () => ({
        observeDevices: async () => {
          if (reject) {
            throw new Error('secret-sentinel')
          }

          return [{ status: 'unknown', errorCode }]
        },
      }),
    },
  )

  assert.equal(
    (await monitor.check()).homes[0].devices[0].errorCode,
    'auth_failed',
  )
  errorCode = 'secret-sentinel'
  assert.equal(
    (await monitor.check()).homes[0].devices[0].errorCode,
    'invalid_response',
  )
  reject = true
  assert.equal(
    (await monitor.check()).homes[0].devices[0].errorCode,
    'transport_error',
  )
})
