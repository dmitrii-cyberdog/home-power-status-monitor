import { randomUUID } from 'node:crypto'

import { getI18n } from '../botApi'
import { createChatAccess } from '../chatAccess'
import { createHomeMonitor } from '../homeMonitor'
import { createPowerMonitor, createPowerNotifications } from '../power'
import { createTelegramSendGuard } from '../telegramApiQueue'
import { renderPowerAlert } from './messages'
import { openMonitorStore } from './store'

export const createMonitorRuntime = async ({
  config,
  directory = config.generalSettings.externalStorageFolder,
  now = Date.now,
  log,
  ...deps
}) => {
  const { homes, intervalSeconds } = config.monitor

  const store = await (deps.openStore ?? openMonitorStore)({
    directory,
    homeIds: homes.map(home => home.id),
  })

  try {
    const access = createChatAccess({
      store,
      secret: config.botSettings.accessSecret,
      homes,
      now,
    })

    await access.initialize()

    const monitor = deps.monitor ?? createPowerMonitor(config.monitor, { now })

    const homeMonitor = createHomeMonitor({
      monitor,
      store,
      access,
      homes,
      runId: randomUUID(),
      intervalSeconds,
      now,
      log,
    })

    let notifications

    let timer

    let stopped = false

    const flush = () => {
      void notifications
        .flush()
        .catch(() => log?.error('Notification pass failed'))
    }

    return {
      access,
      homeMonitor,
      setTelegramApi(api) {
        if (notifications) {
          throw new Error('Telegram API already attached')
        }

        notifications = createPowerNotifications({
          store,
          access,
          homes,
          log,
          send: (chatId, text, isAllowed) =>
            api.sendMessage(
              chatId,
              text,
              undefined,
              createTelegramSendGuard(isAllowed),
            ),
          renderAlert: (delivery, home, locale) =>
            renderPowerAlert(delivery, home, (key, variables) =>
              getI18n().t(locale, key, variables),
            ),
        })
      },
      startNotifications() {
        if (!notifications || stopped || timer) {
          return
        }

        flush()
        timer = setInterval(flush, intervalSeconds * 1000)
      },
      stopNotifications() {
        stopped = true
        clearInterval(timer)
        notifications?.stop()
      },
      drainNotifications: () => notifications?.drain() ?? Promise.resolve(),
      close: () => store.close(),
    }
  } catch (error) {
    await store.close()

    throw error
  }
}
