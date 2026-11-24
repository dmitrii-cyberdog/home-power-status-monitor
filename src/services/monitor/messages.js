import { getDayJs, messageChunks } from '../../utils'

const messageLimit = 4000

const homeTimestamp = (value, t, timeZone = 'UTC', format) => {
  if (!value) {
    return t('monitor_not_observed')
  }

  const [hours, minutes = '0'] = timeZone.slice(4).split(':')

  const sign = timeZone.startsWith('GMT-') ? -1 : 1

  const offset = sign * (Number(hours) * 60 + Number(minutes))

  return `${getDayJs()(value).add(offset, 'minute').format(format)} (${t('monitor_local_time')})`
}

const statusFormat = 'DD.MM.YYYY HH:mm'

const notificationFormat = 'DD.MM.YYYY HH:mm:ss'

const stateIcons = { on: '✅', off: '❌', unknown: '❓' }

const deviceIcons = { online: '🟢', offline: '🔌', unknown: '❓' }

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

const stateLine = (status, t) => [
  `${t(`monitor_${status}`)} ${stateIcons[status]}`,
  'b',
]

const sinceLines = (home, t, timestamp) => {
  const lastState =
    home.status === 'unknown' ? home.lastInferredStatus : home.status

  const episode =
    lastState === 'off' ? home.lastOff : lastState === 'on' ? home.lastOn : null

  return episode
    ? [
        [
          `🕒 ${t(`monitor_detected_${lastState}`)} ${statusEpisode(episode, t, timestamp)}`,
        ],
      ]
    : []
}

const summaryLines = (home, t, timestamp, brief = false) => {
  const lines = [[home.name, 'b'], ['']]

  const since = brief ? sinceLines(home, t, timestamp) : []

  if (home.status === 'unknown') {
    if (home.lastInferredStatus && home.lastInferredStatus !== 'unknown') {
      lines.push([`⚡ ${t('monitor_last_known')}:`])
      lines.push(stateLine(home.lastInferredStatus, t))
      lines.push([''], ...since)
      lines.push([
        `🔄 ${t('monitor_last_confirmed')}: ${timestamp(home.lastInferredAt)}`,
      ])
      lines.push([''])

      // A readable EZVIZ answer is shown even before it confirms a state change.
      const readable = (home.devices ?? []).some(
        device => device.status === 'online' || device.status === 'offline',
      )

      if (readable) {
        for (const device of home.devices) {
          const checks =
            device.status === 'offline'
              ? ` (${t('monitor_offline_checks', { count: device.offlineStreak, total: device.offlineChecks })} ⌛)`
              : ''

          lines.push([
            `📷 ${t('monitor_ezviz_now', { device: device.name })}: ${t(`monitor_device_${device.status}`)} ${deviceIcons[device.status]}${checks}`,
          ])
        }
      } else {
        lines.push([`⚠️ ${t('monitor_check_inconclusive')}`, 'i'])
      }
    } else {
      lines.push([`⚡ ${t('monitor_status_unknown')} ❓`, 'b'])
      lines.push([''], ...since)
      lines.push([`👁 ${t('monitor_observed')}: ${timestamp(home.observedAt)}`])
    }
  } else {
    const [state, tag] = stateLine(home.status, t)

    lines.push([`⚡ ${state}`, tag])

    if (home.durationMs == null) {
      lines.push([`⚠️ ${t('monitor_continuity_unknown')}`, 'i'])
    } else {
      lines.push([
        `⏱ ${t('monitor_power_for', { duration: duration(home.durationMs, t) })}`,
      ])
    }

    const opposite = home.status === 'on' ? 'off' : 'on'

    lines.push([''], ...since)

    const oppositeEpisode = home[opposite === 'on' ? 'lastOn' : 'lastOff']

    const oppositeAt = timestamp(oppositeEpisode?.detectedAt)

    if (brief) {
      if (oppositeEpisode) {
        lines.push(
          [''],
          [
            `${stateIcons[opposite]} ${t(`monitor_before_${opposite}`)} ${oppositeAt}`,
          ],
        )
      }
    } else {
      lines.push([
        `${stateIcons[opposite]} ${t(`monitor_last_${opposite}`)}: ${oppositeAt}`,
      ])
    }
  }

  return lines
}

const homeLines = (statuses, t, render) => {
  if (statuses.length === 0) {
    return messageChunks.chunkHtmlLines(
      [[t('monitor_empty'), 'i']],
      messageLimit,
    )
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

    return summaryLines(home, translate, timestamp, true)
  })

export const renderStatusMessages = (statuses, t) =>
  renderBriefStatus(statuses, t, statusFormat)

export const renderRecurringStatusMessages = (home, t) =>
  renderBriefStatus([home], t, notificationFormat)

