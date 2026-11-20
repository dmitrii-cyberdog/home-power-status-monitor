import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import axios from 'axios'

const sourceDirectory = fileURLToPath(new URL('../../src/', import.meta.url))

process.chdir(sourceDirectory)

const [
  { default: config },
  { Logger, flushLogger, notifyTelegramAdminStarted },
] = await Promise.all([
  import('../../src/config/config.js'),
  import('../../src/services/logger.js'),
])

test('logger redacts sensitive context and nested payload fields', t => {
  const originalTelegramLogging = config.logs.telegram.isEnabled
  let output

  config.logs.telegram.isEnabled = false
  t.after(() => {
    config.logs.telegram.isEnabled = originalTelegramLogging
  })
  t.mock.method(console, 'log', (...values) => {
    output = values
  })

  const logger = new Logger({ accessToken: 'context-secret-value' })

  logger.info('redaction-test', {
    appKey: 'ezviz-key-sentinel',
    HOME_1_EZVIZ_API_APP_KEY: 'home-key-sentinel',
    appSecret: 'app-secret-sentinel',
    TG_BOT_ACCESS_SECRET: 'chat-secret-sentinel',
    password: 'payload-secret-value',
    nested: { api_key: 'nested-secret-value' },
    safe: 'visible',
  })

  const serialized = JSON.stringify(output)

  assert.doesNotMatch(
    serialized,
    /context-secret-value|payload-secret-value|nested-secret-value|sentinel/,
  )
  assert.match(serialized, /\[REDACTED\]/)
  assert.match(serialized, /visible/)
})

test('logger preserves nested error diagnostics', t => {
  const originalTelegramLogging = config.logs.telegram.isEnabled
  let output

  config.logs.telegram.isEnabled = false
  t.after(() => {
    config.logs.telegram.isEnabled = originalTelegramLogging
  })
  t.mock.method(console, 'log', (...values) => {
    output = values
  })

  const logger = new Logger()

  logger.error('nested-error-test', {
    error: new Error('provider unavailable'),
  })

  assert.match(JSON.stringify(output), /provider unavailable/)
})

test('logger sends startup and error summaries only to Telegram admin slot one', async t => {
  const original = { ...config.botSettings }

  t.after(() => Object.assign(config.botSettings, original))

  Object.assign(config.botSettings, {
    token: 'fake-token',
    primaryAdminId: 100,
    admins: [100, 200],
  })

  const sent = []

  t.mock.method(axios, 'post', async (_url, body) => {
    sent.push(body)
  })
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'error', () => {})

  notifyTelegramAdminStarted()
  Logger.notice('Other notice')
  Logger.warning('Warning')
  new Logger().error('Provider failed', {
    error: new Error('private diagnostic'),
  })
  Logger.critical('Runner failed')
  await flushLogger()

  assert.deepEqual(
    sent.map(body => body.chat_id),
    [100, 100, 100],
  )
  assert.match(sent[0].text, /bot started/i)
  assert.match(sent[1].text, /ERROR.*Provider failed/)
  assert.match(sent[2].text, /CRITICAL.*Runner failed/)
  assert.doesNotMatch(
    JSON.stringify(sent),
    /private diagnostic|Other notice|Warning/,
  )

  config.botSettings.primaryAdminId = null
  Logger.error('No slot one')
  notifyTelegramAdminStarted()

  config.botSettings.primaryAdminId = 100
  config.botSettings.token = ''
  Logger.error('No token')
  await flushLogger()

  assert.equal(sent.length, 3)
})

test('admin Telegram failures stay local and are drained by the logger', async t => {
  const original = { ...config.botSettings }

  t.after(() => Object.assign(config.botSettings, original))

  Object.assign(config.botSettings, {
    token: 'fake-token',
    primaryAdminId: 100,
  })

  const send = Promise.withResolvers()

  const post = t.mock.method(axios, 'post', () => send.promise)
  const report = t.mock.method(console, 'error', () => {})

  t.mock.method(console, 'log', () => {})

  Logger.error('Send me')

  let drained = false

  const flush = flushLogger().then(() => {
    drained = true
  })

  await Promise.resolve()

  assert.equal(drained, false)

  send.reject(new Error('must not appear in diagnostics'))
  await flush

  assert.equal(post.mock.callCount(), 1)
  assert.equal(report.mock.callCount(), 1)
  assert.doesNotMatch(
    JSON.stringify(report.mock.calls[0].arguments),
    /must not appear/,
  )
})
