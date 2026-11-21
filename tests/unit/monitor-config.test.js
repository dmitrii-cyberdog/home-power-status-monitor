import assert from 'node:assert/strict'
import test from 'node:test'

import { parseMonitorConfig } from '../../src/config/index.js'

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
  assert.equal(result.continuityGraceMinutes, 5)
  assert.equal(result.homes[0].id, '2')
  assert.equal(result.homes[0].name, 'Family Home')
  assert.equal(result.homes[0].devices[0].name, ' Camera ')
  assert.deepEqual(parseMonitorConfig({}).homes, [])
})

test('monitor rejects unsafe configuration without disclosing values', () => {
  for (const overrides of [
    { POWER_CHECK_INTERVAL_SECONDS: '0' },
    { POWER_OFF_FAILED_CHECKS: '1.5' },
    { POWER_CONTINUITY_GRACE_MINUTES: '0' },
    { POWER_CONTINUITY_GRACE_MINUTES: '1.5' },
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

test('homes configure fixed time zones and recurring notification minutes', () => {
  const { homes } = parseMonitorConfig({
    HOME_1_NAME: 'One',
    HOME_2_NAME: 'Two',
    HOME_2_NOTIFICATION_INTERVAL_MINUTES: '5',
    HOME_3_NAME: 'Three',
    HOME_3_TIME_ZONE: 'GMT-3:30',
    HOME_3_NOTIFICATION_INTERVAL_MINUTES: '0',
  })

  assert.deepEqual(
    homes.map(home => [home.timeZone, home.notificationIntervalMinutes]),
    [
      ['GMT+2', 0],
      ['UTC', 5],
      ['GMT-3:30', 0],
    ],
  )

  for (const value of ['-1', '1.5', '', '9007199254740991']) {
    assert.throws(
      () =>
        parseMonitorConfig({
          HOME_1_NAME: 'One',
          HOME_1_NOTIFICATION_INTERVAL_MINUTES: value,
        }),
      /Invalid HOME_1_NOTIFICATION_INTERVAL_MINUTES/,
    )
  }

  for (const value of ['GMT+14:01', 'GMT+2:60', 'Europe/Prague', '']) {
    assert.throws(
      () =>
        parseMonitorConfig({
          HOME_1_NAME: 'One',
          HOME_1_TIME_ZONE: value,
        }),
      /Invalid HOME_1_TIME_ZONE/,
    )
  }
})
