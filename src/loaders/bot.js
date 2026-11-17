import { run, sequentialize } from '@grammyjs/runner'
import { Bot } from 'grammy'

import config from '../config'

import {
  errorHandler,
  loggerHandler,
  pendingUpdatesHandler,
  updatesHandler,
} from '../middlewares/bot'

import { configureTelegramApi, i18n } from '../services/botApi'

import grammyRoutes from '../api/bot'

const waitForRunnerIdle = (runner, signal) =>
  new Promise(resolve => {
    let settled = false
    let timeoutId

    const finish = () => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeoutId)
      signal?.removeEventListener('abort', finish)
      resolve()
    }

    const check = () => {
      if (settled) {
        return
      }

      if (signal?.aborted || runner.size() === 0) {
        finish()
        return
      }

      timeoutId = setTimeout(check, 25)
    }

    signal?.addEventListener('abort', finish, { once: true })
    check()
  })

export const drainBotRunner = async (runner, signal) => {
  let stopError

  try {
    await runner.stop()
  } catch (error) {
    stopError = error
  }

  await waitForRunnerIdle(runner, signal)

  if (stopError) {
    throw stopError
  }
}

//
//

export default async (signal, monitorRuntime) => {
  if (!config.botSettings.token || signal?.aborted) {
    return null
  }

  const bot = new Bot(config.botSettings.token, {
    client: { timeoutSeconds: 40 },
  })

  configureTelegramApi(bot.api)

  //
  // system middlewares
  //

  bot.use(loggerHandler)
  bot.use(i18n)
  bot.use(updatesHandler)
  bot.use(pendingUpdatesHandler)
  bot.use(sequentialize(ctx => ctx.chatId?.toString()))
  bot.use(
    grammyRoutes({ ...monitorRuntime, admins: config.botSettings.admins }),
  )

  errorHandler(bot)

  await bot.api.setMyCommands([
    { command: 'start', description: 'Home Power Status Monitor' },
    { command: 'help', description: 'Service status and help' },
    { command: 'secret', description: 'Authorize this chat' },
    { command: 'status', description: 'Show home status' },
    { command: 'status_full', description: 'Show detailed home status' },
    { command: 'on_notification', description: 'Enable home notifications' },
    { command: 'off_notification', description: 'Disable home notifications' },
  ])

  if (signal?.aborted) {
    return null
  }

  //
  //

  monitorRuntime.setTelegramApi(bot.api)
  monitorRuntime.startNotifications()

  return run(bot, {
    runner: {
      fetch: { allowed_updates: ['message', 'callback_query'] },
    },
    sink: { concurrency: 50 },
  })
}
