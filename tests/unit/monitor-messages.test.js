import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { I18n } from '@grammyjs/i18n'

import * as messages from '../../src/api/bot/monitorMessages.js'
import config from '../../src/config/config.js'

const { renderStatusMessages } = messages

const home = (patch = {}) => ({
  id: '1',
  name: 'Home',
  status: 'on',
  observedAt: new Date(0).toISOString(),
  lastOn: { detectedAt: new Date(0).toISOString(), baseline: true },
  lastOff: null,
  stateSince: new Date(0).toISOString(),
  durationMs: 60000,
  uncertain: false,
  stats: { onMs: 60000, offMs: 0, uncertainMs: 0, outageCount: 0 },
  unobservedTailMs: 0,
  devices: [
    {
      id: '1',
      name: 'Camera',
      status: 'unknown',
      observedAt: new Date(0).toISOString(),
      offlineStreak: 0,
      errorCode: 'auth_failed',
    },
  ],
  ...patch,
})

const translate = locale => {
  const i18n = new I18n(config.botSettings.i18nSettings)

  return (key, variables) =>
    i18n.t(locale, key, variables).replace(/[\u2068\u2069]/g, '')
}

test('brief status shows only current state, duration and opposite detection', () => {
  const t = translate('en')
  const on = renderStatusMessages([home({ durationMs: 183600000 })], t).join(
    '\n',
  )

  assert.match(on, /Power on for 2 days 3 hours/)
  assert.match(on, /since detection/)
  assert.match(on, /Last power off: Not observed/)
  assert.doesNotMatch(on, /Cumulative|outages|Last observation|auth_failed/)

  const off = renderStatusMessages([home({ status: 'off' })], t).join('\n')

  assert.match(off, /Power off for 1 minute/)
  assert.match(off, /Last power on: 1970-01-01 00:00 UTC/)
})

test('brief duration boundaries use readable localized units', () => {
  for (const [locale, expected] of [
    ['en', ['less than a minute', '1 minute', '1 hour', '1 day']],
    ['ru', ['меньше минуты', '1 минуту', '1 час', '1 день']],
  ]) {
    for (const [index, durationMs] of [0, 60000, 3600000, 86400000].entries()) {
      const result = renderStatusMessages(
        [home({ durationMs })],
        translate(locale),
      ).join('')

      assert.ok(result.includes(expected[index]), result)
      assert.doesNotMatch(result, /monitor_/)
    }
  }
})

test('unknown and interrupted status never claim a continuous duration', () => {
  const t = translate('en')

  for (const patch of [
    { status: 'unknown', durationMs: null },
    { status: 'unknown', stale: true, durationMs: null },
    { durationMs: null, uncertain: true },
  ]) {
    const result = renderStatusMessages([home(patch)], t).join('')

    assert.doesNotMatch(result, /Power (on|off) for/)
    assert.match(
      result,
      patch.status === 'unknown'
        ? /Power status unknown/
        : /Continuous duration unknown/,
    )
  }
})

test('full status formats diagnostics and escapes every dynamic field', () => {
  assert.equal(typeof messages.renderFullStatusMessages, 'function')

  for (const locale of ['en', 'ru']) {
    const result = messages
      .renderFullStatusMessages(
        [home({ name: '<b>Home & Co</b>' })],
        translate(locale),
      )
      .join('\n')

    assert.match(result, /<b>&lt;b&gt;Home &amp; Co&lt;\/b&gt;<\/b>/)
    assert.match(result, /<i>/)
    assert.match(result, /auth_failed/)
    assert.match(result, /1970-01-01 00:00 UTC/)
    assert.doesNotMatch(result, /monitor_/)
  }
})

test('both status renderers split long escaped names into complete HTML messages', () => {
  assert.equal(typeof messages.renderFullStatusMessages, 'function')

  for (const render of [
    renderStatusMessages,
    messages.renderFullStatusMessages,
  ]) {
    const result = render(
      [home({ name: '😀<&'.repeat(2000) }), home({ name: 'Second home' })],
      translate('en'),
    )

    assert.ok(result.length > 1)

    for (const message of result) {
      assert.ok(message.length > 0)
      assert.ok(message.length <= 4000)
      assert.doesNotMatch(message, /[\uD800-\uDBFF]$/)
      assert.doesNotMatch(message, /&[^;\s<>]*$/)
      const stack = []

      for (const [, closing, tag] of message.matchAll(/<(\/?)(b|i)>/g)) {
        if (closing) {
          assert.equal(stack.pop(), tag)
        } else {
          stack.push(tag)
        }
      }

      assert.deepEqual(stack, [])
    }

    assert.equal((result.join('').match(/😀&lt;&amp;/g) ?? []).length, 2000)
    assert.match(result.join(''), /Second home/)
  }
})

test('a header exactly at the message budget never produces an empty reply', () => {
  const result = renderStatusMessages(
    [home({ name: 'a'.repeat(3993) })],
    translate('en'),
  )

  assert.equal(result[0].length, 4000)
  assert.ok(
    result.every(message => message.length > 0 && message.length <= 4000),
  )
})

test('plain status rendering splits long names without broken surrogate pairs', () => {
  const statuses = [
    {
      name: '😀'.repeat(5000),
      status: 'unknown',
      stats: { onMs: 0, offMs: 0, uncertainMs: 0, outageCount: 0 },
    },
  ]
  const messages = renderStatusMessages(statuses, key => key)

  assert.ok(messages.length > 1)
  assert.ok(
    messages.every(
      message => message.length <= 4000 && !/[\uD800-\uDBFF]$/.test(message),
    ),
  )
})

test('locale keys and variables agree and status renders both languages', async () => {
  const read = async locale => {
    const source = await readFile(
      new URL(`../../system/locales/bot/${locale}.ftl`, import.meta.url),
      'utf8',
    )

    return source
      .split('\n')
      .filter(line => /^\w+\s*=/.test(line))
      .map(line => [
        line.split('=')[0].trim(),
        [...line.matchAll(/\$([\w]+)/g)].map(match => match[1]).sort(),
      ])
  }

  assert.deepEqual(await read('en'), await read('ru'))
  const i18n = new I18n(config.botSettings.i18nSettings)

  for (const locale of ['en', 'ru']) {
    const result = renderStatusMessages(
      [
        {
          id: '1',
          name: 'Home',
          status: 'unknown',
          stale: true,
          observedAt: new Date(0).toISOString(),
          lastOff: { detectedAt: new Date(0).toISOString(), baseline: true },
          stats: { onMs: 60000, offMs: 0, uncertainMs: 0, outageCount: 1 },
        },
      ],
      key => i18n.t(locale, key),
    ).join('')

    assert.match(result, /UTC/)
    assert.doesNotMatch(result, /monitor_/)
  }
})
