import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { I18n } from '@grammyjs/i18n'

import config from '../../src/config/index.js'
import { monitorMessages as messages } from '../../src/services/index.js'

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

test('power alerts display the localized state, home and timestamp on separate lines', () => {
  const delivery = {
    eventId: '1:25',
    sequence: 25,
    detectedAt: '2026-03-06T04:05:09.321Z',
    baseline: false,
    uncertain: false,
  }

  for (const [locale, state, heading, localTime] of [
    ['en', 'off', '⚡ ❌ Power outage detected', 'local time'],
    ['en', 'on', '⚡ ✅ Power restored', 'local time'],
    ['ru', 'off', '⚡ ❌ Обнаружено отключение электричества', 'местн. вр.'],
    ['ru', 'on', '⚡ ✅ Электричество восстановлено', 'местн. вр.'],
  ]) {
    assert.deepEqual(
      messages.renderPowerAlert(
        { ...delivery, state },
        home({ name: 'Home & Co' }),
        translate(locale),
      ),
      [
        `<b>${heading}</b>\n\n<b>🏠 Home &amp; Co</b>\n🕒 06.03.2026 04:05:09 (${localTime})`,
      ],
    )
  }
})

test('outage alerts retain baseline and uncertainty details when applicable', () => {
  const [text] = messages.renderPowerAlert(
    {
      state: 'off',
      detectedAt: '2026-03-06T04:05:09.321Z',
      baseline: true,
      uncertain: true,
    },
    home(),
    translate('en'),
  )

  assert.match(text, /\(Initial baseline; actual start unknown\)/)
  assert.match(text, /\n\n<i>⚠️ Uncertain continuity<\/i>$/)
})

test('brief status separates each heading and marks the current power state', () => {
  const homes = [
    home({ name: 'North' }),
    home({ name: 'South', status: 'off' }),
    home({ name: 'West', status: 'unknown' }),
  ]

  const t = translate('en')

  const [brief] = renderStatusMessages(homes, t)

  assert.match(brief, /<b>North<\/b>\n\n<b>⚡ Power on ✅/)
  assert.match(brief, /────────\n\n<b>South<\/b>\n\n<b>⚡ Power off ❌/)
  assert.match(
    brief,
    /────────\n\n<b>West<\/b>\n\n<b>⚡ Power status unknown ❓/,
  )

  const [full] = messages.renderFullStatusMessages(homes, t)

  assert.match(full, /<b>North<\/b>\n\n<b>⚡ Power on ✅/)
  assert.match(full, /<b>📊 Cumulative sampled estimates<\/b>/)
})

test('brief status shows only current state, duration and opposite detection', () => {
  const t = translate('en')
  const on = renderStatusMessages([home({ durationMs: 183600000 })], t).join(
    '\n',
  )

  assert.match(on, /⏱ For 2 days 3 hours/)
  assert.match(on, /since detection/)
  assert.doesNotMatch(on, /Before that|Not observed/)
  assert.doesNotMatch(on, /Cumulative|outages|Last observation|auth_failed/)

  const off = renderStatusMessages([home({ status: 'off' })], t).join('\n')

  assert.match(off, /⏱ For 1 minute/)
  assert.match(
    off,
    /✅ Before that, power came on at 01\.01\.1970 00:00 \(local time\)/,
  )
})

test('brief status omits the previous-change line when the opposite state was never observed', () => {
  for (const [locale, before, missing] of [
    ['en', /Before that/, /Not observed/],
    ['ru', /До этого/, /Нет наблюдений/],
  ]) {
    const t = translate(locale)

    const on = renderStatusMessages([home()], t).join('\n')

    const off = renderStatusMessages(
      [home({ status: 'off', lastOn: null })],
      t,
    ).join('\n')

    for (const text of [on, off]) {
      assert.doesNotMatch(text, before)
      assert.doesNotMatch(text, missing)
    }
  }
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

    assert.doesNotMatch(result, /⏱/)
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
    assert.ok(
      result.includes(
        locale === 'en'
          ? 'Time with unknown power status'
          : 'Время с неизвестным состоянием электроснабжения',
      ),
    )
    assert.ok(
      result.includes(
        locale === 'en'
          ? 'Time since the end of the measured period'
          : 'Время с конца учтённого периода',
      ),
    )
    assert.match(result, /01\.01\.1970 00:00 \((local time|местн\. вр\.)\)/)
    assert.doesNotMatch(result, /monitor_/)
  }
})

