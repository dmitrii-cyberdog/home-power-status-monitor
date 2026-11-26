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

const literal = text => new RegExp(RegExp.escape(text))

test('recovery alerts show localized averages and earlier outages in home time', () => {
  const recentOutages = [
    {
      restorationSequence: 4,
      startedAt: '2026-11-24T00:10:00.000Z',
      restoredAt: '2026-11-24T04:10:00.000Z',
    },
    {
      restorationSequence: 2,
      startedAt: '2026-11-22T23:50:00.000Z',
      restoredAt: '2026-11-23T01:50:00.000Z',
    },
  ]

  const delivery = {
    state: 'on',
    sequence: 4,
    detectedAt: recentOutages[0].restoredAt,
    history: { recentOutages },
  }
  const target = home({ timeZone: 'GMT+5:30' })
  const render = (locale, event = delivery, destination = target) =>
    messages.renderPowerAlert(event, destination, translate(locale))

  const en = translate('en')
  const ru = translate('ru')

  const english = render('en').join('\n')
  assert.match(
    english,
    literal(en('monitor_recovery_outage_sample', { count: 2 })),
  )
  assert.match(
    english,
    literal(
      en('monitor_recovery_average_downtime', {
        duration: en('monitor_hours', { count: 3 }),
      }),
    ),
  )
  assert.match(
    english,
    literal(en('monitor_recovery_average_start', { time: '05:30' })),
  )
  assert.match(
    english,
    literal(en('monitor_recovery_average_restore', { time: '08:30' })),
  )
  assert.match(
    english,
    literal(
      `❌ 23.11 05:20:00 - ✅ 23.11 07:20:00 (${en('monitor_hours', { count: 2 })})`,
    ),
  )
  assert.doesNotMatch(english, /❌ 24\.11 05:40:00/)

  const russian = render('ru').join('\n')
  assert.match(
    russian,
    literal(
      ru('monitor_recovery_average_downtime', {
        duration: ru('monitor_hours', { count: 3 }),
      }),
    ),
  )
  assert.match(
    russian,
    literal(
      `❌ 23.11 05:20:00 - ✅ 23.11 07:20:00 (${ru('monitor_hours', { count: 2 })})`,
    ),
  )

  const oneOutage = render('en', {
    ...delivery,
    history: { recentOutages: recentOutages.slice(0, 1) },
  }).join('\n')
  assert.match(
    oneOutage,
    literal(en('monitor_recovery_outage_sample', { count: 1 })),
  )
  assert.doesNotMatch(
    oneOutage,
    literal(en('monitor_recovery_previous_outages')),
  )

  for (const event of [
    { ...delivery, state: 'off' },
    { ...delivery, history: {} },
    { ...delivery, history: { recentOutages: [] } },
  ]) {
    const title = en('monitor_recovery_outage_sample', {
      count: event.history.recentOutages?.length ?? 0,
    })

    assert.doesNotMatch(render('en', event).join('\n'), literal(title))
  }

  const chunks = render('en', delivery, { ...target, name: '<&'.repeat(1500) })
  assert.ok(chunks.length > 1)
  assert.match(chunks.join('\n'), /&lt;&amp;/)
  assert.match(
    chunks.join('\n'),
    literal(en('monitor_recovery_previous_outages')),
  )
})

test('power alerts display the localized state, home and timestamp on separate lines', () => {
  const delivery = {
    eventId: '1:25',
    sequence: 25,
    detectedAt: '2026-03-06T04:05:09.321Z',
    baseline: false,
    uncertain: false,
  }

  for (const [locale, state, icon, key] of [
    ['en', 'off', '❌', 'monitor_outage'],
    ['en', 'on', '✅', 'monitor_restored'],
    ['ru', 'off', '❌', 'monitor_outage'],
    ['ru', 'on', '✅', 'monitor_restored'],
  ]) {
    const t = translate(locale)

    assert.deepEqual(
      messages.renderPowerAlert(
        { ...delivery, state },
        home({ name: 'Home & Co' }),
        t,
      ),
      [
        `<b>⚡ ${icon} ${t(key)}</b>\n\n<b>🏠 Home &amp; Co</b>\n🕒 06.03.2026 04:05:09 (${t('monitor_local_time')})`,
      ],
    )
  }
})

