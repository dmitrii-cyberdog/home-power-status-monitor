const splitMessages = text => {
  const messages = []

  while (text.length > 4000) {
    const end = /[\uD800-\uDBFF]/.test(text[3999]) ? 3999 : 4000

    messages.push(text.slice(0, end))
    text = text.slice(end)
  }

  if (text) {
    messages.push(text)
  }

  return messages
}

const timestamp = (value, t) => (value ? `${value} UTC` : t('monitor_none'))

const escapeHtml = text =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const statusTimestamp = (value, t) =>
  value
    ? `${new Date(value).toISOString().slice(0, 16).replace('T', ' ')} UTC`
    : t('monitor_not_observed')

const statusEpisode = (value, t) =>
  value
    ? `${statusTimestamp(value.detectedAt, t)}${value.baseline ? ` (${t('monitor_baseline')})` : ''}`
    : t('monitor_not_observed')

const duration = (milliseconds, t) => {
  const minutes = Math.floor(milliseconds / 60000)

  if (minutes < 1) {
    return t('monitor_less_minute')
  }

  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  const parts = days
    ? [
        ['days', days],
        ['hours', hours % 24],
      ]
    : hours
      ? [
          ['hours', hours],
          ['minutes', minutes % 60],
        ]
      : [['minutes', minutes]]

  return parts
    .filter(([, count]) => count > 0)
    .map(([unit, count]) => t(`monitor_${unit}`, { count }))
    .join(' ')
}

const renderLines = lines => {
  const messages = []

  let message = ''

  for (const [text, tag] of lines) {
    const open = tag ? `<${tag}>` : ''
    const close = tag ? `</${tag}>` : ''

    const chunks = []

    let chunk = ''

    for (const character of text) {
      const escaped = escapeHtml(character)

      if (open.length + chunk.length + escaped.length + close.length > 4000) {
        chunks.push(`${open}${chunk}${close}`)
        chunk = ''
      }

      chunk += escaped
    }

    chunks.push(`${open}${chunk}${close}`)

    for (const part of chunks) {
      if (message && message.length + 1 + part.length > 4000) {
        messages.push(message)
        message = ''
      }

      message += `${message ? '\n' : ''}${part}`
    }
  }

  if (message) {
    messages.push(message)
  }

  return messages
}

const summaryLines = (home, t) => {
  const lines = [[home.name, 'b']]

  if (home.status === 'unknown') {
    lines.push([t('monitor_status_unknown'), 'b'])

    if (home.lastInferredStatus && home.lastInferredStatus !== 'unknown') {
      lines.push([
        `${t('monitor_last_confirmed')}: ${t(`monitor_${home.lastInferredStatus}`)} (${statusTimestamp(home.lastInferredAt, t)})`,
      ])
    } else {
      lines.push([
        `${t('monitor_observed')}: ${statusTimestamp(home.observedAt, t)}`,
      ])
    }
  } else {
    lines.push([
      home.durationMs == null
        ? t(`monitor_${home.status}`)
        : t('monitor_power_for', {
            state: t(`monitor_${home.status}`),
            duration: duration(home.durationMs, t),
          }),
      'b',
    ])

    if (home.durationMs == null) {
      lines.push([t('monitor_continuity_unknown'), 'i'])
    }

    const opposite = home.status === 'on' ? 'off' : 'on'

    lines.push([
      `${t(`monitor_last_${opposite}`)}: ${statusTimestamp(home[opposite === 'on' ? 'lastOn' : 'lastOff']?.detectedAt, t)}`,
    ])
  }

  return lines
}

const homeLines = (statuses, t, render) =>
  renderLines(
    statuses.length
      ? statuses.flatMap((home, index) => [
          ...(index ? [[''], ['────────'], ['']] : []),
          ...render(home, t),
        ])
      : [[t('monitor_empty')]],
  )

export const renderStatusMessages = (statuses, t) =>
  homeLines(statuses, t, (home, translate) => {
    const [heading, [state, tag], ...details] = summaryLines(home, translate)

    const icon = { on: '⚡ ✅', off: '⚡ ❌', unknown: '⚡' }[home.status]

    return [heading, [''], [`${icon} ${state}`, tag], ...details]
  })

export const renderFullStatusMessages = (statuses, t) =>
  homeLines(statuses, t, (home, translate) => [
    ...summaryLines(home, translate),
    [''],
    ...(home.stale ? [[translate('monitor_stale'), 'i']] : []),
    ...(home.uncertain ? [[translate('monitor_uncertain'), 'i']] : []),
    [
      `${translate('monitor_observed')}: ${statusTimestamp(home.observedAt, translate)}`,
    ],
    [
      `${translate('monitor_last_on')}: ${statusEpisode(home.lastOn, translate)}`,
    ],
    [
      `${translate('monitor_last_off')}: ${statusEpisode(home.lastOff, translate)}`,
    ],
    [
      `${translate('monitor_since')}: ${statusTimestamp(home.stateSince, translate)}`,
    ],
    [''],
    [translate('monitor_totals'), 'b'],
    [`${translate('monitor_on')}: ${duration(home.stats.onMs, translate)}`],
    [`${translate('monitor_off')}: ${duration(home.stats.offMs, translate)}`],
    [
      `${translate('monitor_uncertain')}: ${duration(home.stats.uncertainMs, translate)}`,
    ],
    [`${translate('monitor_outages')}: ${home.stats.outageCount}`],
    [
      `${translate('monitor_tail')}: ${duration(home.unobservedTailMs, translate)}`,
    ],
    ...((home.devices?.length ?? 0)
      ? [
          [''],
          [translate('monitor_devices'), 'b'],
          ...home.devices.flatMap(device => [
            [`${device.name}: ${translate(`monitor_device_${device.status}`)}`],
            [
              `${translate('monitor_observed')}: ${statusTimestamp(device.observedAt, translate)}`,
            ],
            [`${translate('monitor_offline_streak')}: ${device.offlineStreak}`],
            ...(device.errorCode
              ? [
                  [
                    `${translate('monitor_diagnostic')}: ${device.errorCode}`,
                    'i',
                  ],
                ]
              : []),
          ]),
        ]
      : []),
  ])

export const renderPowerAlert = (delivery, home, t) =>
  splitMessages(
    [
      `${home.name}: ${t(delivery.state === 'off' ? 'monitor_outage' : 'monitor_restored')}`,
      `${timestamp(delivery.detectedAt, t)}${delivery.baseline ? ` (${t('monitor_baseline')})` : ''}`,
      ...(delivery.uncertain ? [t('monitor_uncertain')] : []),
      `${t('monitor_event')}: ${delivery.eventId}`,
    ].join('\n'),
  )
