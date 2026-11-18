import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const sourceDirectory = fileURLToPath(new URL('../../src/', import.meta.url))

process.chdir(sourceDirectory)

const { drainBotRunner } = await import('../../src/loaders/index.js')

test('bot shutdown waits until every accepted update has finished', async () => {
  let checks = 0
  let stopped = false
  const runner = {
    async stop() {
      stopped = true
    },
    size() {
      checks += 1
      return checks === 1 ? 1 : 0
    },
  }

  await drainBotRunner(runner, new AbortController().signal)

  assert.equal(stopped, true)
  assert.equal(checks, 2)
})

test('bot shutdown drain can be bounded by the application deadline', async () => {
  const controller = new AbortController()
  const runner = {
    async stop() {},
    size() {
      return 1
    },
  }

  controller.abort()

  await drainBotRunner(runner, controller.signal)
})