test('outage alerts retain baseline and uncertainty details when applicable', () => {
  const t = translate('en')

  const [text] = messages.renderPowerAlert(
    {
      state: 'off',
      detectedAt: '2026-03-06T04:05:09.321Z',
      baseline: true,
      uncertain: true,
    },
    home(),
    t,
  )

  assert.match(text, literal(`(${t('monitor_baseline')})`))
  assert.ok(text.endsWith(`\n\n<i>⚠️ ${t('monitor_uncertain')}</i>`), text)
})

test('brief status separates each heading and marks the current power state', () => {
  const homes = [
    home({ name: 'North' }),
    home({ name: 'South', status: 'off' }),
    home({ name: 'West', status: 'unknown' }),
  ]

  const t = translate('en')

  const [brief] = renderStatusMessages(homes, t)

  assert.match(brief, literal(`<b>North</b>\n\n<b>⚡ ${t('monitor_on')} ✅`))
  assert.match(
    brief,
    literal(`────────\n\n<b>South</b>\n\n<b>⚡ ${t('monitor_off')} ❌`),
  )
  assert.match(
    brief,
    literal(
      `────────\n\n<b>West</b>\n\n<b>⚡ ${t('monitor_status_unknown')} ❓`,
    ),
  )

  const [full] = messages.renderFullStatusMessages(homes, t)

  assert.match(full, literal(`<b>North</b>\n\n<b>⚡ ${t('monitor_on')} ✅`))
  assert.match(full, literal(`<b>📊 ${t('monitor_totals')}</b>`))
})

test('brief status shows only current state, duration and opposite detection', () => {
  const t = translate('en')
  const on = renderStatusMessages([home({ durationMs: 183600000 })], t).join(
    '\n',
  )

  const elapsed = `${t('monitor_days', { count: 2 })} ${t('monitor_hours', { count: 3 })}`

  assert.match(
    on,
    literal(`⏱ ${t('monitor_power_for', { duration: elapsed })}`),
  )
  assert.doesNotMatch(on, /auth_failed/)

  for (const key of [
    'monitor_before_off',
    'monitor_not_observed',
    'monitor_totals',
    'monitor_outages',
    'monitor_observed',
  ]) {
    assert.doesNotMatch(on, literal(t(key)))
  }

  const off = renderStatusMessages([home({ status: 'off' })], t).join('\n')

  assert.match(
    off,
    literal(
      `⏱ ${t('monitor_power_for', { duration: t('monitor_minutes', { count: 1 }) })}`,
    ),
  )
  assert.match(
    off,
    literal(
      `✅ ${t('monitor_before_on')} 01.01.1970 00:00 (${t('monitor_local_time')})`,
    ),
  )
})

test('brief status omits the previous-change line when the opposite state was never observed', () => {
  for (const locale of ['en', 'ru']) {
    const t = translate(locale)

    const on = renderStatusMessages([home()], t).join('\n')

    const off = renderStatusMessages(
      [home({ status: 'off', lastOn: null })],
      t,
    ).join('\n')

    for (const text of [on, off]) {
      assert.doesNotMatch(text, literal(t('monitor_before_on')))
      assert.doesNotMatch(text, literal(t('monitor_before_off')))
      assert.doesNotMatch(text, literal(t('monitor_not_observed')))
    }
  }
})

test('brief duration boundaries use readable localized units', () => {
  for (const locale of ['en', 'ru']) {
    const t = translate(locale)

    for (const [durationMs, expected] of [
      [0, t('monitor_less_minute')],
      [60000, t('monitor_minutes', { count: 1 })],
      [3600000, t('monitor_hours', { count: 1 })],
      [86400000, t('monitor_days', { count: 1 })],
    ]) {
      const result = renderStatusMessages([home({ durationMs })], t).join('')

      assert.match(
        result,
        literal(t('monitor_power_for', { duration: expected })),
      )
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
        ? literal(t('monitor_status_unknown'))
        : literal(t('monitor_continuity_unknown')),
    )
  }
})

