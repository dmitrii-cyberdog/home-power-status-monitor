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
  log,
}) => {
  let stopped = false

  let pending = null

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

  const sendDelivery = async (home, delivery) => {
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
        for (const text of renderAlert(delivery, home, locale)) {
          if (stopped || !access.isDeliveryAllowed(delivery)) {
            return false
          }

          await send(chatId, text, canDispatch)

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

  const pass = async () => {
    const pairs = []

    for (const home of homes) {
      const groups = new Map()

      for (const delivery of store.readHome(home.id).pendingDeliveries) {
        if (!groups.has(delivery.chatId)) {
          groups.set(delivery.chatId, [])
        }

        groups.get(delivery.chatId).push(delivery)
      }

      for (const deliveries of groups.values()) {
        pairs.push({
          home,
          deliveries: deliveries.sort((a, b) => a.sequence - b.sequence),
        })
      }
    }

    let index = 0

    const worker = async () => {
      while (!stopped && index < pairs.length) {
        const { home, deliveries } = pairs[index++]

        for (const delivery of deliveries) {
          if (stopped) {
            break
          }

          try {
            if (!(await sendDelivery(home, delivery))) {
              break
            }

            await remove(home.id, delivery)
          } catch (error) {
            // A send refused at dispatch is a stale alert, not a failure.
            if (isTelegramSendSkipped(error)) {
              await remove(home.id, delivery)
              continue
            }

            if (unavailableChat(error)) {
              await access.disableSubscriptions(delivery)
            }

            log?.error('Power alert delivery failed', {
              homeId: home.id,
              eventId: delivery.eventId,
            })
            break
          }
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
    flush() {
      if (stopped || !send) {
        return Promise.resolve()
      }

      pending ??= pass().finally(() => {
        pending = null
      })

      return pending
    },
    stop() {
      stopped = true
    },
    drain: () => pending ?? Promise.resolve(),
  }
}
