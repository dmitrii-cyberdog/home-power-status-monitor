import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const derive = promisify(scrypt)

const digest = (secret, salt) =>
  derive(secret, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 })

const localeOf = locale => (locale === 'ru' ? 'ru' : 'en')

export const createChatAccess = ({
  store,
  secret = '',
  homes,
  now = Date.now,
}) => {
  let ready = false

  const attempts = new Map()

  const known = new Set(homes.map(home => home.id))

  const isAuthorizedIn = (chatId, registry) =>
    ready &&
    Boolean(secret) &&
    registry.chats[String(chatId)]?.authorizedGeneration === registry.generation

  const isAuthorized = chatId => isAuthorizedIn(chatId, store.readChats())

  const recipients = (homeId, registry) => {
    if (!ready || !secret || !known.has(homeId)) {
      return []
    }

    return Object.entries(registry.chats)
      .filter(
        ([, chat]) =>
          chat.authorizedGeneration === registry.generation &&
          chat.subscriptions[homeId],
      )
      .map(([chatId, chat]) => ({
        chatId,
        generation: registry.generation,
        subscriptionId: chat.subscriptions[homeId].id,
        locale: chat.locale,
      }))
  }

  const isDeliveryAllowedIn = (delivery, registry) => {
    const homeId = delivery.eventId.split(':')[0]

    return (
      known.has(homeId) &&
      isAuthorizedIn(delivery.chatId, registry) &&
      registry.generation === delivery.generation &&
      registry.chats[delivery.chatId].subscriptions[homeId]?.id ===
        delivery.subscriptionId
    )
  }

  return {
    async initialize() {
      const previous = store.readChats()

      const matches =
        secret &&
        previous.verifier &&
        timingSafeEqual(
          await digest(secret, previous.verifier.salt),
          Buffer.from(previous.verifier.digest, 'hex'),
        )

      if (
        !matches &&
        (secret || previous.verifier || previous.generation === null)
      ) {
        const salt = randomBytes(16).toString('hex')

        const verifier = secret
          ? { salt, digest: (await digest(secret, salt)).toString('hex') }
          : null

        await store.updateChats(registry => {
          registry.verifier = verifier
          registry.generation = randomUUID()

          for (const chat of Object.values(registry.chats)) {
            chat.authorizedGeneration = null
          }

          return registry
        })
      }

      ready = true
    },
    isAuthorized,
    isSubscribed(chatId, homeId) {
      const registry = store.readChats()

      return (
        known.has(homeId) &&
        isAuthorizedIn(chatId, registry) &&
        Boolean(registry.chats[String(chatId)].subscriptions[homeId])
      )
    },
    async authorize(chatId, suppliedSecret, locale) {
      if (!ready || !secret) {
        return 'disabled'
      }

      const id = String(chatId)

      const time = now()

      const window = attempts.get(id)

      const recent =
        window && time >= window.start && time - window.start < 60000
          ? window
          : { start: time, count: 0 }

      if (recent.count >= 5) {
        return 'rate_limited'
      }

      recent.count++
      attempts.set(id, recent)

      for (const [key, entry] of attempts) {
        if (time - entry.start >= 60000) {
          attempts.delete(key)
        }
      }

      const registry = store.readChats()

      if (
        !timingSafeEqual(
          await digest(suppliedSecret, registry.verifier.salt),
          Buffer.from(registry.verifier.digest, 'hex'),
        )
      ) {
        return 'invalid'
      }

      await store.updateChats(next => {
        next.chats[id] ??= {
          authorizedGeneration: null,
          locale: localeOf(locale),
          subscriptions: {},
        }
        next.chats[id].authorizedGeneration = next.generation
        next.chats[id].locale = localeOf(locale)

        return next
      })

      return 'authorized'
    },
    async setSubscription(chatId, homeId, enabled, locale) {
      const id = String(chatId)

      if (!isAuthorized(id) || !known.has(homeId)) {
        throw new Error('Access denied')
      }

      let result

      await store.updateChats(registry => {
        if (!isAuthorizedIn(id, registry)) {
          throw new Error('Access denied')
        }

        const chat = registry.chats[id]

        const existing = chat.subscriptions[homeId]

        result = enabled
          ? existing
            ? 'already_enabled'
            : 'enabled'
          : existing
            ? 'disabled'
            : 'already_disabled'
        chat.locale = localeOf(locale)

        if (enabled && !existing) {
          chat.subscriptions[homeId] = { id: randomUUID() }
        } else if (!enabled) {
          delete chat.subscriptions[homeId]
        }

        return registry
      })

      return result
    },
    async clearChats(target) {
      let removed = 0

      await store.updateChats(registry => {
        if (target === 'all') {
          removed = Object.keys(registry.chats).length
          registry.chats = {}
        } else if (Object.hasOwn(registry.chats, target)) {
          removed = 1
          delete registry.chats[target]
        }

        return registry
      })

      return removed
    },
    recipients,
    isDeliveryAllowed(delivery) {
      return isDeliveryAllowedIn(delivery, store.readChats())
    },
    async disableSubscriptions(delivery) {
      await store.updateChats(registry => {
        if (isDeliveryAllowedIn(delivery, registry)) {
          registry.chats[delivery.chatId].subscriptions = {}
        }

        return registry
      })
    },
  }
}
