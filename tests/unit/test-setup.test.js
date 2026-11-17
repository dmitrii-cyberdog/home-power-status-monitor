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
        assert.deepEqual(config.monitor.homes, [])
        assert.equal(config.botSettings.accessSecret, '')
      `,
    ],
    {
      cwd: sourceDirectory,
      env: {
        ...process.env,
        NODE_ENV: 'prod',
        TG_BOT_TOKEN: 'must-not-be-used',
        CRON_CHECK_POWER_STATUS_IS_ENABLED: '1',
        TG_BOT_ACCESS_SECRET: 'must-not-be-used',
        HOME_1_NAME: 'Poisoned home',
        HOME_1_EZVIZ_API_APP_KEY: 'must-not-be-used',
        DEVICE_1_HOME_1_TYPE: 'ezviz',
        DEVICE_1_HOME_1_NAME: 'must-not-be-used',
        POWER_CHECK_INTERVAL_SECONDS: 'invalid',
      },
      encoding: 'utf8',
      timeout: 10000,
    },
  )

  assert.equal(result.status, 0, result.error?.message || result.stderr)
})
