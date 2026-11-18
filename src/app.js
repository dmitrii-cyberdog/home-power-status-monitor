import config from './config'

import {
  cron as cronService,
  Logger,
  flushLogger,
  closeRequestAgents,
  drainTelegramApiQueue,
} from './services'

import loader, { drainBotRunner } from './loaders'

//

const SHUTDOWN_DRAIN_TIMEOUT_MS = 30000
const SHUTDOWN_TIMEOUT_MS = 35000

const shutdownController = new AbortController()

let runtime = {
  botRunner: null,
  botTask: null,
  cronTasks: [],
}
let shutdownPromise = null
let shutdownWithError = false

//
//

const drainCronTasks = async tasks => {
  for (const task of tasks) {
    try {
      await task.stop()
    } catch (error) {
      shutdownWithError = true
      Logger.error('Cron task stop failed', { error, task: task.name })
    }
  }

  try {
    await cronService.drain()
  } finally {
    for (const task of tasks) {
      try {
        await task.destroy()
      } catch (error) {
        shutdownWithError = true
        Logger.error('Cron task destroy failed', { error, task: task.name })
      }
    }
  }
}

const shutdown = signal => {
  if (!['SIGTERM', 'SIGINT', 'shutdown'].includes(signal)) {
    shutdownWithError = true
  }

  if (shutdownPromise) {
    return shutdownPromise
  }

  const startedAt = Date.now()

  let phase = 'drain'

  const pendingDrains = new Set(['bot', 'cron', 'notifications'])

  const deadlineId = setTimeout(() => {
    Logger.error('Application shutdown timed out', {
      signal,
      phase,
      pendingComponents: [...pendingDrains],
      durationMs: Date.now() - startedAt,
    })

    // eslint-disable-next-line n/no-process-exit -- A stuck shutdown must terminate before PM2 sends SIGKILL.
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS)

  //
  //

  shutdownPromise = (async () => {
    Logger.notice('Application shutdown started', { signal })
    shutdownController.abort()
    runtime.monitorRuntime?.stopNotifications()

    let timedOut = false

    const drainController = new AbortController()

    const botDrain = runtime?.botRunner
      ? drainBotRunner(runtime.botRunner, drainController.signal)
      : Promise.resolve()

    const cronDrain = drainCronTasks(runtime.cronTasks)
    const notificationDrain = (async () => {
      try {
        await runtime.monitorInitialization
      } catch {
        // Startup reports initialization failures; no notification producer exists.
        return
      }

      runtime.monitorRuntime?.stopNotifications()
      await runtime.monitorRuntime?.drainNotifications()
    })()

    let timeoutId
    const timeout = new Promise(resolve => {
      timeoutId = setTimeout(() => {
        timedOut = true
        resolve()
      }, SHUTDOWN_DRAIN_TIMEOUT_MS)
    })

    const drain = (async () => {
      const drainNames = [...pendingDrains]
      const drainResults = await Promise.allSettled(
        [botDrain, cronDrain, notificationDrain].map((task, index) =>
          task.finally(() => pendingDrains.delete(drainNames[index])),
        ),
      )

      drainResults.forEach((result, index) => {
        if (result.status === 'rejected') {
          shutdownWithError = true

          Logger.error('Application shutdown component failed', {
            component: drainNames[index],
            error: result.reason,
          })
        }
      })

      // A timed-out drain may finish later, while resources are already closing.
      if (!timedOut) {
        phase = 'telegram'
        await drainTelegramApiQueue()
        phase = 'storage'
        await runtime.monitorRuntime?.close()
      }
    })()

    try {
      await Promise.race([drain, timeout])
    } finally {
      clearTimeout(timeoutId)
      drainController.abort()
    }

    if (timedOut) {
      shutdownWithError = true
      Logger.error('Application shutdown drain timed out', {
        phase,
        pendingComponents: [...pendingDrains],
      })
    }

    //
    //

    phase = 'resources'

    closeRequestAgents()

    Logger.notice('Application shutdown complete', {
      signal,
      durationMs: Date.now() - startedAt,
      withError: shutdownWithError,
    })
  })()
    .catch(error => {
      shutdownWithError = true
      Logger.critical('Application shutdown failed', { error, signal, phase })
    })
    .finally(async () => {
      phase = 'logger'

      try {
        await flushLogger()
      } catch (error) {
        shutdownWithError = true
        Logger.critical('Application shutdown log flush failed', { error })
      } finally {
        clearTimeout(deadlineId)
        // Cleanup is finished; SDK retry timers and sockets must not delay exit.
        // eslint-disable-next-line n/no-process-exit -- Throwing would re-enter the shutdown exception handler.
        process.exit(shutdownWithError ? 1 : 0)
      }
    })

  return shutdownPromise
}

//
//

const startApp = async () => {
  try {
    await loader(
      runtime,
      error => {
        if (shutdownPromise) {
          return
        }

        Logger.critical('Telegram bot runner failed', { error })
        void shutdown('bot_runner_error')
      },
      shutdownController.signal,
    )

    if (shutdownPromise) {
      await shutdownPromise

      return
    }

    Logger.notice('Application ready', {
      env: config.envName,
      isDebug: config.isDebug,
    })
  } catch (error) {
    runtime = error.runtime || runtime

    Logger.critical('Application startup failed', { error })
    await shutdown('startup_error')
  }
}

//
//
//

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    void shutdown(signal)
  })
}

process.on('message', message => {
  if (message === 'shutdown') {
    void shutdown('shutdown')
  }
})

process.once('uncaughtException', error => {
  Logger.critical('Uncaught exception', { error })
  void shutdown('uncaught_exception')
})

process.once('unhandledRejection', error => {
  Logger.critical('Unhandled promise rejection', { error })
  void shutdown('unhandled_rejection')
})

process.once('beforeExit', () => {
  void shutdown('SIGTERM')
})

//
//
//

startApp()
