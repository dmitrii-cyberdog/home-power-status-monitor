import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  monitorRecords,
  monitorValidation,
  openMonitorStore,
} from '../../src/services/index.js'

test('store owns directory, serializes writes, and publishes only after rename', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'monitor-store-'))

  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  let fail = false
  const store = await openMonitorStore({
    directory,
    homeIds: ['1'],
    fs: {
      ...fs,
      rename: (...args) =>
        fail ? Promise.reject(new Error('disk')) : fs.rename(...args),
    },
  })

  await assert.rejects(
    openMonitorStore({ directory, homeIds: ['1'] }),
    /owner/i,
  )
  await Promise.all(
    [1, 2].map(() =>
      store.updateHome('1', home => ({
        ...home,
        droppedAlerts: home.droppedAlerts + 1,
      })),
    ),
  )
  assert.equal(store.readHome('1').droppedAlerts, 2)
  const before = store.readHome('1')

  fail = true
  await assert.rejects(
    store.updateHome('1', home => ({ ...home, droppedAlerts: 9 })),
  )
  assert.deepEqual(store.readHome('1'), before)
  await store.close()
  await assert.rejects(store.updateHome('1', home => home))
  const reopened = await openMonitorStore({ directory, homeIds: ['1'] })

  assert.deepEqual(reopened.readHome('1'), before)
  await reopened.close()
  await fs.writeFile(path.join(directory, 'homes/1.json'), '{}')
  await assert.rejects(
    openMonitorStore({ directory, homeIds: ['1'] }),
    /record/i,
  )
})

test('separate processes cannot share storage ownership', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'monitor-owner-'))

  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const spawn = () =>
    fork(
      new URL('../fixtures/monitor-store.mjs', import.meta.url),
      [directory],
      { execArgv: ['--import=extensionless/register'], silent: true },
    )
  const owner = spawn()

  t.after(() => {
    if (owner.exitCode === null) {
      owner.kill()
    }
  })
  assert.equal((await once(owner, 'message'))[0], 'opened')
  const competitor = spawn()
  const competitorExit = once(competitor, 'exit')

  assert.equal((await once(competitor, 'message'))[0], 'refused')
  await competitorExit
  const ownerExit = once(owner, 'exit')

  owner.send('close')
  await ownerExit
})

test('disk schema rejects corrupt identifiers, dates, counters, verifier and undeclared fields', () => {
  for (const patch of [
    { version: 2 },
    { id: '../1' },
    { lastDecisiveAt: 'bad' },
    { stats: { onMs: -1 } },
    { sample: { status: 'on', observedAt: new Date(0).toISOString() } },
    { privateSecret: 'must-not-persist' },
  ]) {
    assert.throws(() =>
      monitorValidation.validateHomeRecord(
        { ...monitorRecords.createHomeRecord('1'), ...patch },
        '1',
      ),
    )
  }

  assert.throws(() =>
    monitorValidation.validateChatRegistry({
      ...monitorRecords.createChatRegistry(),
      verifier: { salt: 'short', digest: 'short' },
    }),
  )
})

test('chat registry accepts legacy and current grant IDs but rejects malformed ones', () => {
  const chat = { authorizedGeneration: 'g', locale: 'en', subscriptions: {} }

  const registry = chats => ({
    ...monitorRecords.createChatRegistry(),
    generation: 'g',
    chats,
  })

  for (const grantId of [undefined, null, 'grant']) {
    const record = grantId === undefined ? chat : { ...chat, grantId }

    assert.doesNotThrow(() =>
      monitorValidation.validateChatRegistry(registry({ 7: record })),
    )
  }

  for (const grantId of ['', 7, {}]) {
    assert.throws(() =>
      monitorValidation.validateChatRegistry(
        registry({ 7: { ...chat, grantId } }),
      ),
    )
  }
})

test('chat registry accepts valid per-chat intervals and rejects out-of-range ones', () => {
  const chat = { authorizedGeneration: 'g', locale: 'en', subscriptions: {} }

  const registry = chats => ({
    ...monitorRecords.createChatRegistry(),
    generation: 'g',
    chats,
  })

  const withGrant = { ...chat, grantId: null }

  for (const base of [chat, withGrant]) {
    for (const minutes of [0, 5, 10080]) {
      assert.doesNotThrow(() =>
        monitorValidation.validateChatRegistry(
          registry({ 7: { ...base, intervals: { 1: minutes } } }),
        ),
      )
    }

    assert.doesNotThrow(() =>
      monitorValidation.validateChatRegistry(registry({ 7: base })),
    )

    for (const minutes of [4, 10081, 5.5, '5', null]) {
      assert.throws(
        () =>
          monitorValidation.validateChatRegistry(
            registry({ 7: { ...base, intervals: { 1: minutes } } }),
          ),
        /Invalid chat registry/,
      )
    }
  }

  assert.equal(monitorValidation.isIntervalMinutes(0), true)
  assert.equal(monitorValidation.isIntervalMinutes(4), false)
})