test('full status formats diagnostics and escapes every dynamic field', () => {
  assert.equal(typeof messages.renderFullStatusMessages, 'function')

  for (const locale of ['en', 'ru']) {
    const t = translate(locale)

    const result = messages
      .renderFullStatusMessages([home({ name: '<b>Home & Co</b>' })], t)
      .join('\n')

    assert.match(result, /<b>&lt;b&gt;Home &amp; Co&lt;\/b&gt;<\/b>/)
    assert.match(result, /<i>/)
    assert.match(result, /auth_failed/)
    assert.match(result, literal(t('monitor_unknown_time')))
    assert.match(result, literal(t('monitor_tail')))
    assert.match(
      result,
      literal(`01.01.1970 00:00 (${t('monitor_local_time')})`),
    )
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

  for (const locale of ['en', 'ru']) {
    const t = translate(locale)

    const [message] = messages.renderFullStatusMessages([status], t)

    assert.match(
      message,
      literal(`${t('monitor_tail')}: ${t('monitor_not_observed')}`),
    )
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
  const t = translate('en')

  const result = renderStatusMessages([home({ name: 'a'.repeat(3993) })], t)

  assert.equal(result[0].length, 4000)
  assert.ok(result[1].startsWith(`<b>⚡ ${t('monitor_on')} ✅`), result[1])
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

    assert.match(
      result,
      literal(`01.01.1970 00:00 (${i18n.t(locale, 'monitor_local_time')})`),
    )
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

  const translateEnglish = translate('en')

  const [alert] = messages.renderPowerAlert(
    { state: 'off', detectedAt: '2026-11-20T23:15:00.000Z' },
    home({ timeZone: 'GMT+2' }),
    translateEnglish,
  )

  const expected = literal(
    `21.11.2026 01:15:00 (${translateEnglish('monitor_local_time')})`,
  )

  assert.match(alert, expected)

  const [status] = messages.renderRecurringStatusMessages(
    home({
      status: 'unknown',
      timeZone: 'GMT+2',
      observedAt: '2026-11-20T23:15:00.000Z',
    }),
    translateEnglish,
  )

  assert.match(status, expected)
})

test('transition alerts show localized episode history and omit unsupported durations', () => {
  const render = (state, detectedAt, history, locale = 'en') =>
    messages.renderPowerAlert(
      { state, detectedAt, history },
      home({ timeZone: 'GMT+2' }),
      translate(locale),
    )[0]

  const en = translate('en')
  const ru = translate('ru')

  const previousOffAt = '2026-11-20T08:00:00.000Z'
  const localTime = '20.11.2026 10:00:00'
  const thirtyMinutes = en('monitor_minutes', { count: 30 })

  const restored = render('on', '2026-11-20T09:30:00.000Z', {
    previousOffAt,
    precedingStateMs: 5400000,
  })

  assert.match(
    restored,
    literal(
      `🔌 ${en('monitor_restored_off_at')} ${localTime} (${en('monitor_local_time')})`,
    ),
  )
  assert.match(
    restored,
    literal(
      `⏱ ${en('monitor_restored_downtime')} ${en('monitor_hours', { count: 1 })} ${thirtyMinutes}`,
    ),
  )

  const outage = render('off', '2026-11-20T12:00:00.000Z', {
    previousOffAt,
    precedingStateMs: 9000000,
  })

  assert.match(
    outage,
    literal(
      `⏱ ${en('monitor_observed_uptime')}: ${en('monitor_hours', { count: 2 })} ${thirtyMinutes}`,
    ),
  )
  assert.match(
    outage,
    literal(
      `📅 ${en('monitor_previous_outage')}: ${localTime} (${en('monitor_local_time')})`,
    ),
  )
  assert.match(
    outage,
    literal(
      en('monitor_between_outages', {
        duration: en('monitor_hours', { count: 4 }),
      }),
    ),
  )

  const localizedOutage = render(
    'off',
    '2026-11-20T12:00:00.000Z',
    { previousOffAt },
    'ru',
  )

  assert.match(
    localizedOutage,
    literal(
      ru('monitor_between_outages', {
        duration: ru('monitor_hours', { count: 4 }),
      }),
    ),
  )
  assert.match(
    localizedOutage,
    literal(
      `📅 ${ru('monitor_previous_outage')}: ${localTime} (${ru('monitor_local_time')})`,
    ),
  )

  const uncertain = render(
    'off',
    '2026-11-20T07:00:00.000Z',
    { previousOffAt, precedingStateMs: null },
    'ru',
  )

  assert.match(uncertain, literal(`${localTime} (${ru('monitor_local_time')})`))
  assert.doesNotMatch(uncertain, /⏱|↔️/)
})

test('restore alerts show off time and downtime, approximate when continuity is unknown', () => {
  const render = (delivery, locale = 'en') =>
    messages.renderPowerAlert(
      { state: 'on', ...delivery },
      home({ timeZone: 'GMT+3' }),
      translate(locale),
    )[0]

  const en = translate('en')
  const ru = translate('ru')

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
    literal(
      `⏱ ${ru('monitor_restored_downtime')} ≈ ${ru('monitor_hours', { count: 20 })} ${ru('monitor_minutes', { count: 39 })}\n🔌 ${ru('monitor_restored_off_at')} 20.11.2026 18:58:43 (${ru('monitor_local_time')})`,
    ),
  )
  assert.match(approximate, literal(`⚠️ ${ru('monitor_uncertain')}`))
  assert.doesNotMatch(approximate, /📅/)

  const observed = render({
    detectedAt,
    uncertain: false,
    history: { previousOffAt, precedingStateMs: 5400000 },
  })

  assert.match(
    observed,
    literal(`🔌 ${en('monitor_restored_off_at')} 20.11.2026 18:58:43`),
  )
  assert.match(
    observed,
    literal(
      `⏱ ${en('monitor_restored_downtime')} ${en('monitor_hours', { count: 1 })} ${en('monitor_minutes', { count: 30 })}`,
    ),
  )
  assert.doesNotMatch(observed, /≈|⚠️/)

  const reversed = render({
    detectedAt: '2026-11-20T10:00:00.000Z',
    history: { previousOffAt, precedingStateMs: null },
  })

  assert.match(reversed, literal(en('monitor_restored_off_at')))
  assert.doesNotMatch(reversed, /⏱/)

  const baseline = render({ detectedAt })

  assert.doesNotMatch(baseline, /🔌|⏱/)
})

test('manual status timestamps follow each home offset, including device observations', () => {
  const observedAt = '2026-11-20T23:15:00.000Z'

  const t = translate('en')
  const localTime = t('monitor_local_time')

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

  const [brief] = renderStatusMessages([first, second], t)

  assert.match(
    brief,
    literal(`${t('monitor_before_off')} 21.11.2026 01:15 (${localTime})`),
  )
  assert.match(
    brief,
    literal(`${t('monitor_last_confirmed')}: 20.11.2026 19:45 (${localTime})`),
  )
  assert.doesNotMatch(brief, /GMT|UTC/)

  const [full] = messages.renderFullStatusMessages([first], t)

  assert.equal(full.split(`21.11.2026 01:15 (${localTime})`).length - 1, 6)
  assert.doesNotMatch(full, /GMT|UTC/)
})

test('brief status distinguishes outage detection from the last confirmation', () => {
  const t = translate('en')
  const localTime = t('monitor_local_time')
  const detection = literal(
    `🕒 ${t('monitor_detected_off')} 20.11.2026 17:58 (${localTime})`,
  )

  const lastOff = { detectedAt: '2026-11-20T15:58:43.000Z', baseline: false }

  const outage = home({
    status: 'off',
    timeZone: 'GMT+2',
    durationMs: null,
    lastOff,
    lastInferredStatus: 'off',
    lastInferredAt: '2026-11-20T16:50:00.000Z',
  })

  const [unknown] = renderStatusMessages([{ ...outage, status: 'unknown' }], t)

  assert.match(
    unknown,
    literal(`⚡ ${t('monitor_last_known')}:\n<b>${t('monitor_off')} ❌</b>`),
  )
  assert.match(
    unknown,
    literal(
      `🔄 ${t('monitor_last_confirmed')}: 20.11.2026 18:50 (${localTime})`,
    ),
  )
  assert.match(unknown, literal(t('monitor_check_inconclusive')))
  assert.doesNotMatch(unknown, literal(t('monitor_status_unknown')))
  assert.match(unknown, detection)

  const [off] = renderStatusMessages([outage], t)

  assert.match(off, detection)
  assert.doesNotMatch(off, /⏱/)
})

test('Russian brief status distinguishes a confirmed outage from the last known outage', () => {
  const t = translate('ru')
  const localTime = t('monitor_local_time')
  const detection = literal(
    `🕒 ${t('monitor_detected_off')} 20.11.2026 18:58 (${localTime})`,
  )

  const outage = home({
    timeZone: 'GMT+3',
    status: 'off',
    lastOff: { detectedAt: '2026-11-20T15:58:00.000Z', baseline: false },
    lastInferredStatus: 'off',
    lastInferredAt: '2026-11-20T17:12:00.000Z',
  })

  const [current] = renderStatusMessages([outage], t)
  const [inconclusive] = renderStatusMessages(
    [{ ...outage, status: 'unknown' }],
    t,
  )

  assert.match(current, literal(`⚡ ${t('monitor_off')} ❌`))
  assert.match(current, detection)
  assert.match(
    inconclusive,
    literal(`⚡ ${t('monitor_last_known')}:\n<b>${t('monitor_off')} ❌</b>`),
  )
  assert.match(inconclusive, detection)
  assert.match(
    inconclusive,
    literal(
      `🔄 ${t('monitor_last_confirmed')}: 20.11.2026 20:12 (${localTime})`,
    ),
  )
  assert.match(inconclusive, literal(t('monitor_check_inconclusive')))
  assert.doesNotMatch(inconclusive, literal(t('monitor_status_unknown')))
  assert.doesNotMatch(inconclusive, /⏱/)
})

test('brief status uses state-specific detection and previous-change wording', () => {
  const off = home({
    status: 'off',
    timeZone: 'GMT+3',
    lastOff: { detectedAt: '2026-11-20T15:58:00.000Z', baseline: false },
    lastOn: { detectedAt: '2026-11-20T04:01:00.000Z', baseline: false },
  })

  const ru = translate('ru')
  const en = translate('en')

  const russian = renderStatusMessages([off], ru).join('\n')

  assert.match(
    russian,
    literal(
      `🕒 ${ru('monitor_detected_off')} 20.11.2026 18:58 (${ru('monitor_local_time')})\n\n✅ ${ru('monitor_before_on')} 20.11.2026 07:01`,
    ),
  )

  const english = renderStatusMessages([off], en).join('\n')

  assert.match(english, literal(en('monitor_detected_off')))
  assert.match(english, literal(en('monitor_before_on')))

  const on = renderStatusMessages([{ ...off, status: 'on' }], en).join('\n')

  assert.match(on, literal(en('monitor_detected_on')))
  assert.match(on, literal(en('monitor_before_off')))

  const full = messages.renderFullStatusMessages([off], en).join('\n')

  assert.match(full, literal(`${en('monitor_last_on')}:`))
  assert.match(full, literal(`${en('monitor_since')}:`))
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

  for (const locale of ['en', 'ru']) {
    const t = translate(locale)
    const device = t('monitor_ezviz_now', { device: 'Camera' })
    const checks = t('monitor_offline_checks', { count: 1, total: 3 })
    const warning = literal(t('monitor_check_inconclusive'))

    const [status] = renderStatusMessages([pending], t)

    assert.match(
      status,
      literal(`📷 ${device}: ${t('monitor_device_offline')} 🔌 (${checks} ⌛)`),
    )
    assert.doesNotMatch(status, warning)

    const [failed] = renderStatusMessages(
      [{ ...pending, devices: home().devices }],
      t,
    )

    assert.match(failed, warning)
    assert.doesNotMatch(failed, literal(device))
  }
})
