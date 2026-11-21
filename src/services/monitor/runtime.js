import { randomUUID } from 'node:crypto'

import { getI18n } from '../botApi'
import { createChatAccess } from '../chatAccess'
import { createHomeMonitor } from '../homeMonitor'
import { createPowerMonitor, createPowerNotifications } from '../power'
import { createTelegramSendGuard } from '../telegramApiQueue'
import { renderPowerAlert, renderRecurringStatusMessages } from './messages'
import { openMonitorStore } from './store'

export const createMonitorRuntime = async ({
  config,
  directory = config.generalSettings.externalStorageFolder,
  now = Date.now,
  log,
  ...deps
}) => {
  const { homes, intervalSeconds, continuityGraceMinutes } = config.monitor

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
      continuityGraceMinutes,
      now,
      log,
    })

    let notifications

    let timer

    let recurringTimer

    let stopped = false

    const flush = options => {
      void notifications
        .flush(options)
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
          now,
          getStatuses: homeMonitor.getStatuses,
          send: (chatId, text, isAllowed, options) =>
            api.sendMessage(
              chatId,
              text,
              options,
              createTelegramSendGuard(isAllowed),
            ),
          renderAlert: (delivery, home, locale) =>
            renderPowerAlert(delivery, home, (key, variables) =>
              getI18n().t(locale, key, variables),
            ),
          renderStatus: (status, home, locale) =>
            renderRecurringStatusMessages(
              { ...status, timeZone: home.timeZone },
              (key, variables) => getI18n().t(locale, key, variables),
            ),
        })
      },
      startNotifications() {
        if (!notifications || stopped || timer) {
          return
        }

        flush()
        timer = setInterval(flush, intervalSeconds * 1000)

        if (
          60 % intervalSeconds !== 0 &&
          homes.some(home => home.notificationIntervalMinutes > 0)
        ) {
          recurringTimer = setInterval(
            () => flush({ includeAlerts: false }),
            60000,
          )
        }
      },
      stopNotifications() {
        stopped = true
        clearInterval(timer)
        clearInterval(recurringTimer)
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
