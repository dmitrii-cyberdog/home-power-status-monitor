import assert from 'node:assert/strict'
import test from 'node:test'

import { monitorRecords, powerHistory } from '../../src/services/index.js'

test('history accounts sampled durations and uncertain transitions once', () => {
  let record = monitorRecords.createHomeRecord('1')
  const options = {
    runId: 'run',
    intervalSeconds: 60,
    continuityGraceMs: 300000,
    recipients: [
      { chatId: '1', generation: 'g', subscriptionId: 's', locale: 'en' },
    ],
  }

  for (const [index, status] of [
    'on',
    'on',
    'off',
    'off',
    'unknown',
    'on',
  ].entries()) {
    record = powerHistory.reduceHomeObservation(
      record,
      { status, observedAt: new Date(index * 60000).toISOString() },
      options,
    )
  }

  assert.deepEqual(record.stats, {
    onMs: 60000,
    offMs: 60000,
    uncertainMs: 180000,
    outageCount: 1,
  })
  assert.equal(record.eventSequence, 2)
  assert.equal(record.pendingDeliveries.length, 2)
  assert.equal(
    powerHistory.projectHomeStatus(record, {
      home: { id: '1', name: 'Home' },
      runId: 'restart',
      now: 300000,
      intervalSeconds: 60,
    }).status,
    'unknown',
  )
  const restart = powerHistory.reduceHomeObservation(
    record,
    { status: 'on', observedAt: new Date(360000).toISOString() },
    { ...options, runId: 'restart' },
  )

  assert.equal(restart.eventSequence, 2)
  assert.equal(restart.continuous, true)
  assert.equal(record.stats.uncertainMs, 180000)
})

test('clock rollback uses an accounting high-water mark and queue saturation is bounded', () => {
  let record = monitorRecords.createHomeRecord('1')
  const options = {
    runId: 'r',
    intervalSeconds: 60,
    continuityGraceMs: 300000,
    recipients: Array.from({ length: 1001 }, (_, index) => ({
      chatId: String(index + 1),
      generation: 'g',
      subscriptionId: 's',
      locale: 'en',
    })),
  }

  for (const [seconds, status] of [
    [0, 'off'],
    [60, 'off'],
    [30, 'off'],
    [90, 'off'],
  ]) {
    record = powerHistory.reduceHomeObservation(
      record,
      { status, observedAt: new Date(seconds * 1000).toISOString() },
      options,
    )
  }

  assert.equal(
    record.stats.onMs + record.stats.offMs + record.stats.uncertainMs,
    90000,
  )
  assert.equal(record.stats.outageCount, 1)
  assert.equal(record.pendingDeliveries.length, 1000)
  assert.equal(record.droppedAlerts, 1)
  assert.equal(record.continuous, false)
  const projection = powerHistory.projectHomeStatus(record, {
    home: { id: '1', name: 'Home' },
    runId: 'r',
    now: 300000,
    intervalSeconds: 60,
  })

  assert.equal(projection.stale, true)
  assert.equal(projection.status, 'unknown')
  assert.equal(projection.durationMs, null)
  assert.equal(projection.unobservedTailMs, 210000)
})

test('a new episode restores continuity after a gap but labels its event uncertain', () => {
  const options = {
    runId: 'r',
    intervalSeconds: 60,
    continuityGraceMs: 300000,
    recipients: [
      { chatId: '1', generation: 'g', subscriptionId: 's', locale: 'en' },
    ],
  }
  let record = monitorRecords.createHomeRecord('1')

  for (const [seconds, status] of [
    [0, 'on'],
    [60, 'unknown'],
    [420, 'on'],
    [480, 'off'],
  ]) {
    record = powerHistory.reduceHomeObservation(
      record,
      { status, observedAt: new Date(seconds * 1000).toISOString() },
      options,
    )
  }

  assert.equal(record.continuous, true)
  assert.equal(record.pendingDeliveries[0].uncertain, true)
})

