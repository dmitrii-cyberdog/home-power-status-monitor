import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const configUrl = new URL('../../src/config/config.js', import.meta.url).href
const register = import.meta.resolve('extensionless/register')

const loadConfig = (t, overrides = {}, files = {}) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'power-config-'))

  t.after(() => rmSync(directory, { recursive: true, force: true }))

  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(directory, name), content)
  }

  const environment = { ...process.env }

  delete environment.NODE_ENV

  for (const key of Object.keys(environment)) {
    if (/^(HOME_|DEVICE_|EZVIZ_|POWER_|TG_ADMIN_)/.test(key)) {
      delete environment[key]
    }
  }

  for (const key of [
    'TG_BOT_TOKEN',
    'TG_BOT_ACCESS_SECRET',
    'DEFAULT_LOCALE',
    'CRON_CHECK_POWER_STATUS_IS_ENABLED',
    'CRON_CHECK_POWER_STATUS_TEMPLATE',
  ]) {
    delete environment[key]
  }

  return spawnSync(
    process.execPath,
    [
      '--import',
      register,
      '--input-type=module',
      '--eval',
      `const { default: config } = await import(${JSON.stringify(configUrl)});
       process.stdout.write(JSON.stringify(config));`,
    ],
    {
      cwd: directory,
      env: { ...environment, ...overrides },
      encoding: 'utf8',
      timeout: 5000,
    },
  )
}

test('configuration has no HTTP settings and defaults to disabled bot and cron', t => {
  const result = loadConfig(t)

  assert.equal(result.status, 0, result.stderr)

  const config = JSON.parse(result.stdout)

  assert.equal(config.appSettings, undefined)
  assert.equal(config.botSettings.token, '')
  assert.deepEqual(config.botSettings.admins, [])
  assert.deepEqual(config.cron.checkPowerStatus, {
    isEnabled: false,
  })
})

test('admin configuration reads sparse slots from dotenv and deduplicates IDs', t => {
  const result = loadConfig(
    t,
    { TG_ADMIN_5: '900' },
    { '.env': 'TG_ADMIN_1=900\nTG_ADMIN_50=910\n' },
  )

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout).botSettings.admins, [900, 910])
})

test('invalid admin IDs fail configuration without exposing their values', t => {
  for (const value of ['900x', '-900', '9007199254740992']) {
    const result = loadConfig(t, { TG_ADMIN_1: value })

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /TG_ADMIN_1/)
    assert.ok(!result.stderr.includes(value))
  }
})

test('dev loads base settings and the dev overlay', t => {
  const result = loadConfig(
    t,
    { NODE_ENV: 'dev' },
    {
      '.env': 'DEFAULT_LOCALE=ru\nTG_BOT_TOKEN=base\n',
      '.env.dev': 'TG_BOT_TOKEN=dev\n',
      '.env.prod': 'TG_BOT_TOKEN=prod\n',
    },
  )

  assert.equal(result.status, 0, result.stderr)

  const config = JSON.parse(result.stdout)

  assert.equal(config.generalSettings.defaultLocale, 'ru')
  assert.equal(config.botSettings.token, 'dev')
})

test('prod loads the prod overlay instead of dev', t => {
  const result = loadConfig(
    t,
    { NODE_ENV: 'prod' },
    {
      '.env': 'TG_BOT_TOKEN=base\n',
      '.env.dev': 'TG_BOT_TOKEN=dev\n',
      '.env.prod': 'TG_BOT_TOKEN=prod\n',
    },
  )

  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).botSettings.token, 'prod')
})

test('local is the default and never loads server overlays', t => {
  const result = loadConfig(
    t,
    {},
    {
      '.env': 'TG_BOT_TOKEN=base\n',
      '.env.dev': 'TG_BOT_TOKEN=dev\n',
      '.env.prod': 'TG_BOT_TOKEN=prod\n',
    },
  )

  assert.equal(result.status, 0, result.stderr)

  const config = JSON.parse(result.stdout)

  assert.equal(config.envName, 'local')
  assert.equal(config.isDebug, true)
  assert.equal(config.botSettings.token, 'base')
})

test('supported modes select debug logging and reject legacy mode names', t => {
  for (const mode of ['local', 'dev', 'prod', 'test']) {
    const result = loadConfig(t, { NODE_ENV: mode })

    assert.equal(result.status, 0, result.stderr)

    const config = JSON.parse(result.stdout)

    assert.equal(config.envName, mode)
    assert.equal(config.isDebug, ['local', 'dev'].includes(mode))
  }

  for (const mode of ['development', 'production', 'invalid']) {
    const result = loadConfig(t, { NODE_ENV: mode })

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /NODE_ENV must be local, dev, prod or test/)
  }
})

test('local settings override base and selected environment settings', t => {
  const result = loadConfig(
    t,
    { NODE_ENV: 'dev' },
    {
      '.env': 'TG_BOT_TOKEN=base\n',
      '.env.dev': 'TG_BOT_TOKEN=dev\n',
      '.env.local':
        'TG_BOT_TOKEN=local\nCRON_CHECK_POWER_STATUS_IS_ENABLED=1\n',
    },
  )

  assert.equal(result.status, 0, result.stderr)

  const config = JSON.parse(result.stdout)

  assert.equal(config.botSettings.token, 'local')
  assert.equal(config.cron.checkPowerStatus.isEnabled, true)
})

test('exported environment takes precedence over every dotenv file', t => {
  const result = loadConfig(
    t,
    { TG_BOT_TOKEN: 'exported' },
    {
      '.env': 'TG_BOT_TOKEN=base\n',
      '.env.dev': 'TG_BOT_TOKEN=dev\n',
      '.env.local': 'TG_BOT_TOKEN=local\n',
    },
  )

  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).botSettings.token, 'exported')
})

test('test environment skips all dotenv files', t => {
  const result = loadConfig(
    t,
    { NODE_ENV: 'test' },
    {
      '.env': 'DEFAULT_LOCALE=invalid\n',
      '.env.local': 'TG_BOT_TOKEN=must-not-load\n',
    },
  )

  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).botSettings.token, '')
})
