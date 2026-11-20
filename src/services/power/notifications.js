import { isTelegramSendSkipped } from '../telegramApiQueue'

const unavailableChat = error =>
  error?.error_code === 403 &&
  [
    'Forbidden: bot was blocked by the user',
    'Forbidden: bot was kicked from the group chat',
    'Forbidden: bot was kicked from the supergroup chat',
    'Forbidden: user is deactivated',
  ].includes(error.description)

export const createPowerNotifications = ({
  store,
  access,
  homes,
  send,
  renderAlert,
  renderStatus,
  getStatuses,
  now = Date.now,
  log,
}) => {
  let stopped = false

  let pendingAlerts = null

  let pendingStatus = null

  const statusCadences = new Map(
    homes
      .filter(home => home.notificationIntervalMinutes > 0)
      .map(home => [
        home.id,
        { intervalMs: home.notificationIntervalMinutes * 60000 },
      ]),
  )

  const dueHomes = () => {
    const due = new Set()

    if (!statusCadences.size) {
      return due
    }

    const time = now()

    for (const [homeId, cadence] of statusCadences) {
      cadence.anchor ??= time

      const elapsed = time - cadence.anchor

      if (elapsed >= cadence.intervalMs) {
        cadence.anchor = time - (elapsed % cadence.intervalMs)
        due.add(homeId)
      }
    }

    return due
  }

  const remove = (homeId, delivery) =>
    store.updateHome(homeId, record => {
      record.pendingDeliveries = record.pendingDeliveries.filter(
        entry =>
          !(
            entry.eventId === delivery.eventId &&
            entry.chatId === delivery.chatId
          ),
      )

      return record
    })

  const sendDelivery = async (home, delivery, status) => {
    const { chatId } = delivery

    while (!stopped) {
      if (!access.isDeliveryAllowed(delivery)) {
        return true
      }

      const locale = access.getLocale(chatId)

      let started = false

      let localeChanged = false

      const canDispatch = () => {
        if (!access.isDeliveryAllowed(delivery)) {
          return false
        }

        // Keep all chunks in the same language once the first has been sent.
        localeChanged = !started && access.getLocale(chatId) !== locale

        return !localeChanged
      }

      try {
        const messages = status
          ? renderStatus(status, home, locale)
          : renderAlert(delivery, home, locale)

        for (const text of messages) {
          if (stopped || !access.isDeliveryAllowed(delivery)) {
            return false
          }

          await send(
            chatId,
            text,
            canDispatch,
            status ? { parse_mode: 'HTML' } : undefined,
          )

          started = true
        }

        return true
      } catch (error) {
        if (!localeChanged || !isTelegramSendSkipped(error)) {
          throw error
        }
      }
    }

    return false
  }

  const dispatch = async (home, delivery, status) => {
    try {
      if (!(await sendDelivery(home, delivery, status))) {
        return false
      }

      if (!status) {
        await remove(home.id, delivery)
      }

      return true
    } catch (error) {
      // A send refused at dispatch is a stale alert, not a failure.
      if (isTelegramSendSkipped(error)) {
        if (!status) {
          await remove(home.id, delivery)
        }

        return true
      }

      if (unavailableChat(error)) {
        await access.disableSubscriptions(delivery)
      }

      log?.error(
        status
          ? 'Periodic power status delivery failed'
          : 'Power alert delivery failed',
        {
          homeId: home.id,
          eventId: delivery.eventId,
        },
      )

      return false
    }
  }

  const pass = async includeAlerts => {
    const pairs = []

    const due = dueHomes()

    const statuses = due.size
      ? new Map(getStatuses().map(status => [status.id, status]))
      : new Map()

    const registry = due.size ? store.readChats() : null

    for (const home of homes) {
      const groups = new Map()

      const groupFor = chatId => {
        if (!groups.has(chatId)) {
          groups.set(chatId, { home, deliveries: [] })
        }

        return groups.get(chatId)
      }

      if (includeAlerts) {
        for (const delivery of store.readHome(home.id).pendingDeliveries) {
          groupFor(delivery.chatId).deliveries.push(delivery)
        }
      }

      if (due.has(home.id)) {
        for (const recipient of access.recipients(home.id, registry)) {
          groupFor(recipient.chatId).periodic = {
            delivery: { ...recipient, eventId: `${home.id}:status` },
            status: statuses.get(home.id),
          }
        }
      }

      for (const group of groups.values()) {
        group.deliveries.sort((a, b) => a.sequence - b.sequence)
        pairs.push(group)
      }
    }

    let index = 0

    const worker = async () => {
      while (!stopped && index < pairs.length) {
        const { home, deliveries, periodic } = pairs[index++]

        for (const delivery of deliveries) {
          if (stopped || !(await dispatch(home, delivery))) {
            break
          }
        }

        if (periodic && !stopped) {
          await dispatch(home, periodic.delivery, periodic.status)
        }
      }
    }

    const results = await Promise.allSettled(
      Array.from({ length: Math.min(4, pairs.length) }, worker),
    )

    if (results.some(result => result.status === 'rejected')) {
      throw new Error('Notification pass persistence failed')
    }
  }

  return {
    flush({ includeAlerts = true } = {}) {
      if (stopped || !send) {
        return Promise.resolve()
      }

      if (pendingAlerts) {
        return pendingAlerts
      }

      if (includeAlerts) {
        const runAlerts = () => {
          if (!stopped) {
            return pass(true)
          }
        }

        // Keep the scheduled alert tick even if a periodic status send is busy.
        const alerts = pendingStatus
          ? pendingStatus.finally(runAlerts)
          : pass(true)

        pendingAlerts = alerts.finally(() => {
          pendingAlerts = null
        })

        return pendingAlerts
      }

      pendingStatus ??= pass(false).finally(() => {
        pendingStatus = null
      })

      return pendingStatus
    },
    stop() {
      stopped = true
    },
    drain: () => pendingAlerts ?? pendingStatus ?? Promise.resolve(),
  }
}