test('full status leaves the unmeasured time unknown before the first sample', () => {
  const status = home({
    observedAt: null,
    status: 'unknown',
    lastOn: null,
    stateSince: null,
  })

  for (const [locale, expected] of [
    ['en', 'Time since the end of the measured period: Not observed'],
    ['ru', 'Время с конца учтённого периода: Нет наблюдений'],
  ]) {
    const [message] = messages.renderFullStatusMessages(
      [status],
      translate(locale),
    )

    assert.ok(message.includes(expected))
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
  assert.match(result[1], /^<b>⚡ Power on ✅/)
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

    assert.match(result, /01\.01\.1970 00:00 \((local time|местн\. вр\.)\)/)
    assert.doesNotMatch(result, /monitor_/)
  }
})

test('notification timestamps use the fixed home offset across midnight', t => {
  const oldZone = process.env.TZ

  t.after(() => {
    if (oldZone === undefined) {
      delete process.env.TZ
    } else {
      process.env.TZ = oldZone
    }
  })

  process.env.TZ = 'America/New_York'

  const [alert] = messages.renderPowerAlert(
    { state: 'off', detectedAt: '2026-11-20T23:15:00.000Z' },
    home({ timeZone: 'GMT+2' }),
    translate('en'),
  )

  assert.match(alert, /21\.11\.2026 01:15:00 \(local time\)/)

  const [status] = messages.renderRecurringStatusMessages(
    home({
      status: 'unknown',
      timeZone: 'GMT+2',
      observedAt: '2026-11-20T23:15:00.000Z',
    }),
    translate('en'),
  )

  assert.match(status, /21\.11\.2026 01:15:00 \(local time\)/)
})

test('transition alerts show localized episode history and omit unsupported durations', () => {
  const render = (state, detectedAt, history, locale = 'en') =>
    messages.renderPowerAlert(
      { state, detectedAt, history },
      home({ timeZone: 'GMT+2' }),
      translate(locale),
    )[0]

  const previousOffAt = '2026-11-20T08:00:00.000Z'

  const restored = render('on', '2026-11-20T09:30:00.000Z', {
    previousOffAt,
    precedingStateMs: 5400000,
  })

  assert.match(
    restored,
    /🔌 Power went off at 20\.11\.2026 10:00:00 \(local time\)/,
  )
  assert.match(restored, /⏱ Power was out for 1 hour 30 minutes/)

  const outage = render('off', '2026-11-20T12:00:00.000Z', {
    previousOffAt,
    precedingStateMs: 9000000,
  })

  assert.match(outage, /⏱ With power: 2 hours 30 minutes/)
  assert.match(outage, /📅 Detected at: 20\.11\.2026 10:00:00 \(local time\)/)
  assert.match(outage, /Previous outage was: 4 hours ago/)

  const localizedOutage = render(
    'off',
    '2026-11-20T12:00:00.000Z',
    { previousOffAt },
    'ru',
  )

  assert.match(localizedOutage, /Предыдущее отключение было: 4 часа назад/)

  const uncertain = render(
    'off',
    '2026-11-20T07:00:00.000Z',
    { previousOffAt, precedingStateMs: null },
    'ru',
  )

  assert.match(uncertain, /20\.11\.2026 10:00:00 \(местн\. вр\.\)/)
  assert.doesNotMatch(
    uncertain,
    /Время с электричеством|Предыдущее отключение было/,
  )
})

