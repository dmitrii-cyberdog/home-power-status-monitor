import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const sourceDirectory = fileURLToPath(new URL('../../src/', import.meta.url))

//
//

test('unit-test preload isolates configuration and cleanup from private env files', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--import=extensionless/register',
      '--import=../tests/unit/setup.js',
      '--input-type=module',
      '--eval',
      `
        import assert from 'node:assert/strict'
        import dotenvFlow from 'dotenv-flow'

        dotenvFlow.config = () => {
          throw new Error('Unit tests must not load dotenv files')
        }

        const { default: config } = await import('./config/config.js')

        assert.equal(config.envName, 'test')
        assert.equal(config.botSettings.token, '')
        assert.equal(config.appSettings, undefined)
        assert.equal(config.cron.checkPowerStatus.isEnabled, false)
        assert.equal(config.logs.telegram.isEnabled, false)
      `,
    ],
    {
      cwd: sourceDirectory,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        TG_BOT_TOKEN: 'must-not-be-used',
        CRON_CHECK_POWER_STATUS_IS_ENABLED: '1',
      },
      encoding: 'utf8',
      timeout: 10000,
    },
  )

  assert.equal(result.status, 0, result.error?.message || result.stderr)
})
