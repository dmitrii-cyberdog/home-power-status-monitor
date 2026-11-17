import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const sourceDirectory = fileURLToPath(new URL('../../src/', import.meta.url))

process.chdir(sourceDirectory)

const [{ default: config }, { Logger }] = await Promise.all([
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
