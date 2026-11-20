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
