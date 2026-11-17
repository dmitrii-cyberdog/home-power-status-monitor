import assert from 'node:assert/strict'
import test from 'node:test'

import { parseMonitorConfig } from '../../src/config/monitor.js'

const environment = {
  HOME_2_NAME: ' Family Home ',
  HOME_2_EZVIZ_API_APP_KEY: 'fake-key',
  HOME_2_EZVIZ_API_SECRET: 'fake-secret',
  DEVICE_3_HOME_2_TYPE: 'ezviz',
  DEVICE_3_HOME_2_NAME: ' Camera ',
}

test('monitor configuration discovers sparse IDs and preserves selectors', () => {
  const result = parseMonitorConfig(environment)

  assert.equal(result.intervalSeconds, 60)
  assert.equal(result.failedChecks, 3)
  assert.equal(result.homes[0].id, '2')
  assert.equal(result.homes[0].name, 'Family Home')
  assert.equal(result.homes[0].devices[0].name, ' Camera ')
  assert.deepEqual(parseMonitorConfig({}).homes, [])
})

test('monitor rejects unsafe configuration without disclosing values', () => {
  for (const overrides of [
    { POWER_CHECK_INTERVAL_SECONDS: '0' },
    { POWER_OFF_FAILED_CHECKS: '1.5' },
    { HOME_2_NAME: '' },
    { DEVICE_3_HOME_2_TYPE: 'other' },
    { HOME_2_EZVIZ_API_APP_KEY: '' },
    { HOME_2_POWER_OFF_OFFLINE_DEVICE_COUNT: '2' },
    { HOME_2_EZVIZ_API_BASE_URL: 'https://example.com' },
    { HOME_02_NAME: 'bad' },
    { EZVIZ_API_APP_KEY: 'private-sentinel' },
  ]) {
    assert.throws(
      () => parseMonitorConfig({ ...environment, ...overrides }),
      error => !error.message.includes('private-sentinel'),
    )
  }

  assert.equal(
    parseMonitorConfig({ HOME_9_NAME: 'Empty' }).homes[0].devices.length,
    0,
  )
  assert.throws(() =>
    parseMonitorConfig({ HOME_1_NAME: 'Same', HOME_2_NAME: ' same ' }),
  )
})