test('restore alerts show off time and downtime, approximate when continuity is unknown', () => {
  const render = (delivery, locale = 'en') =>
    messages.renderPowerAlert(
      { state: 'on', ...delivery },
      home({ timeZone: 'GMT+3' }),
      translate(locale),
    )[0]

  const previousOffAt = '2026-11-20T15:58:43.000Z'

  const detectedAt = '2026-11-21T12:37:50.000Z'

  const approximate = render(
    {
      detectedAt,
      uncertain: true,
      history: { previousOffAt, precedingStateMs: null },
    },
    'ru',
  )

  assert.match(
    approximate,
    /🔌 Было отключено в 20\.11\.2026 18:58:43 \(местн\. вр\.\)\n⏱ Электричество отсутствовало ≈ 20 часов 39 минут/,
  )
  assert.match(approximate, /⚠️ Непрерывность неизвестна/)
  assert.doesNotMatch(approximate, /Отключение обнаружено/)

  const observed = render({
    detectedAt,
    uncertain: false,
    history: { previousOffAt, precedingStateMs: 5400000 },
  })

  assert.match(observed, /🔌 Power went off at 20\.11\.2026 18:58:43/)
  assert.match(observed, /⏱ Power was out for 1 hour 30 minutes/)
  assert.doesNotMatch(observed, /≈|⚠️/)

  const reversed = render({
    detectedAt: '2026-11-20T10:00:00.000Z',
    history: { previousOffAt, precedingStateMs: null },
  })

  assert.match(reversed, /Power went off at/)
  assert.doesNotMatch(reversed, /Power was out for/)

  const baseline = render({ detectedAt })

  assert.doesNotMatch(baseline, /Power went off at|Power was out for/)
})

test('manual status timestamps follow each home offset, including device observations', () => {
  const observedAt = '2026-11-20T23:15:00.000Z'

  const first = home({
    name: 'East',
    timeZone: 'GMT+2',
    observedAt,
    lastOn: { detectedAt: observedAt, baseline: true },
    lastOff: { detectedAt: observedAt, baseline: false },
    stateSince: observedAt,
    devices: [{ ...home().devices[0], observedAt }],
  })

  const second = home({
    name: 'West',
    timeZone: 'GMT-3:30',
    status: 'unknown',
    lastInferredStatus: 'off',
    lastInferredAt: observedAt,
  })

  const [brief] = renderStatusMessages([first, second], translate('en'))

  assert.match(
    brief,
    /Before that, power went off at 21\.11\.2026 01:15 \(local time\)/,
  )
  assert.match(brief, /Last check: 20\.11\.2026 19:45 \(local time\)/)
  assert.doesNotMatch(brief, /GMT|UTC/)

  const [full] = messages.renderFullStatusMessages([first], translate('en'))

  assert.equal(full.match(/21\.11\.2026 01:15 \(local time\)/g)?.length, 6)
  assert.doesNotMatch(full, /GMT|UTC/)
})

test('brief status distinguishes outage detection from the last confirmation', () => {
  const lastOff = { detectedAt: '2026-11-20T15:58:43.000Z', baseline: false }

  const outage = home({
    status: 'off',
    timeZone: 'GMT+2',
    durationMs: null,
    lastOff,
    lastInferredStatus: 'off',
    lastInferredAt: '2026-11-20T16:50:00.000Z',
  })

  const [unknown] = renderStatusMessages(
    [{ ...outage, status: 'unknown' }],
    translate('en'),
  )

  assert.match(unknown, /⚡ Last known state:\n<b>Power off ❌<\/b>/)
  assert.match(unknown, /🔄 Last check: 20\.11\.2026 18:50 \(local time\)/)
  assert.match(unknown, /The current state could not be confirmed/)
  assert.doesNotMatch(unknown, /Power status unknown/)
  assert.match(
    unknown,
    /🕒 Power outage detected at 20\.11\.2026 17:58 \(local time\)/,
  )

  const [off] = renderStatusMessages([outage], translate('en'))

  assert.match(
    off,
    /🕒 Power outage detected at 20\.11\.2026 17:58 \(local time\)/,
  )
  assert.doesNotMatch(off, /Power off for/)
})

