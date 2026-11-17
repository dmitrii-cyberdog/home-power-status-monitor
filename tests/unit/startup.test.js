import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

test(
  'cron worker starts without Telegram credentials and shuts down cleanly',
  { timeout: 10000 },
  async t => {
    const child = fork(new URL('../fixtures/worker.mjs', import.meta.url), [], {
      cwd: fileURLToPath(new URL('../../src/', import.meta.url)),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TG_BOT_TOKEN: '',
        CRON_CHECK_POWER_STATUS_IS_ENABLED: '1',
      },
      execArgv: ['--import=extensionless/register'],
      silent: true,
    })
    let output = ''
    let errors = ''

    t.after(() => {
      if (child.exitCode === null) {
        child.kill()
      }
    })

    child.stderr.on('data', chunk => {
      errors += chunk
    })

    await new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('exit', code =>
        reject(new Error(`Early exit ${code}: ${errors}`)),
      )
      child.stdout.on('data', chunk => {
        output += chunk

        if (output.includes('Application ready')) {
          resolve()
        }
      })
    })
    const exited = once(child, 'exit')

    child.send('stop')

    const [code, signal] = await exited

    assert.equal(code, 0, errors)
    assert.equal(signal, null)
    assert.match(output, /Application shutdown complete/)
    assert.match(output, /telegramEnabled: false/)
    assert.match(output, /cronTasks: 1/)
    assert.equal(errors, '')
  },
)