test('transition deliveries snapshot previous detections and supported episode durations', () => {
  let record = monitorRecords.createHomeRecord('1')

  const options = {
    runId: 'run',
    intervalSeconds: 5400,
    continuityGraceMs: 10800000,
    recipients: [
      { chatId: '1', generation: 'g', subscriptionId: 's', locale: 'en' },
    ],
  }

  const observe = (status, hour, minute = 0, overrides = {}) => {
    record = powerHistory.reduceHomeObservation(
      record,
      {
        status,
        observedAt: new Date(
          Date.UTC(2026, 10, 20, hour, minute),
        ).toISOString(),
      },
      { ...options, ...overrides },
    )
  }

  observe('off', 8)
  observe('on', 9, 30)
  observe('off', 12)
  observe('on', 13, 0, { runId: 'restart' })
  observe('off', 11)

  assert.deepEqual(
    record.pendingDeliveries.map(delivery => delivery.history),
    [
      { previousOnAt: null, previousOffAt: null, precedingStateMs: null },
      {
        previousOnAt: null,
        previousOffAt: '2026-11-20T08:00:00.000Z',
        precedingStateMs: 5400000,
      },
      {
        previousOnAt: '2026-11-20T09:30:00.000Z',
        previousOffAt: '2026-11-20T08:00:00.000Z',
        precedingStateMs: 9000000,
      },
      {
        previousOnAt: '2026-11-20T09:30:00.000Z',
        previousOffAt: '2026-11-20T12:00:00.000Z',
        precedingStateMs: 3600000,
      },
      {
        previousOnAt: '2026-11-20T13:00:00.000Z',
        previousOffAt: '2026-11-20T12:00:00.000Z',
        precedingStateMs: null,
      },
    ],
  )
})

test('a rollback at the start of an episode suppresses its observed duration', () => {
  let record = monitorRecords.createHomeRecord('1')

  for (const [status, minute] of [
    ['off', 20],
    ['on', 19],
    ['off', 21],
  ]) {
    record = powerHistory.reduceHomeObservation(
      record,
      { status, observedAt: new Date(minute * 60000).toISOString() },
      {
        intervalSeconds: 60,
        continuityGraceMs: 300000,
        runId: 'run',
        recipients: [
          { chatId: '1', generation: 'g', subscriptionId: 's', locale: 'en' },
        ],
      },
    )
  }

  assert.equal(record.pendingDeliveries.at(-1).history.precedingStateMs, null)
  assert.equal(record.pendingDeliveries.at(-1).uncertain, true)
})

const graceOptions = {
  intervalSeconds: 60,
  continuityGraceMs: 300000,
  recipients: [
    { chatId: '1', generation: 'g', subscriptionId: 's', locale: 'en' },
  ],
}

const observeAll = (samples, record = monitorRecords.createHomeRecord('1')) => {
  for (const [seconds, status, runId = 'run'] of samples) {
    record = powerHistory.reduceHomeObservation(
      record,
      { status, observedAt: new Date(seconds * 1000).toISOString() },
      { ...graceOptions, runId },
    )
  }

  return record
}

test('a restart with streak-rebuild unknowns keeps the off duration', () => {
  const record = observeAll([
    [0, 'on', 'a'],
    [60, 'off', 'a'],
    [120, 'unknown', 'b'],
    [180, 'unknown', 'b'],
    [240, 'off', 'b'],
  ])

  assert.equal(record.continuous, true)
  assert.equal(record.stateSince, new Date(60000).toISOString())
  assert.equal(
    powerHistory.projectHomeStatus(record, {
      home: { id: '1', name: 'Home' },
      runId: 'b',
      now: 300000,
      intervalSeconds: 60,
    }).durationMs,
    240000,
  )
})

test('unknown samples within the window keep outage uptime', () => {
  const record = observeAll([
    [0, 'on'],
    [60, 'on'],
    [120, 'unknown'],
    [180, 'unknown'],
    [240, 'off'],
  ])

  const delivery = record.pendingDeliveries.at(-1)

  assert.equal(delivery.history.precedingStateMs, 240000)
  assert.equal(delivery.uncertain, false)
})

test('a decisive gap longer than the window breaks continuity', () => {
  const broken = observeAll([
    [0, 'on'],
    [60, 'unknown'],
    [360, 'on'],
  ])

  assert.equal(broken.continuous, false)

  // A later bridged confirmation does not repair an earlier break.
  assert.equal(observeAll([[420, 'on']], broken).continuous, false)
})

test('projected home status carries the configured time zone for manual commands', () => {
  const status = powerHistory.projectHomeStatus(
    monitorRecords.createHomeRecord('1'),
    {
      home: { id: '1', name: 'Home', timeZone: 'GMT+2' },
      runId: 'run',
      now: 0,
      intervalSeconds: 60,
    },
  )

  assert.equal(status.timeZone, 'GMT+2')
})
