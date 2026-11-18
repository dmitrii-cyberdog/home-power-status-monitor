import { messageChunks } from '../../utils'

const messageLimit = 4000

const timestamp = (value, t) => (value ? `${value} UTC` : t('monitor_none'))

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

    lines.push([''])

    lines.push([
      `${t(`monitor_last_${opposite}`)}: ${statusTimestamp(home[opposite === 'on' ? 'lastOn' : 'lastOff']?.detectedAt, t)}`,
    ])
  }

  return lines
}

const homeLines = (statuses, t, render) => {
  if (statuses.length === 0) {
    return messageChunks.chunkHtmlLines([[t('monitor_empty')]], messageLimit)
  }

  const lines = []

  for (const home of statuses) {
    if (lines.length) {
      lines.push([''], ['────────'], [''])
    }

    lines.push(...render(home, t))
  }

  return messageChunks.chunkHtmlLines(lines, messageLimit)
}

export const renderStatusMessages = (statuses, t) =>
  homeLines(statuses, t, (home, translate) => {
    const [heading, [state, tag], ...details] = summaryLines(home, translate)

    const icon = { on: '⚡ ✅', off: '⚡ ❌', unknown: '⚡' }[home.status]

    return [heading, [''], [`${icon} ${state}`, tag], ...details]
  })

const deviceLines = (device, t) => {
  const lines = [
    [`${device.name}: ${t(`monitor_device_${device.status}`)}`],
    [`${t('monitor_observed')}: ${statusTimestamp(device.observedAt, t)}`],
    [`${t('monitor_offline_streak')}: ${device.offlineStreak}`],
  ]

  if (device.errorCode) {
    lines.push([`${t('monitor_diagnostic')}: ${device.errorCode}`, 'i'])
  }

  return lines
}

export const renderFullStatusMessages = (statuses, t) =>
  homeLines(statuses, t, (home, translate) => {
    const lines = [...summaryLines(home, translate), ['']]

    if (home.stale) {
      lines.push([translate('monitor_stale'), 'i'])
    }

    if (home.uncertain) {
      lines.push([translate('monitor_uncertain'), 'i'])
    }

    lines.push(
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
    )

    if (home.devices?.length) {
      lines.push([''], [translate('monitor_devices'), 'b'])

      for (const device of home.devices) {
        lines.push(...deviceLines(device, translate))
      }
    }

    return lines
  })

export const renderPowerAlert = (delivery, home, t) => {
  const lines = [
    `${home.name}: ${t(delivery.state === 'off' ? 'monitor_outage' : 'monitor_restored')}`,
    `${timestamp(delivery.detectedAt, t)}${delivery.baseline ? ` (${t('monitor_baseline')})` : ''}`,
  ]

  if (delivery.uncertain) {
    lines.push(t('monitor_uncertain'))
  }

  lines.push(`${t('monitor_event')}: ${delivery.eventId}`)

  return messageChunks.splitPlainText(lines.join('\n'), messageLimit)
}
