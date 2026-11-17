const idPattern = /^[1-9]\d*$/

const chatPattern = /^-?[1-9]\d*$/

const status = value => ['on', 'off', 'unknown'].includes(value)

const date = value =>
  typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value

const nullableDate = value => value === null || date(value)

const count = value => Number.isSafeInteger(value) && value >= 0

const text = value => typeof value === 'string' && value.length > 0

const object = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const exactKeys = (value, keys) =>
  object(value) &&
  Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key))

const homeId = value =>
  typeof value === 'string' &&
  idPattern.test(value) &&
  Number.isSafeInteger(Number(value))

export const isChatId = value =>
  typeof value === 'string' &&
  chatPattern.test(value) &&
  Number.isSafeInteger(Number(value))

const episode = value =>
  value === null ||
  (exactKeys(value, ['detectedAt', 'baseline']) &&
    date(value.detectedAt) &&
    typeof value.baseline === 'boolean')

export const createHomeRecord = id => ({
  version: 1,
  id,
  sample: null,
  lastDecisiveStatus: 'unknown',
  lastDecisiveAt: null,
  lastOn: null,
  lastOff: null,
  stateSince: null,
  continuous: false,
  trackingSince: null,
  accountedAt: null,
  stats: { onMs: 0, offMs: 0, uncertainMs: 0, outageCount: 0 },
  eventSequence: 0,
  pendingDeliveries: [],
  droppedAlerts: 0,
})

export const createChatRegistry = () => ({
  version: 1,
  verifier: null,
  generation: null,
  chats: {},
})

export const validateHomeRecord = (value, id) => {
  const v = value

  const valid =
    exactKeys(v, Object.keys(createHomeRecord(id))) &&
    v.version === 1 &&
    homeId(v.id) &&
    v.id === id &&
    status(v.lastDecisiveStatus) &&
    nullableDate(v.lastDecisiveAt) &&
    episode(v.lastOn) &&
    episode(v.lastOff) &&
    nullableDate(v.stateSince) &&
    nullableDate(v.trackingSince) &&
    nullableDate(v.accountedAt) &&
    typeof v.continuous === 'boolean' &&
    exactKeys(v.stats, ['onMs', 'offMs', 'uncertainMs', 'outageCount']) &&
    ['onMs', 'offMs', 'uncertainMs', 'outageCount'].every(key =>
      count(v.stats[key]),
    ) &&
    count(v.eventSequence) &&
    count(v.droppedAlerts) &&
    (v.sample === null ||
      (exactKeys(v.sample, ['status', 'observedAt', 'runId']) &&
        status(v.sample.status) &&
        date(v.sample.observedAt) &&
        text(v.sample.runId))) &&
    Array.isArray(v.pendingDeliveries) &&
    v.pendingDeliveries.length <= 1000

  if (!valid) {
    throw new Error('Invalid home record')
  }

  const identities = new Set()

  for (const delivery of v.pendingDeliveries) {
    if (
      !exactKeys(delivery, [
        'eventId',
        'sequence',
        'state',
        'detectedAt',
        'baseline',
        'uncertain',
        'chatId',
        'generation',
        'subscriptionId',
        'locale',
      ]) ||
      !count(delivery.sequence) ||
      delivery.sequence < 1 ||
      delivery.sequence > v.eventSequence ||
      delivery.eventId !== `${id}:${delivery.sequence}` ||
      !['on', 'off'].includes(delivery.state) ||
      !date(delivery.detectedAt) ||
      typeof delivery.baseline !== 'boolean' ||
      typeof delivery.uncertain !== 'boolean' ||
      !isChatId(delivery.chatId) ||
      !text(delivery.generation) ||
      !text(delivery.subscriptionId) ||
      !['en', 'ru'].includes(delivery.locale) ||
      identities.has(`${delivery.eventId}/${delivery.chatId}`)
    ) {
      throw new Error('Invalid delivery record')
    }

    identities.add(`${delivery.eventId}/${delivery.chatId}`)
  }

  return v
}

export const validateChatRegistry = value => {
  const v = value

  if (
    !exactKeys(v, ['version', 'verifier', 'generation', 'chats']) ||
    v.version !== 1 ||
    !(v.generation === null || text(v.generation)) ||
    !(
      v.verifier === null ||
      (exactKeys(v.verifier, ['salt', 'digest']) &&
        /^[a-f0-9]{32}$/.test(v.verifier.salt) &&
        /^[a-f0-9]{128}$/.test(v.verifier.digest))
    ) ||
    !object(v.chats)
  ) {
    throw new Error('Invalid chat registry')
  }

  for (const [id, chat] of Object.entries(v.chats)) {
    if (
      !isChatId(id) ||
      !(
        exactKeys(chat, ['authorizedGeneration', 'locale', 'subscriptions']) ||
        exactKeys(chat, [
          'authorizedGeneration',
          'grantId',
          'locale',
          'subscriptions',
        ])
      ) ||
      !(
        chat.authorizedGeneration === null || text(chat.authorizedGeneration)
      ) ||
      !(
        !Object.hasOwn(chat, 'grantId') ||
        chat.grantId === null ||
        text(chat.grantId)
      ) ||
      !['en', 'ru'].includes(chat.locale) ||
      !object(chat.subscriptions) ||
      Object.entries(chat.subscriptions).some(
        ([home, subscription]) =>
          !homeId(home) ||
          !exactKeys(subscription, ['id']) ||
          !text(subscription.id),
      )
    ) {
      throw new Error('Invalid chat registry')
    }
  }

  return v
}
