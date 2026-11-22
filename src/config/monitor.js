const positiveId = value =>
  /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))

export const parseMonitorConfig = env => {
  const fail = key => {
    throw new Error(`Invalid ${key}`)
  }

  const integer = (key, fallback, max = Number.MAX_SAFE_INTEGER, min = 1) => {
    const raw = env[key] ?? String(fallback)

    const value = Number(raw)

    if (
      !/^-?\d+$/.test(raw) ||
      !Number.isSafeInteger(value) ||
      value < min ||
      value > max
    ) {
      fail(key)
    }

    return value
  }

  const required = key => {
    if (typeof env[key] !== 'string' || !env[key].trim()) {
      fail(key)
    }

    return env[key]
  }

  const ids = new Set()

  const devices = new Map()

  for (const key of Object.keys(env)) {
    if (key.startsWith('EZVIZ_')) {
      throw new Error(
        'Use HOME_<id>_EZVIZ_API_APP_KEY/SECRET/BASE_URL instead of global EZVIZ keys',
      )
    }

    const home = /^HOME_([^_]+)_(.+)$/.exec(key)

    const device = /^DEVICE_([^_]+)_HOME_([^_]+)_(.+)$/.exec(key)

    if (home) {
      if (
        !positiveId(home[1]) ||
        ![
          'NAME',
          'TIME_ZONE',
          'NOTIFICATION_INTERVAL_MINUTES',
          'NOTIFICATION_INTERVAL_MODE',
          'NOTIFICATION_MODE',
          'EZVIZ_API_APP_KEY',
          'EZVIZ_API_SECRET',
          'EZVIZ_API_BASE_URL',
          'POWER_OFF_OFFLINE_DEVICE_COUNT',
        ].includes(home[2])
      ) {
        fail(`${key}; use HOME_<id>_NAME or HOME_<id>_EZVIZ_API_*`)
      }

      ids.add(home[1])
    }

    if (device) {
      if (
        !positiveId(device[1]) ||
        !positiveId(device[2]) ||
        !['TYPE', 'NAME', 'SERIAL'].includes(device[3])
      ) {
        fail(key)
      }

      ids.add(device[2])
      devices.set(`${device[2]}:${device[1]}`, {
        homeId: device[2],
        id: device[1],
      })
    }
  }

  const homes = [...ids]
    .sort((a, b) => Number(a) - Number(b))
    .map(id => {
      const prefix = `HOME_${id}_`

      const name = required(`${prefix}NAME`).trim()

      const timeZoneKey = `${prefix}TIME_ZONE`

      const timeZone = env[timeZoneKey] ?? (id === '1' ? 'GMT+2' : 'UTC')

      if (
        timeZone !== 'UTC' &&
        !/^GMT[+-](?:(?:[0-9]|1[0-3])(?::[0-5][0-9])?|14(?::00)?)$/.test(
          timeZone,
        )
      ) {
        fail(timeZoneKey)
      }

      const notificationIntervalMinutes = integer(
        `${prefix}NOTIFICATION_INTERVAL_MINUTES`,
        0,
        Math.floor(Number.MAX_SAFE_INTEGER / 60000) - 1,
        0,
      )

      const notificationMode = integer(`${prefix}NOTIFICATION_MODE`, 3, 3)

      const notificationIntervalMode = integer(
        `${prefix}NOTIFICATION_INTERVAL_MODE`,
        3,
        3,
      )

      const selected = [...devices.values()]
        .filter(device => device.homeId === id)
        .sort((a, b) => Number(a.id) - Number(b.id))
        .map(device => {
          const key = `DEVICE_${device.id}_HOME_${id}_`

          const type = required(`${key}TYPE`)

          if (type !== 'ezviz') {
            fail(`${key}TYPE`)
          }

          const serial = env[`${key}SERIAL`]?.trim()

          return {
            id: device.id,
            type,
            name: required(`${key}NAME`),
            ...(serial ? { serial } : {}),
          }
        })

      const thresholdKey = `${prefix}POWER_OFF_OFFLINE_DEVICE_COUNT`

      const offlineDeviceCount =
        env[thresholdKey] === '-1' ? -1 : integer(thresholdKey, 1)

      if (
        offlineDeviceCount !== -1 &&
        offlineDeviceCount > Math.max(1, selected.length)
      ) {
        fail(thresholdKey)
      }

      for (const device of selected) {
        const peers = selected.filter(other => other.name === device.name)

        if (
          (device.serial &&
            selected.some(
              other => other !== device && other.serial === device.serial,
            )) ||
          (peers.length > 1 && peers.some(other => !other.serial))
        ) {
          fail(`DEVICE_${device.id}_HOME_${id}_SERIAL`)
        }
      }

      const baseUrl =
        env[`${prefix}EZVIZ_API_BASE_URL`] ?? 'https://ieuopen.ezvizlife.com'

      if (baseUrl !== 'https://ieuopen.ezvizlife.com') {
        fail(`${prefix}EZVIZ_API_BASE_URL`)
      }

      const ezviz = selected.length
        ? {
            appKey: required(`${prefix}EZVIZ_API_APP_KEY`),
            appSecret: required(`${prefix}EZVIZ_API_SECRET`),
            baseUrl,
          }
        : null

      return {
        id,
        name,
        timeZone,
        notificationIntervalMinutes,
        notificationIntervalMode,
        notificationMode,
        offlineDeviceCount,
        ezviz,
        devices: selected,
      }
    })

  if (
    new Set(homes.map(home => home.name.toLowerCase())).size !== homes.length
  ) {
    fail('HOME_<id>_NAME: duplicate names')
  }

  return {
    intervalSeconds: integer('POWER_CHECK_INTERVAL_SECONDS', 60, 2147483),
    failedChecks: integer('POWER_OFF_FAILED_CHECKS', 3),
    continuityGraceMinutes: integer('POWER_CONTINUITY_GRACE_MINUTES', 5, 35791),
    homes,
  }
}
