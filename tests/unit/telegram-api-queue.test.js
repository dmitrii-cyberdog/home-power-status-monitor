import assert from 'node:assert/strict'
import test from 'node:test'

const { drainTelegramApiQueue, telegramApiThrottler } =
  await import('../../src/services/telegramApiQueue.js')

const createLegacyAbortController = () => {
  const events = new EventTarget()
  const signal = {
    aborted: false,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  }

  return {
    abort() {
      signal.aborted = true
      events.dispatchEvent(new Event('abort'))
    },
    signal,
  }
}

const createDeferred = () => {
  let resolve
  const promise = new Promise(resolvePromise => {
    resolve = resolvePromise
  })

  return { promise, resolve }
}

test('Telegram API queue accepts the legacy AbortSignal used by grammY runner', async () => {
  const controller = createLegacyAbortController()
  let forwardedSignal

  const result = await telegramApiThrottler(
    async (_method, _payload, signal) => {
      forwardedSignal = signal
      return 'ok'
    },
    'getUpdates',
    {},
    controller.signal,
  )

  assert.equal(result, 'ok')
  assert.equal(forwardedSignal, controller.signal)
})

test('Telegram API queue removes aborted legacy-signal work while queued', async () => {
  const controller = createLegacyAbortController()
  const blockers = Array.from({ length: 10 }, createDeferred)
  const blockerCalls = blockers.map(blocker =>
    telegramApiThrottler(
      async () => {
        await blocker.promise
      },
      'sendMessage',
      {},
    ),
  )
  let called = false

  const queuedCall = telegramApiThrottler(
    async () => {
      called = true
    },
    'getUpdates',
    {},
    controller.signal,
  )

  try {
    controller.abort()
    await assert.rejects(queuedCall, { name: 'AbortError' })
  } finally {
    for (const blocker of blockers) {
      blocker.resolve()
    }

    await Promise.all(blockerCalls)
  }

  assert.equal(called, false)
})

test.after(async () => {
  await drainTelegramApiQueue()
})
