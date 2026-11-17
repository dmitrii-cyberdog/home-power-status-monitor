import { Request } from './requestsService'

const defaultFactory = origin => new Request(origin, '', null, 1, 10000)

const diagnostic = code => {
  if (['10001', '10002', '10005', '10017'].includes(code)) {
    return 'auth_failed'
  }

  return ['10007', '10029'].includes(code) ? 'rate_limited' : 'provider_error'
}

export const createEzvizClient = (
  settings,
  { requestFactory = defaultFactory, now = Date.now } = {},
) => {
  let token = null

  let acquiring = null

  const post = async (origin, path, fields) => {
    let response

    try {
      response = await requestFactory(origin).postXwwwForm(path, fields)
    } catch {
      throw new Error('transport_error')
    }

    if (response.error || response.status !== 200) {
      throw new Error('transport_error')
    }

    if (!response.content || typeof response.content.code !== 'string') {
      throw new Error('invalid_response')
    }

    return response.content
  }

  const getToken = () => {
    if (token && token.expireTime > now() + 60000) {
      return Promise.resolve(token)
    }

    if (!acquiring) {
      acquiring = (async () => {
        const result = await post(
          'https://open.ezvizlife.com',
          '/api/lapp/token/get',
          { appKey: settings.appKey, appSecret: settings.appSecret },
        )

        if (result.code !== '200') {
          throw new Error(diagnostic(result.code))
        }

        const data = result.data

        if (
          !data ||
          typeof data.accessToken !== 'string' ||
          !data.accessToken ||
          !Number.isFinite(data.expireTime) ||
          data.expireTime <= now() + 60000 ||
          data.areaDomain !== settings.baseUrl
        ) {
          throw new Error('invalid_response')
        }

        token = data

        return token
      })().finally(() => {
        acquiring = null
      })
    }

    return acquiring
  }

  const list = async () => {
    let refreshed = false

    let current = await getToken()

    let total

    let pageStart = 0

    const rows = []

    const serials = new Set()

    do {
      const result = await post(settings.baseUrl, '/api/lapp/device/list', {
        accessToken: current.accessToken,
        pageStart,
        pageSize: 50,
      })

      if (result.code === '10002' && !refreshed) {
        refreshed = true

        if (token === current) {
          token = null
        }

        current = await getToken()
        pageStart = 0
        total = undefined
        rows.length = 0
        serials.clear()
        continue
      }

      if (result.code !== '200') {
        throw new Error(diagnostic(result.code))
      }

      const { page, data } = result

      if (
        !page ||
        page.page !== pageStart ||
        page.size !== 50 ||
        !Number.isSafeInteger(page.total) ||
        page.total < 0 ||
        (total !== undefined && total !== page.total) ||
        !Array.isArray(data) ||
        data.length !== Math.min(50, Math.max(0, page.total - pageStart * 50))
      ) {
        throw new Error('invalid_response')
      }

      total = page.total

      for (const row of data) {
        if (
          typeof row.deviceName !== 'string' ||
          !row.deviceName.trim() ||
          typeof row.deviceSerial !== 'string' ||
          !row.deviceSerial.trim() ||
          serials.has(row.deviceSerial)
        ) {
          throw new Error('invalid_response')
        }

        serials.add(row.deviceSerial)
        rows.push(row)
      }

      pageStart++
    } while (total === undefined || pageStart * 50 < total)

    return rows
  }

  return {
    async observeDevices(devices) {
      let rows

      try {
        rows = await list()
      } catch (error) {
        const errorCode = [
          'transport_error',
          'invalid_response',
          'auth_failed',
          'rate_limited',
          'provider_error',
        ].includes(error.message)
          ? error.message
          : 'invalid_response'

        return devices.map(() => ({
          status: 'unknown',
          observedAt: new Date(now()).toISOString(),
          errorCode,
        }))
      }

      const observedAt = new Date(now()).toISOString()

      return devices.map(device => {
        const named = rows.filter(row => row.deviceName === device.name)

        const matches = device.serial
          ? named.filter(row => row.deviceSerial === device.serial)
          : named

        const row = matches[0]

        const errorCode = !named.length
          ? 'device_not_found'
          : !matches.length
            ? 'serial_mismatch'
            : matches.length > 1
              ? 'ambiguous_device'
              : ![0, 1].includes(row.status)
                ? 'invalid_device_status'
                : null

        return errorCode
          ? { status: 'unknown', observedAt, errorCode }
          : {
              status: row.status === 1 ? 'online' : 'offline',
              observedAt,
              resolvedSerial: row.deviceSerial,
            }
      })
    },
  }
}
