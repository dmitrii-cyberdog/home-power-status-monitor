import PQueue from 'p-queue'

const MAX_QUEUED_TELEGRAM_CALLS = 200

const queue = new PQueue({
  concurrency: 10,
  interval: 1000,
  intervalCap: 25,
  strict: true,
})

//
//

export const telegramApiThrottler = async (
  previous,
  method,
  payload,
  signal,
) => {
  if (queue.size + queue.pending >= MAX_QUEUED_TELEGRAM_CALLS) {
    const error = new Error('Telegram API queue is full')

    error.code = 'telegram_api_queue_full'
    throw error
  }

  let queueSignal = signal
  let removeAbortListener

  // grammY runner uses a legacy signal, while p-queue requires the native API.
  if (signal && typeof signal.throwIfAborted !== 'function') {
    const controller = new AbortController()
    const abortQueueTask = () => {
      controller.abort(signal.reason)
    }

    if (signal.aborted) {
      abortQueueTask()
    } else {
      signal.addEventListener('abort', abortQueueTask, { once: true })
      removeAbortListener = () => {
        signal.removeEventListener('abort', abortQueueTask)
      }
    }

    queueSignal = controller.signal
  }

  try {
    return await queue.add(() => previous(method, payload, signal), {
      signal: queueSignal,
    })
  } finally {
    removeAbortListener?.()
  }
}

export const drainTelegramApiQueue = async () => {
  await queue.onIdle()
}
