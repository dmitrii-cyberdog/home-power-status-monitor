import assert from 'node:assert/strict'
import test from 'node:test'

import { Api } from 'grammy'

const {
  configureTelegramApi,
  createTelegramSendGuard,
  drainTelegramApiQueue,
  isTelegramSendSkipped,
  telegramApiThrottler,
} = await import('../../src/services/index.js')

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

const blockQueue = () => {
  const blockers = Array.from({ length: 10 }, createDeferred)

  const calls = blockers.map(blocker =>
    telegramApiThrottler(
      async () => {
        await blocker.promise
      },
      'sendMessage',
      {},
    ),
  )

  return async () => {
    for (const blocker of blockers) {
      blocker.resolve()
    }

    await Promise.all(calls)
  }
}

test('Telegram API queue checks a send guard when the queued call starts', async () => {
  let allowed = true

  const calls = []

  const previous = async (method, payload, signal) => {
    calls.push({ method, payload, signal })

    return { ok: true, result: true }
  }

  const release = blockQueue()

  const skipped = telegramApiThrottler(
    previous,
    'sendMessage',
    { chat_id: '7', text: 'stale' },
    createTelegramSendGuard(() => allowed),
  )

  const eligibleSignal = createTelegramSendGuard(() => true)

  const eligible = telegramApiThrottler(
    previous,
    'sendMessage',
    { chat_id: '8', text: 'fresh' },
    eligibleSignal,
  )

  const unguarded = telegramApiThrottler(previous, 'getMe', {})

  allowed = false
  await release()

  await assert.rejects(skipped, error => {
    assert.equal(error.code, 'telegram_send_skipped')
    assert.equal(isTelegramSendSkipped(error), true)

    return true
  })
  assert.deepEqual(await eligible, { ok: true, result: true })
  assert.deepEqual(await unguarded, { ok: true, result: true })
  assert.deepEqual(
    calls.map(({ method, payload }) => ({ method, payload })),
    [
      { method: 'sendMessage', payload: { chat_id: '8', text: 'fresh' } },
      { method: 'getMe', payload: {} },
    ],
  )
  assert.equal(calls[0].signal, eligibleSignal)
  assert.equal(isTelegramSendSkipped(new Error('other')), false)
})

test('auto-retry re-enters the guarded queue and stops after revocation', async () => {
  let allowed = true

  let retry = true

  let revoke = true

  const payloads = []

  const api = new Api('1:fake')

  api.config.use(async (_previous, _method, payload) => {
    payloads.push(payload)

    if (retry) {
      retry = false

      if (revoke) {
        allowed = false
      }

      return {
        ok: false,
        error_code: 429,
        description: 'Too Many Requests',
        parameters: { retry_after: 0 },
      }
    }

    return {
      ok: true,
      result: { message_id: 1, date: 0, chat: { id: 7, type: 'private' } },
    }
  })
  configureTelegramApi(api)

  await assert.rejects(
    api.sendMessage(
      7,
      'stale',
      undefined,
      createTelegramSendGuard(() => allowed),
    ),
    { code: 'telegram_send_skipped' },
  )
  assert.equal(payloads.length, 1)

  allowed = true
  retry = true
  revoke = false
  payloads.length = 0
  await api.sendMessage(
    7,
    'fresh',
    { parse_mode: 'HTML' },
    createTelegramSendGuard(() => allowed),
  )
  assert.deepEqual(payloads, [
    { chat_id: 7, text: 'fresh', parse_mode: 'HTML' },
    { chat_id: 7, text: 'fresh', parse_mode: 'HTML' },
  ])
})

test.after(async () => {
  await drainTelegramApiQueue()
})
