import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const fixture = fileURLToPath(
  new URL('../fixtures/shutdown.mjs', import.meta.url),
)
const runShutdown = scenario =>
  new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ['--experimental-vm-modules', fixture, scenario],
      { timeout: 3000, killSignal: 'SIGKILL' },
      (error, stdout, stderr) => {
        if (error && (error.killed || typeof error.code !== 'number')) {
          reject(error)
          return
        }

        const events = stdout
          .trim()
          .split('\n')
          .filter(Boolean)
          .map(line => JSON.parse(line))

        resolve({ code: error?.code || 0, events, stderr })
      },
    )
  })

//
//

test('shutdown drains accepted work, closes resources, flushes logs and exits despite leftover timers', async () => {
  const { code, events, stderr } = await runShutdown('normal')
  const names = events.map(item => item.event)
  const before = (first, second) => {
    assert.ok(names.indexOf(first) >= 0, `${first} missing`)
    assert.ok(
      names.indexOf(first) < names.indexOf(second),
      `${first} < ${second}`,
    )
  }

  assert.equal(code, 0, stderr)
  before('startup:abort', 'cron-stop:start')
  before('cron-stop:end', 'cron:start')
  before('cron:end', 'cron-destroy:start')
  before('cron-destroy:end', 'telegram:start')
  before('bot:end', 'telegram:start')
  before('telegram:end', 'agents:close')
  before('notifications:end', 'telegram:start')
  before('telegram:end', 'store:start')
  before('store:end', 'agents:close')
  before('agents:close', 'logger:start')
  before('logger:start', 'logger:end')
  assert.equal(names.filter(name => name === 'agents:close').length, 1)
  assert.equal(
    names.filter(name => name === 'Application shutdown started').length,
    1,
  )
  assert.ok(!names.includes('Application shutdown timed out'))
})

for (const component of ['cron', 'bot', 'telegram', 'notifications', 'store']) {
  test(`shutdown bounds a stuck ${component} drain and still closes resources`, async () => {
    const { code, events } = await runShutdown(component)
    const timeout = events.find(
      item => item.event === 'Application shutdown drain timed out',
    )

    assert.equal(code, 1)
    assert.ok(timeout)
    assert.equal(
      timeout.details.phase,
      component === 'telegram'
        ? 'telegram'
        : component === 'store'
          ? 'storage'
          : 'drain',
    )
    if (!['telegram', 'store'].includes(component)) {
      assert.deepEqual(timeout.details.pendingComponents, [component])
    }
    assert.ok(events.some(item => item.event === 'agents:close'))
    assert.ok(events.some(item => item.event === 'logger:end'))
    if (component !== 'store') {
      assert.ok(!events.some(item => item.event === 'store:start'))
    }
  })
}

for (const [component, phase] of [['logger', 'logger']]) {
  test(`shutdown's overall deadline also bounds stuck ${component}`, async () => {
    const { code, events } = await runShutdown(component)
    const timeout = events.find(
      item => item.event === 'Application shutdown timed out',
    )

    assert.equal(code, 1)
    assert.ok(timeout)
    assert.equal(timeout.details.phase, phase)
  })
}

for (const scenario of [
  'bot-error',
  'cron-stop-error',
  'cron-destroy-error',
  'agents-error',
  'logger-error',
  'fatal',
  'notifications-error',
]) {
  test(`shutdown exits with failure after ${scenario}`, async () => {
    const { code, events } = await runShutdown(scenario)

    assert.equal(code, 1)
    assert.ok(events.some(item => item.event === 'logger:start'))
    assert.ok(
      !events.some(item => item.event === 'Application shutdown timed out'),
    )
  })
}

test('shutdown during startup exits even if initialization never resolves', async () => {
  const { code, events } = await runShutdown('startup')

  assert.equal(code, 0)
  assert.ok(events.some(item => item.event === 'startup:abort'))
  assert.ok(events.some(item => item.event === 'agents:close'))
  assert.ok(events.some(item => item.event === 'logger:end'))
})

for (const scenario of ['ipc', 'ipc-repeat', 'startup-delayed']) {
  test(`PM2 ${scenario} drains once and closes storage before resources`, async () => {
    const { code, events } = await runShutdown(scenario)
    const names = events.map(item => item.event)

    assert.equal(code, 0)
    assert.equal(
      names.filter(name => name === 'Application shutdown started').length,
      1,
    )
    assert.equal(names.filter(name => name === 'store:start').length, 1)
    assert.ok(names.indexOf('store:end') < names.indexOf('agents:close'))
    assert.ok(names.indexOf('notifications:end') < names.indexOf('store:start'))
  })
}

test('unrelated PM2 messages do not initiate shutdown', async () => {
  const { code, events } = await runShutdown('ipc-ignored')
  const names = events.map(item => item.event)

  assert.equal(code, 0)
  assert.ok(
    names.indexOf('unrelated:sent') <
      names.indexOf('Application shutdown started'),
  )
})

test('PM2 shutdown bounds pending monitor initialization', async () => {
  const { code, events } = await runShutdown('startup-pending')

  assert.equal(code, 1)
  assert.ok(
    events.some(item => item.event === 'Application shutdown drain timed out'),
  )
  assert.ok(!events.some(item => item.event === 'store:start'))
})

test('failed monitor initialization is not reported as a notification drain failure', async () => {
  const { code, events } = await runShutdown('startup-rejected')

  assert.equal(code, 1)
  assert.equal(
    events.filter(item => item.event === 'Application startup failed').length,
    1,
  )
  assert.ok(
    !events.some(
      item => item.event === 'Application shutdown component failed',
    ),
  )
})

test('all PM2 manifests allow cleanup to finish before the 40-second kill limit', async () => {
  const { events } = await runShutdown('normal')
  const deadlines = events
    .filter(item => item.event === 'timer')
    .map(item => item.details)

  assert.deepEqual(deadlines, [35000, 30000])

  for (const filename of ['server.json', 'server_local.json']) {
    const manifest = JSON.parse(
      await readFile(new URL(`../../${filename}`, import.meta.url), 'utf8'),
    )

    for (const app of manifest.apps) {
      assert.equal(app.kill_timeout, 40000, filename)
      assert.ok(app.kill_timeout > Math.max(...deadlines), filename)
    }
  }
})
