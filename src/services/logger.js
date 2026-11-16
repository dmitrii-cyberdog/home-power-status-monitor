//
//
// SERVICE LOGGER
// version 0.1.0
//
//

import axios from 'axios'
// import { nanoid } from 'nanoid'

import config from '../config'

import { commonUtils } from '../utils'

const { isError } = commonUtils

//
//

const BROADCAST_LEVELS = {
  emergency: 0,
  alert: 1,
  critical: 2,
  error: 3,
  warning: 4,
  notice: 5,
  info: 6,
  debug: 7,
}

//

const SENSITIVE_KEYS = new Set([
  'apikey',
  'authorization',
  'cookie',
  'password',
  'proxyauthorization',
  'refreshtoken',
  'secret',
  'secretkey',
  'sign',
  'signature',
])
const MAX_LOG_ARRAY_ITEMS = 100
const MAX_LOG_DEPTH = 8
const MAX_LOG_OBJECT_PROPERTIES = 100
const MAX_LOG_STRING_LENGTH = 10000
const SENSITIVE_KEY_SUFFIXES = [
  'apikey',
  'authorization',
  'cookie',
  'password',
  'secret',
  'signature',
  'token',
]

const isSensitiveKey = key => {
  const normalized = key.toLowerCase().replaceAll(/[-_]/g, '')

  return (
    SENSITIVE_KEYS.has(normalized) ||
    SENSITIVE_KEY_SUFFIXES.some(suffix => normalized.endsWith(suffix))
  )
}

const sanitizeValue = (value, depth = 0, seen = new WeakSet()) => {
  if (typeof value === 'string') {
    return value.length > MAX_LOG_STRING_LENGTH
      ? `${value.slice(0, MAX_LOG_STRING_LENGTH)}...*truncated*`
      : value
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  if (isError(value)) {
    return sanitizeError(value)
  }

  if (Buffer.isBuffer(value)) {
    return `*buffer:${value.length} bytes*`
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value instanceof URL) {
    return `${value.origin}${value.pathname}`
  }

  if (depth >= MAX_LOG_DEPTH) {
    return '*max_depth*'
  }

  if (seen.has(value)) {
    return '*circular*'
  }

  seen.add(value)

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_LOG_ARRAY_ITEMS)
      .map(item => sanitizeValue(item, depth + 1, seen))
  }

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, MAX_LOG_OBJECT_PROPERTIES)
      .map(([key, item]) => [
        key,
        isSensitiveKey(key)
          ? '[REDACTED]'
          : sanitizeValue(item, depth + 1, seen),
      ]),
  )
}

//
//

const sanitizeError = error => ({
  message: error.message,
  stack: error.stack,
  //
  ...(typeof error.status !== 'undefined' ? { status: error.status } : {}),
  ...(typeof error.code !== 'undefined' ? { code: error.code } : {}),
})

const normalizeExtra = extra =>
  extra.map(item => {
    if (isError(item)) {
      return sanitizeError(item)
    }

    return sanitizeValue(item)
  })

const buildPayload = (message, extra, context = {}) => {
  let finalExtra = extra.length > 0 ? normalizeExtra(extra) : null

  if (finalExtra?.length === 1) {
    finalExtra = finalExtra[0]
  }

  //
  //

  return {
    main: {
      ts: new Date().toISOString(),
      env: config.envName,
      service: config.logs.info.name,
      message,
      //
      ...sanitizeValue(context),
    },
    additional:
      finalExtra && Object.keys(finalExtra).length > 0 ? finalExtra : '',
  }
}

//
//

const broadcastTelegram = async (payload, isImportant = false) => {
  // pre-check if we have the necessary config to send logs to telegram
  if (
    !config.logs.telegram.botToken ||
    (!isImportant && !config.logs.telegram.group) ||
    (isImportant && !config.logs.telegram.groupImportant)
  ) {
    return
  }

  //

  const stacks = []

  let text = [
    `[${payload.main.service}] ${payload.main.message}`,
    payload.main.command ? `command: ${payload.main.command}` : null,
    payload.main.chatId ? `chatId: ${payload.main.chatId}` : null,
  ]

  for (const key in payload.additional) {
    if (payload.additional[key]?.stack) {
      stacks.push(
        `<pre>${JSON.stringify(payload.additional[key].stack, null, 2)
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replace('\\n', '')
          .replaceAll('\\n', '\n')
          .replaceAll('"', '')}</pre>`,
      )

      delete payload.additional[key].stack
    }
  }

  text.push(
    Object.keys(payload.additional || {}).length
      ? `<pre language="json">${JSON.stringify(payload.additional, null, 2)
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')}</pre>`
      : null,
    ...stacks,
  )

  text = text.filter(Boolean).join('\n')

  if (text.length > 4096) {
    text = text.substring(0, 4000)

    // match <pre tags if we have open and not closed
    const preTags = text.match(/<pre/g) || []
    const preTagsClosed = text.match(/<\/pre>/g) || []

    const preTagsToClose = preTags.length - preTagsClosed.length

    // close all open <pre> tags
    for (let i = 0; i < preTagsToClose; i++) {
      text += '</pre>'
    }

    text = text + '\n\n<pre>!!! Message truncated !!!</pre>'
  }

  const chatId = isImportant
    ? config.logs.telegram.groupImportant
    : config.logs.telegram.group

  try {
    await axios.post(
      `https://api.telegram.org/bot${config.logs.telegram.botToken}/sendMessage`,
      {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      },
      {
        timeout: 5000,
        maxBodyLength: 64 * 1024,
        maxContentLength: 64 * 1024,
      },
    )
  } catch (error) {
    console.error('logger_telegram_broadcast_error', {
      status: error.response?.status,
      chat_id: chatId,
    })
  }
}

