import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  createChatRegistry,
  createHomeRecord,
  validateChatRegistry,
  validateHomeRecord,
} from '../../src/services/monitorRecords.js'
import { openMonitorStore } from '../../src/services/monitorStore.js'

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
      validateHomeRecord({ ...createHomeRecord('1'), ...patch }, '1'),
    )
  }

  assert.throws(() =>
    validateChatRegistry({
      ...createChatRegistry(),
      verifier: { salt: 'short', digest: 'short' },
    }),
  )
})
