import { getDayJs, messageChunks } from '../../utils'

const messageLimit = 4000

const homeTimestamp = (value, t, timeZone = 'UTC', format) => {
  if (!value) {
    return t('monitor_not_observed')
  }

  const [hours, minutes = '0'] = timeZone.slice(4).split(':')

  const sign = timeZone.startsWith('GMT-') ? -1 : 1

  const offset = sign * (Number(hours) * 60 + Number(minutes))

  return `${getDayJs()(value).add(offset, 'minute').format(format)} ${timeZone}`
}

const statusFormat = 'YYYY-MM-DD HH:mm'

const notificationFormat = 'DD.MM.YYYY HH:mm:ss'

const statusEpisode = (value, t, timestamp) =>
  value
    ? `${timestamp(value.detectedAt)}${value.baseline ? ` (${t('monitor_baseline')})` : ''}`
    : t('monitor_not_observed')

const duration = (milliseconds, t, includeMinutes = false) => {
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
        ['minutes', includeMinutes ? minutes % 60 : 0],
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

const summaryLines = (home, t, timestamp) => {
  const lines = [[home.name, 'b']]

  if (home.status === 'unknown') {
    if (home.lastInferredStatus && home.lastInferredStatus !== 'unknown') {
      lines.push([
        `${t('monitor_last_known')}: ${t(`monitor_${home.lastInferredStatus}`)}`,
        'b',
      ])
      lines.push([
        `${t('monitor_last_confirmed')}: ${timestamp(home.lastInferredAt)}`,
      ])

      // A readable EZVIZ answer is shown even before it confirms a state change.
      const readable = (home.devices ?? []).some(
        device => device.status === 'online' || device.status === 'offline',
      )

      if (readable) {
        for (const device of home.devices) {
          const checks =
            device.status === 'offline'
              ? ` (${t('monitor_offline_checks', { count: device.offlineStreak, total: device.offlineChecks })})`
              : ''

          lines.push([
            `${t('monitor_ezviz_now')}: ${device.name} — ${t(`monitor_device_${device.status}`)}${checks}`,
          ])
        }
      } else {
        lines.push([t('monitor_check_inconclusive'), 'i'])
      }
    } else {
      lines.push([t('monitor_status_unknown'), 'b'])
      lines.push([`${t('monitor_observed')}: ${timestamp(home.observedAt)}`])
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
      `${t(`monitor_last_${opposite}`)}: ${timestamp(home[opposite === 'on' ? 'lastOn' : 'lastOff']?.detectedAt)}`,
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

const renderBriefStatus = (statuses, t, format) =>
  homeLines(statuses, t, (home, translate) => {
    const timestamp = value =>
      homeTimestamp(value, translate, home.timeZone, format)

    const [heading, [state, tag], ...details] = summaryLines(
      home,
      translate,
      timestamp,
    )

    const lastState =
      home.status === 'unknown' ? home.lastInferredStatus : home.status

    if (lastState === 'on' || lastState === 'off') {
      const episode = lastState === 'off' ? home.lastOff : home.lastOn

      if (episode) {
        details.unshift([
          `${translate('monitor_since')}: ${statusEpisode(episode, translate, timestamp)}`,
        ])
      }
    }

    const icon = { on: '⚡ ✅', off: '⚡ ❌', unknown: '⚡' }[home.status]

    return [heading, [''], [`${icon} ${state}`, tag], ...details]
  })

export const renderStatusMessages = (statuses, t) =>
  renderBriefStatus(statuses, t, statusFormat)

export const renderRecurringStatusMessages = (home, t) =>
  renderBriefStatus([home], t, notificationFormat)

const deviceLines = (device, t, timestamp) => {
  const lines = [
    [`${device.name}: ${t(`monitor_device_${device.status}`)}`],
    [`${t('monitor_observed')}: ${timestamp(device.observedAt)}`],
    [`${t('monitor_offline_streak')}: ${device.offlineStreak}`],
  ]

  if (device.errorCode) {
    lines.push([`${t('monitor_diagnostic')}: ${device.errorCode}`, 'i'])
  }

  return lines
}

export const renderFullStatusMessages = (statuses, t) =>
  homeLines(statuses, t, (home, translate) => {
    const timestamp = value =>
      homeTimestamp(value, translate, home.timeZone, statusFormat)

    const lines = [...summaryLines(home, translate, timestamp), ['']]

    if (home.stale) {
      lines.push([translate('monitor_stale'), 'i'])
    }

    if (home.uncertain) {
      lines.push([translate('monitor_uncertain'), 'i'])
    }

    lines.push(
      [`${translate('monitor_observed')}: ${timestamp(home.observedAt)}`],
      [
        `${translate('monitor_last_on')}: ${statusEpisode(home.lastOn, translate, timestamp)}`,
      ],
      [
        `${translate('monitor_last_off')}: ${statusEpisode(home.lastOff, translate, timestamp)}`,
      ],
      [`${translate('monitor_since')}: ${timestamp(home.stateSince)}`],
      [''],
      [translate('monitor_totals'), 'b'],
      [`${translate('monitor_on')}: ${duration(home.stats.onMs, translate)}`],
      [`${translate('monitor_off')}: ${duration(home.stats.offMs, translate)}`],
      [
        `${translate('monitor_unknown_time')}: ${duration(home.stats.uncertainMs, translate)}`,
      ],
      [`${translate('monitor_outages')}: ${home.stats.outageCount}`],
      [
        `${translate('monitor_tail')}: ${home.observedAt ? duration(home.unobservedTailMs, translate) : translate('monitor_not_observed')}`,
      ],
    )

    if (home.devices?.length) {
      lines.push([''], [translate('monitor_devices'), 'b'])

      for (const device of home.devices) {
        lines.push(...deviceLines(device, translate, timestamp))
      }
    }

    return lines
  })

export const renderPowerAlert = (delivery, home, t) => {
  const outage = delivery.state === 'off'

  const lines = [
    `⚡ ${outage ? '❌' : '✅'} ${t(outage ? 'monitor_outage' : 'monitor_restored')}`,
    '',
    `🏠 ${home.name}`,
    `🕒 ${homeTimestamp(delivery.detectedAt, t, home.timeZone, notificationFormat)}${delivery.baseline ? ` (${t('monitor_baseline')})` : ''}`,
  ]

  const { previousOffAt, precedingStateMs } = delivery.history ?? {}

  if (!outage && previousOffAt) {
    lines.push(
      `${t('monitor_outage_detected_at')}: ${homeTimestamp(previousOffAt, t, home.timeZone, notificationFormat)}`,
    )
  }

  if (precedingStateMs != null) {
    lines.push(
      `${t(outage ? 'monitor_observed_uptime' : 'monitor_observed_downtime')}: ${duration(precedingStateMs, t, true)}`,
    )
  }

  if (outage && previousOffAt) {
    lines.push(
      `${t('monitor_previous_outage')}: ${homeTimestamp(previousOffAt, t, home.timeZone, notificationFormat)}`,
    )

    const elapsed = Date.parse(delivery.detectedAt) - Date.parse(previousOffAt)

    if (elapsed >= 0) {
      lines.push(
        `${t('monitor_between_outages')}: ${duration(elapsed, t, true)}`,
      )
    }
  }

  if (delivery.uncertain) {
    lines.push('', `⚠️ ${t('monitor_uncertain')}`)
  }

  return messageChunks.splitPlainText(lines.join('\n'), messageLimit)
}
