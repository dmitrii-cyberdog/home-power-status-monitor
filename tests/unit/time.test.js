import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatTimeOffsetMinutes,
  getDayJsWithUtcOffset,
  getTodayDatesWithOffset,
  parseTimeOffsetMinutes,
} from '../../src/utils/index.js'

test('formatTimeOffsetMinutes returns a readable UTC offset', () => {
  assert.equal(formatTimeOffsetMinutes(0), 'UTC+0')
  assert.equal(formatTimeOffsetMinutes(180), 'UTC+3')
  assert.equal(formatTimeOffsetMinutes(-330), 'UTC-5:30')
  assert.equal(formatTimeOffsetMinutes(840), 'UTC+14')
})

test('parseTimeOffsetMinutes accepts minutes and UTC or GMT values', () => {
  assert.equal(parseTimeOffsetMinutes('180'), 180)
  assert.equal(parseTimeOffsetMinutes('-300'), -300)
  assert.equal(parseTimeOffsetMinutes('UTC+2'), 120)
  assert.equal(parseTimeOffsetMinutes('gmt - 5:30'), -330)
  assert.equal(parseTimeOffsetMinutes('UTC+14:00'), 840)
  assert.equal(parseTimeOffsetMinutes('GMT-12'), -720)
})

test('parseTimeOffsetMinutes rejects malformed and out-of-range values', () => {
  const invalidValues = [
    '',
    '2.5',
    'UTC+2.5',
    'UTC+14:01',
    'GMT-12:01',
    'UTC+2:60',
    '841',
    '-721',
  ]

  invalidValues.forEach(value => {
    assert.equal(parseTimeOffsetMinutes(value), null)
  })

  assert.equal(parseTimeOffsetMinutes(null), null)
})

test('getTodayDatesWithOffset treats small offsets as minutes', t => {
  t.mock.timers.enable({
    apis: ['Date'],
    now: new Date('2026-07-13T12:00:00.000Z'),
  })

  assert.deepEqual(getTodayDatesWithOffset(5), {
    todayStart: '2026-07-12T23:55:00Z',
    todayEnd: '2026-07-13T23:54:59Z',
  })
})

test('getDayJsWithUtcOffset keeps the UTC instant and sets a minute offset', () => {
  const localTime = getDayJsWithUtcOffset(5, '2026-07-01T23:54:00.000Z')

  assert.equal(localTime.utcOffset(), 5)
  assert.equal(localTime.format('Z'), '+00:05')
  assert.equal(localTime.format('YYYY-MM-DD HH:mm'), '2026-07-01 23:59')
  assert.equal(localTime.toISOString(), '2026-07-01T23:54:00.000Z')
})

test('getDayJsWithUtcOffset can preserve a selected local date', () => {
  const selectedDate = getDayJsWithUtcOffset(
    -300,
    '2026-07-01T00:00:00.000Z',
    true,
  )

  assert.equal(selectedDate.format('YYYY-MM-DD HH:mm'), '2026-07-01 00:00')
  assert.equal(selectedDate.toISOString(), '2026-07-01T05:00:00.000Z')
})

test('getDayJsWithUtcOffset preserves every accepted integer offset', () => {
  for (let offset = -720; offset <= 840; offset += 1) {
    assert.equal(
      getDayJsWithUtcOffset(offset, '2026-07-01T00:00:00.000Z').utcOffset(),
      offset,
    )
  }
})
