import {
  isNonemptyString,
  isNonnegativeInteger,
  isObject,
  isUtcTimestamp,
  nullable,
  strictShape,
} from '../validation'

const homeIdPattern = /^[1-9]\d*$/

const chatIdPattern = /^-?[1-9]\d*$/

const isHomeId = value =>
  typeof value === 'string' &&
  homeIdPattern.test(value) &&
  Number.isSafeInteger(Number(value))

export const isChatId = value =>
  typeof value === 'string' &&
  chatIdPattern.test(value) &&
  Number.isSafeInteger(Number(value))

const isPowerState = value => ['on', 'off'].includes(value)

const isObservationState = value => isPowerState(value) || value === 'unknown'

const isLocale = value => ['en', 'ru'].includes(value)

const isBoolean = value => typeof value === 'boolean'

const isVersionOne = value => value === 1

const isOptionalTimestamp = nullable(isUtcTimestamp)

const isOptionalText = nullable(isNonemptyString)

//
//

const episode = strictShape({
  detectedAt: isUtcTimestamp,
  baseline: isBoolean,
})

const sample = strictShape({
  status: isObservationState,
  observedAt: isUtcTimestamp,
  runId: isNonemptyString,
})

const stats = strictShape({
  onMs: isNonnegativeInteger,
  offMs: isNonnegativeInteger,
  uncertainMs: isNonnegativeInteger,
  outageCount: isNonnegativeInteger,
})

const homeRecord = strictShape({
  version: isVersionOne,
  id: isHomeId,
  sample: nullable(sample),
  lastDecisiveStatus: isObservationState,
  lastDecisiveAt: isOptionalTimestamp,
  lastOn: nullable(episode),
  lastOff: nullable(episode),
  stateSince: isOptionalTimestamp,
  continuous: isBoolean,
  trackingSince: isOptionalTimestamp,
  accountedAt: isOptionalTimestamp,
  stats,
  eventSequence: isNonnegativeInteger,
  pendingDeliveries: value => Array.isArray(value) && value.length <= 1000,
  droppedAlerts: isNonnegativeInteger,
})

const deliveryRecord = strictShape({
  eventId: isNonemptyString,
  sequence: value => isNonnegativeInteger(value) && value >= 1,
  state: isPowerState,
  detectedAt: isUtcTimestamp,
  baseline: isBoolean,
  uncertain: isBoolean,
  chatId: isChatId,
  generation: isNonemptyString,
  subscriptionId: isNonemptyString,
  locale: isLocale,
})

//
//

const verifier = strictShape({
  salt: value => /^[a-f0-9]{32}$/.test(value),
  digest: value => /^[a-f0-9]{128}$/.test(value),
})

const subscriptionRecord = strictShape({ id: isNonemptyString })

const chatFields = {
  authorizedGeneration: isOptionalText,
  locale: isLocale,
  subscriptions: value =>
    isObject(value) &&
    Object.entries(value).every(
      ([homeId, subscription]) =>
        isHomeId(homeId) && subscriptionRecord(subscription),
    ),
}

const legacyChatRecord = strictShape(chatFields)

const chatRecord = strictShape({ ...chatFields, grantId: isOptionalText })

const chatRegistry = strictShape({
  version: isVersionOne,
  verifier: nullable(verifier),
  generation: isOptionalText,
  chats: value =>
    isObject(value) &&
    Object.entries(value).every(
      ([id, chat]) =>
        isChatId(id) && (legacyChatRecord(chat) || chatRecord(chat)),
    ),
})

//
//

export const validateHomeRecord = (value, id) => {
  if (!homeRecord(value) || value.id !== id) {
    throw new Error('Invalid home record')
  }

  const identities = new Set()

  for (const delivery of value.pendingDeliveries) {
    if (
      !deliveryRecord(delivery) ||
      delivery.sequence > value.eventSequence ||
      delivery.eventId !== `${id}:${delivery.sequence}`
    ) {
      throw new Error('Invalid delivery record')
    }

    const identity = `${delivery.eventId}/${delivery.chatId}`

    if (identities.has(identity)) {
      throw new Error('Invalid delivery record')
    }

    identities.add(identity)
  }

  return value
}

export const validateChatRegistry = value => {
  if (!chatRegistry(value)) {
    throw new Error('Invalid chat registry')
  }

  return value
}