test('stored verifiers require hex strings and an active generation', () => {
  const salt = 'a'.repeat(32)
  const digest = 'b'.repeat(128)

  const registry = monitorRecords.createChatRegistry()

  for (const patch of [
    { verifier: { salt, digest }, generation: null },
    { verifier: { salt: [salt], digest }, generation: 'g' },
    { verifier: { salt, digest: [digest] }, generation: 'g' },
  ]) {
    assert.throws(
      () => monitorValidation.validateChatRegistry({ ...registry, ...patch }),
      /Invalid chat registry/,
    )
  }
})

test('home validation accepts legacy and current deliveries and rejects invalid episode history', () => {
  const record = monitorRecords.createHomeRecord('1')

  const delivery = {
    eventId: '1:1',
    sequence: 1,
    chatId: '1',
    generation: 'g',
    subscriptionId: 's',
    locale: 'en',
    state: 'off',
    detectedAt: '2026-11-20T12:00:00.000Z',
    baseline: false,
    uncertain: false,
  }

  record.eventSequence = 1
  record.pendingDeliveries = [delivery]

  assert.equal(monitorValidation.validateHomeRecord(record, '1'), record)

  const history = {
    previousOnAt: '2026-11-20T09:30:00.000Z',
    previousOffAt: '2026-11-20T08:00:00.000Z',
    precedingStateMs: 9000000,
  }

  record.pendingDeliveries = [{ ...delivery, history }]

  assert.equal(monitorValidation.validateHomeRecord(record, '1'), record)

  for (const patch of [
    { previousOffAt: '2026-11-20T10:00:00+02:00' },
    { precedingStateMs: -1 },
    { extra: 0 },
  ]) {
    record.pendingDeliveries = [
      { ...delivery, history: { ...history, ...patch } },
    ]

    assert.throws(
      () => monitorValidation.validateHomeRecord(record, '1'),
      /Invalid delivery record/,
    )
  }
})

test('legacy home records load and persist bounded recovery snapshots', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'monitor-outages-'))
  let store
  t.after(async () => {
    await store?.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  const { recentOutages, ...legacy } = monitorRecords.createHomeRecord('1')
  assert.deepEqual(recentOutages, [])

  const startedAt = '2026-11-24T13:00:55.000Z'
  const restoredAt = '2026-11-24T21:00:55.000Z'
  const delivery = {
    eventId: '1:2',
    sequence: 2,
    state: 'on',
    detectedAt: restoredAt,
    baseline: false,
    uncertain: false,
    chatId: '1',
    generation: 'g',
    subscriptionId: 's',
    locale: 'en',
  }
  const history = {
    previousOnAt: null,
    previousOffAt: startedAt,
    precedingStateMs: 28800000,
  }

  legacy.eventSequence = 2
  legacy.pendingDeliveries = [delivery, { ...delivery, chatId: '2', history }]

  await fs.mkdir(path.join(directory, 'homes'))
  await fs.writeFile(
    path.join(directory, 'homes/1.json'),
    JSON.stringify(legacy),
  )

  store = await openMonitorStore({ directory, homeIds: ['1'] })
  assert.deepEqual(store.readHome('1'), { ...legacy, recentOutages: [] })

  const outage = { restorationSequence: 2, startedAt, restoredAt }
  const expected = await store.updateHome('1', record => ({
    ...record,
    eventSequence: 4,
    recentOutages: [outage],
    pendingDeliveries: [
      delivery,
      {
        ...delivery,
        chatId: '2',
        history: { ...history, recentOutages: [outage] },
      },
    ],
  }))

  await store.close()
  store = await openMonitorStore({ directory, homeIds: ['1'] })
  assert.deepEqual(store.readHome('1'), expected)

  for (const entries of [
    Array(11).fill(outage),
    [{ ...outage, startedAt: '2026-11-24T13:00:55+00:00' }],
    [{ ...outage, startedAt: restoredAt }],
    [outage, outage],
    [outage, { ...outage, restorationSequence: 4 }],
  ]) {
    assert.throws(
      () =>
        monitorValidation.validateHomeRecord(
          { ...expected, recentOutages: entries },
          '1',
        ),
      /Invalid home record/,
    )
  }

  expected.pendingDeliveries[1].history.recentOutages = [
    { ...outage, restorationSequence: 4 },
  ]
  assert.throws(
    () => monitorValidation.validateHomeRecord(expected, '1'),
    /Invalid delivery record/,
  )
})