const pendingTelegramBroadcasts = new Set()
const MAX_PENDING_TELEGRAM_BROADCASTS = 3

const queueTelegramBroadcast = (payload, isImportant = false) => {
  if (pendingTelegramBroadcasts.size >= MAX_PENDING_TELEGRAM_BROADCASTS) {
    return
  }

  const task = broadcastTelegram(payload, isImportant).finally(() => {
    pendingTelegramBroadcasts.delete(task)
  })

  pendingTelegramBroadcasts.add(task)
}

export const flushLogger = async () => {
  await Promise.allSettled([...pendingTelegramBroadcasts])
}

//
//

class Logger {
  constructor(context = {}) {
    this.extra = context
  }

  log(level, message, ...extra) {
    if (level === 'debug' && !config.isDebug) {
      return
    }

    const payload = buildPayload(message, extra, this.extra)

    //
    // * CONSOLE LOGGING LOGIC
    //

    const consoleMessage = payload.main.message || ''

    // different fn according to the level
    switch (level) {
      case 'emergency':
      case 'alert':
      case 'critical':
        console.error(
          '\x1b[31m%s\x1b[0m',
          consoleMessage,
          payload.main,
          payload.additional,
        ) // red
        break
      case 'error':
      case 'warning':
        console.log(
          '\x1b[33m%s\x1b[0m',
          consoleMessage,
          payload.main,
          payload.additional,
        ) // yellow
        break
      case 'notice':
      case 'info':
        console.log(
          '\x1b[32m%s\x1b[0m',
          consoleMessage,
          payload.main,
          payload.additional,
        ) // green
        break
      // debug
      case 'debug':
        console.log(
          '\x1b[36m%s\x1b[0m',
          consoleMessage,
          payload.main,
          payload.additional,
        ) // cyan
        break
      default:
        console.log(consoleMessage, payload.main, payload.additional) // default color
    }

    //
    // * TELEGRAM BROADCASTING LOGIC
    // if important, send to important group, otherwise send to normal group, don't send twice
    //

    if (
      config.logs.telegram.isEnabled &&
      BROADCAST_LEVELS[level] <= config.logs.telegram.sensitivityImportant
    ) {
      queueTelegramBroadcast(payload, true)
    } else if (
      config.logs.telegram.isEnabled &&
      BROADCAST_LEVELS[level] <= config.logs.telegram.sensitivity
    ) {
      queueTelegramBroadcast(payload)
    }
  }

  emergency(message, ...extra) {
    this.log('emergency', message, ...extra)
  }

  alert(message, ...extra) {
    this.log('alert', message, ...extra)
  }

  critical(message, ...extra) {
    this.log('critical', message, ...extra)
  }

  error(message, ...extra) {
    this.log('error', message, ...extra)
  }

  warning(message, ...extra) {
    this.log('warning', message, ...extra)
  }

  notice(message, ...extra) {
    this.log('notice', message, ...extra)
  }

  info(message, ...extra) {
    this.log('info', message, ...extra)
  }

  debug(message, ...extra) {
    this.log('debug', message, ...extra)
  }

  static emergency(message, ...extra) {
    defaultLogger.emergency(message, ...extra)
  }

  static alert(message, ...extra) {
    defaultLogger.alert(message, ...extra)
  }

  static critical(message, ...extra) {
    defaultLogger.critical(message, ...extra)
  }

  static error(message, ...extra) {
    defaultLogger.error(message, ...extra)
  }

  static warning(message, ...extra) {
    defaultLogger.warning(message, ...extra)
  }

  static notice(message, ...extra) {
    defaultLogger.notice(message, ...extra)
  }

  static info(message, ...extra) {
    defaultLogger.info(message, ...extra)
  }

  static debug(message, ...extra) {
    defaultLogger.debug(message, ...extra)
  }
}

//
//

const defaultLogger = new Logger({
  // traceId: nanoid(),
})

//
//

export { Logger }

export default defaultLogger