test('Russian brief status distinguishes a confirmed outage from the last known outage', () => {
  const outage = home({
    timeZone: 'GMT+3',
    status: 'off',
    lastOff: { detectedAt: '2026-11-20T15:58:00.000Z', baseline: false },
    lastInferredStatus: 'off',
    lastInferredAt: '2026-11-20T17:12:00.000Z',
  })

  const [current] = renderStatusMessages([outage], translate('ru'))
  const [inconclusive] = renderStatusMessages(
    [{ ...outage, status: 'unknown' }],
    translate('ru'),
  )

  assert.match(current, /⚡ Электричества нет ❌/)
  assert.match(
    current,
    /🕒 Отключение света обнаружено в 20\.11\.2026 18:58 \(местн\. вр\.\)/,
  )
  assert.match(
    inconclusive,
    /⚡ По последним данным:\n<b>Электричества нет ❌<\/b>/,
  )
  assert.match(
    inconclusive,
    /🕒 Отключение света обнаружено в 20\.11\.2026 18:58 \(местн\. вр\.\)/,
  )
  assert.match(
    inconclusive,
    /🔄 Последняя проверка: 20\.11\.2026 20:12 \(местн\. вр\.\)/,
  )
  assert.match(inconclusive, /Подтвердить текущее состояние не удалось/)
  assert.doesNotMatch(inconclusive, /Состояние электричества неизвестно|уже /)
})

test('brief status uses state-specific detection and previous-change wording', () => {
  const off = home({
    status: 'off',
    timeZone: 'GMT+3',
    lastOff: { detectedAt: '2026-11-20T15:58:00.000Z', baseline: false },
    lastOn: { detectedAt: '2026-11-20T04:01:00.000Z', baseline: false },
  })

  const ru = renderStatusMessages([off], translate('ru')).join('\n')

  assert.ok(
    ru.includes(
      '🕒 Отключение света обнаружено в 20.11.2026 18:58 (местн. вр.)\n\n✅ До этого свет включали 20.11.2026 07:01',
    ),
    ru,
  )

  const en = renderStatusMessages([off], translate('en')).join('\n')

  assert.match(en, /Power outage detected at/)
  assert.match(en, /Before that, power came on at/)

  const on = renderStatusMessages(
    [{ ...off, status: 'on' }],
    translate('en'),
  ).join('\n')

  assert.match(on, /Power return detected at/)
  assert.match(on, /Before that, power went off at/)

  const full = messages
    .renderFullStatusMessages([off], translate('en'))
    .join('\n')

  assert.match(full, /Last power on:/)
  assert.match(full, /Detected:/)
})

test('inconclusive brief status shows the current EZVIZ device reading', () => {
  const pending = home({
    status: 'unknown',
    lastInferredStatus: 'on',
    lastInferredAt: new Date(0).toISOString(),
    devices: [
      {
        id: '1',
        name: 'Camera',
        status: 'offline',
        observedAt: new Date(0).toISOString(),
        offlineStreak: 1,
        offlineChecks: 3,
      },
    ],
  })

  const [english] = renderStatusMessages([pending], translate('en'))
  const [russian] = renderStatusMessages([pending], translate('ru'))

  assert.match(
    english,
    /📷 Device Camera \(EZVIZ\) now: Offline 🔌 \(1 of 3 checks ⌛\)/,
  )
  assert.doesNotMatch(english, /could not be confirmed/)
  assert.match(
    russian,
    /📷 Устройство Camera \(EZVIZ\) сейчас: Не в сети 🔌 \(1 из 3 проверок ⌛\)/,
  )
  assert.doesNotMatch(russian, /Подтвердить текущее состояние не удалось/)

  const [failed] = renderStatusMessages(
    [{ ...pending, devices: home().devices }],
    translate('en'),
  )

  assert.match(failed, /The current state could not be confirmed/)
  assert.doesNotMatch(failed, /\(EZVIZ\) now/)
})