const deviceLines = (device, t, timestamp) => {
  const lines = [
    [
      `📷 ${device.name}: ${t(`monitor_device_${device.status}`)} ${deviceIcons[device.status]}`,
      'b',
    ],
    [`👁 ${t('monitor_observed')}: ${timestamp(device.observedAt)}`],
    [`🔁 ${t('monitor_offline_streak')}: ${device.offlineStreak}`],
  ]

  if (device.errorCode) {
    lines.push([`🛠 ${t('monitor_diagnostic')}: ${device.errorCode}`, 'i'])
  }

  return lines
}

export const renderFullStatusMessages = (statuses, t) =>
  homeLines(statuses, t, (home, translate) => {
    const timestamp = value =>
      homeTimestamp(value, translate, home.timeZone, statusFormat)

    const lines = [...summaryLines(home, translate, timestamp), ['']]

    if (home.stale) {
      lines.push([`⚠️ ${translate('monitor_stale')}`, 'i'])
    }

    if (home.uncertain) {
      lines.push([`⚠️ ${translate('monitor_uncertain')}`, 'i'])
    }

    lines.push(
      [`👁 ${translate('monitor_observed')}: ${timestamp(home.observedAt)}`],
      [
        `✅ ${translate('monitor_last_on')}: ${statusEpisode(home.lastOn, translate, timestamp)}`,
      ],
      [
        `❌ ${translate('monitor_last_off')}: ${statusEpisode(home.lastOff, translate, timestamp)}`,
      ],
      [`🕒 ${translate('monitor_since')}: ${timestamp(home.stateSince)}`],
      [''],
      [`📊 ${translate('monitor_totals')}`, 'b'],
      [
        `✅ ${translate('monitor_on')}: ${duration(home.stats.onMs, translate)}`,
      ],
      [
        `❌ ${translate('monitor_off')}: ${duration(home.stats.offMs, translate)}`,
      ],
      [
        `❓ ${translate('monitor_unknown_time')}: ${duration(home.stats.uncertainMs, translate)}`,
      ],
      [`🔢 ${translate('monitor_outages')}: ${home.stats.outageCount}`],
      [
        `⏳ ${translate('monitor_tail')}: ${home.observedAt ? duration(home.unobservedTailMs, translate) : translate('monitor_not_observed')}`,
      ],
    )

    if (home.devices?.length) {
      lines.push([''], [`📷 ${translate('monitor_devices')}`, 'b'])

      for (const device of home.devices) {
        lines.push([''], ...deviceLines(device, translate, timestamp))
      }
    }

    return lines
  })

export const renderPowerAlert = (delivery, home, t) => {
  const outage = delivery.state === 'off'

  const lines = [
    [
      `⚡ ${outage ? '❌' : '✅'} ${t(outage ? 'monitor_outage' : 'monitor_restored')}`,
      'b',
    ],
    [''],
    [`🏠 ${home.name}`, 'b'],
    [
      `🕒 ${homeTimestamp(delivery.detectedAt, t, home.timeZone, notificationFormat)}${delivery.baseline ? ` (${t('monitor_baseline')})` : ''}`,
    ],
  ]

  const { previousOffAt, precedingStateMs } = delivery.history ?? {}

  if (previousOffAt || precedingStateMs != null) {
    lines.push([''])
  }

  if (!outage && previousOffAt) {
    lines.push([
      `🔌 ${t('monitor_restored_off_at')} ${homeTimestamp(previousOffAt, t, home.timeZone, notificationFormat)}`,
    ])
  }

  if (!outage) {
    // Without observed continuity the time between detections is only approximate.
    const elapsed = previousOffAt
      ? Date.parse(delivery.detectedAt) - Date.parse(previousOffAt)
      : -1

    const downtime = precedingStateMs ?? (elapsed >= 0 ? elapsed : null)

    if (downtime != null) {
      lines.push([
        `⏱ ${t('monitor_restored_downtime')} ${precedingStateMs == null ? '≈ ' : ''}${duration(downtime, t, true)}`,
      ])
    }
  } else if (precedingStateMs != null) {
    lines.push([
      `⏱ ${t('monitor_observed_uptime')}: ${duration(precedingStateMs, t, true)}`,
    ])
  }

  if (outage && previousOffAt) {
    lines.push([
      `📅 ${t('monitor_previous_outage')}: ${homeTimestamp(previousOffAt, t, home.timeZone, notificationFormat)}`,
    ])

    const elapsed = Date.parse(delivery.detectedAt) - Date.parse(previousOffAt)

    if (elapsed >= 0) {
      const sincePreviousOutage = duration(elapsed, t, true)

      lines.push([
        `↔️ ${t('monitor_between_outages', { duration: sincePreviousOutage })}`,
      ])
    }
  }

  if (delivery.uncertain) {
    lines.push([''], [`⚠️ ${t('monitor_uncertain')}`, 'i'])
  }

  return messageChunks.chunkHtmlLines(lines, messageLimit)
}
