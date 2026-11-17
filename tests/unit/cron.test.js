import assert from 'node:assert/strict'
import test from 'node:test'

import config from '../../src/config/config.js'

test('disabled cron loader creates no scheduled tasks', async () => {
  const { default: loadCron } = await import('../../src/loaders/cron.js')

  assert.deepEqual(await loadCron(), [])
})

test('enabled cron loader registers checkPowerStatus', async t => {
  const original = config.cron.checkPowerStatus.isEnabled

  t.after(() => {
    config.cron.checkPowerStatus.isEnabled = original
  })

  config.cron.checkPowerStatus.isEnabled = true

  const { default: loadCron } = await import('../../src/loaders/cron.js')
  const tasks = await loadCron({ homeMonitor: { check: async () => [] } })

  t.after(() => Promise.all(tasks.map(task => task.destroy())))

  assert.equal(tasks.length, 1)
  assert.equal(tasks[0].name, 'checkPowerStatus')
})

test('checkPowerStatus delegates to the shared coordinator', async t => {
  const { default: schedule } =
    await import('../../src/cron/checkPowerStatus/cron.js')
  const task = schedule({
    check: async (...args) => {
      assert.deepEqual(args, [])

      return []
    },
  })

  t.after(() => task.destroy())

  assert.equal(task.name, 'checkPowerStatus')
  assert.deepEqual(await task.execute(), [])
})

test('retired power check schedule is ignored', async t => {
  const original = config.cron.checkPowerStatus.startTemplate

  t.after(() => {
    config.cron.checkPowerStatus.startTemplate = original
  })

  config.cron.checkPowerStatus.startTemplate = 'invalid'

  const { default: schedule } =
    await import('../../src/cron/checkPowerStatus/cron.js')

  const task = schedule({ check: async () => [] })

  t.after(() => task.destroy())
  assert.deepEqual(await task.execute(), [])
})

test('cron drain waits for accepted operations', async () => {
  const { cron } = await import('../../src/services/cron.js')
  let finish
  let drained = false
  const pending = new Promise(resolve => {
    finish = resolve
  })
  const operation = cron.run({ error() {} }, 'test', () => pending)
  const drain = cron.drain().then(() => {
    drained = true
  })

  await Promise.resolve()

  assert.equal(drained, false)
  finish()
  await operation
  await drain
  assert.equal(drained, true)
})
