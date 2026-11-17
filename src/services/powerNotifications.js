import { renderPowerAlert } from '../api/bot/monitorMessages'

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
  translate,
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
            if (!access.isDeliveryAllowed(delivery)) {
              await remove(home.id, delivery)
              continue
            }

            let complete = true

            for (const text of renderPowerAlert(
              delivery,
              home,
              translate(delivery.locale),
            )) {
              if (stopped || !access.isDeliveryAllowed(delivery)) {
                complete = false
                break
              }

              await send(delivery.chatId, text)
            }

            if (!complete) {
              break
            }

            await remove(home.id, delivery)
          } catch (error) {
            if (unavailableChat(error)) {
              await access.disableSubscriptions(delivery.chatId)
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
