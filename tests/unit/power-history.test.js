import assert from 'node:assert/strict'
import test from 'node:test'

import { monitorRecords, powerHistory } from '../../src/services/index.js'

test('history accounts sampled durations and uncertain transitions once', () => {
  let record = monitorRecords.createHomeRecord('1')
  const options = {
    runId: 'run',
    intervalSeconds: 60,
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
  assert.equal(restart.continuous, false)
  assert.equal(record.stats.uncertainMs, 180000)
})

test('clock rollback uses an accounting high-water mark and queue saturation is bounded', () => {
  let record = monitorRecords.createHomeRecord('1')
  const options = {
    runId: 'r',
    intervalSeconds: 60,
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
    recipients: [
      { chatId: '1', generation: 'g', subscriptionId: 's', locale: 'en' },
    ],
  }
  let record = monitorRecords.createHomeRecord('1')

  for (const [seconds, status] of [
    [0, 'on'],
    [60, 'unknown'],
    [120, 'on'],
    [180, 'off'],
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
