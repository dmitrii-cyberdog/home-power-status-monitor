import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createPowerStatusTask } from '../../src/cron/checkPowerStatus/cron.js'
import { createMonitorRuntime } from '../../src/services/monitorRuntime.js'

test('runtime initializes storage/access before checks and releases ownership', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'monitor-runtime-'))

  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const config = {
    monitor: { homes: [], failedChecks: 3, intervalSeconds: 60 },
    botSettings: { accessSecret: '' },
  }
  const runtime = await createMonitorRuntime({ config, directory })

  assert.equal(runtime.access.isAuthorized('1'), false)
  assert.deepEqual(await runtime.homeMonitor.check(), [])
  await assert.rejects(createMonitorRuntime({ config, directory }), /ownership/)
  await runtime.close()
  await (await createMonitorRuntime({ config, directory })).close()
})

test('scheduler waits one interval and skips busy ticks', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })

  let calls = 0
  let finish
  const task = createPowerStatusTask({
    intervalSeconds: 60,
    log: { error() {} },
    operation: () => {
      calls++
      return new Promise(resolve => {
        finish = resolve
      })
    },
  })

  t.after(() => task.destroy())
  assert.equal(calls, 0)
  t.mock.timers.tick(60000)
  await Promise.resolve()
  assert.equal(calls, 1)
  t.mock.timers.tick(120000)
  assert.equal(calls, 1)
  const running = task.execute()

  finish()
  await running
  t.mock.timers.tick(60000)
  await Promise.resolve()
  assert.equal(calls, 2)
  finish()
  await task.stop()
})

test('access initialization write failure closes storage before exposing a runtime', async () => {
  let closed = false
  let polls = 0

  await assert.rejects(
    createMonitorRuntime({
      config: {
        monitor: { homes: [], intervalSeconds: 60 },
        botSettings: { accessSecret: '' },
      },
      directory: 'unused',
      openStore: async () => ({
        readChats: () => ({ verifier: null, generation: null, chats: {} }),
        updateChats: async () => {
          throw new Error('disk')
        },
        close: async () => {
          closed = true
        },
      }),
      monitor: {
        check: async () => {
          polls++
        },
      },
    }),
    /disk/,
  )
  assert.equal(closed, true)
  assert.equal(polls, 0)
})

test('failed manual task releases its guard for the next check', async t => {
  let calls = 0
  const task = createPowerStatusTask({
    intervalSeconds: 60,
    log: { error() {} },
    operation: async () => {
      calls++
      if (calls === 1) {
        throw new Error('provider')
      }
      return 'recovered'
    },
  })

  t.after(() => task.destroy())
  await assert.rejects(task.execute(), /provider/)
  assert.equal(await task.execute(), 'recovered')
})

test('interval task coalesces manual work and stop drains accepted persistence', async () => {
  let finish
  let calls = 0
  const task = createPowerStatusTask({
    intervalSeconds: 60,
    log: { error() {} },
    operation: () => {
      calls++
      return new Promise(resolve => {
        finish = resolve
      })
    },
  })
  const first = task.execute()
  const second = task.execute()

  await Promise.resolve()
  assert.equal(calls, 1)
  const stopped = task.stop()

  await assert.rejects(task.execute(), /stopped/)
  finish('done')
  assert.equal(await first, 'done')
  assert.equal(await second, 'done')
  await stopped
  await task.destroy()
})
