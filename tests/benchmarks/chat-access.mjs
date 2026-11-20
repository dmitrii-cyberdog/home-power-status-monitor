import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env.NODE_ENV = 'test'

const { createChatAccess, openMonitorStore } =
  await import('../../src/services/index.js')

const directory = await mkdtemp(path.join(tmpdir(), 'chat-access-benchmark-'))
const store = await openMonitorStore({ directory, homeIds: [] })

let copies = 0

const access = createChatAccess({
  store: {
    ...store,
    readChats() {
      copies++

      return store.readChats()
    },
  },
  secret: 'benchmark-only',
  homes: [],
})

//
//

try {
  await access.initialize()

  for (const chats of [1, 100, 1000]) {
    await store.updateChats(registry => {
      for (let id = 1; id <= chats; id++) {
        registry.chats[id] = {
          authorizedGeneration: registry.generation,
          grantId: String(id),
          locale: 'en',
          subscriptions: { 1: { id: String(id) } },
        }
      }

      return registry
    })

    const iterations = 1000
    const timings = []

    for (let batch = 0; batch < 5; batch++) {
      copies = 0

      const start = performance.now()

      for (let index = 0; index < iterations; index++) {
        assert.ok(access.isAuthorized(String(1 + (index % chats))))
      }

      timings.push(performance.now() - start)
    }

    timings.sort((a, b) => a - b)

    console.log({
      chats,
      checks: iterations,
      registryCopies: copies,
      medianMs: Number(timings[2].toFixed(2)),
    })
  }
} finally {
  await store.close()
  await rm(directory, { recursive: true, force: true })
}
