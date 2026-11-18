import { createEzvizClient } from '../ezviz'

const diagnosticCodes = new Set([
  'transport_error',
  'invalid_response',
  'auth_failed',
  'rate_limited',
  'provider_error',
  'device_not_found',
  'serial_mismatch',
  'ambiguous_device',
  'invalid_device_status',
])

export const createPowerMonitor = (
  settings,
  { createClient = createEzvizClient, now = Date.now } = {},
) => {
  const states = settings.homes.map(home => ({
    home,
    client: home.devices.length ? createClient(home.ezviz) : null,
    devices: home.devices.map(() => ({ streak: 0, serial: null })),
    lastInferredStatus: 'unknown',
    lastInferredAt: null,
  }))

  let pending = null

  const check = () => {
    if (!pending) {
      pending = Promise.all(
        states.map(async state => {
          const { home } = state

          let observations

          try {
            observations = state.client
              ? await state.client.observeDevices(home.devices)
              : []
          } catch {
            observations = home.devices.map(() => ({
              status: 'unknown',
              errorCode: 'transport_error',
            }))
          }

          const observedAt = new Date(now()).toISOString()

          const devices = home.devices.map((device, index) => {
            const observation = observations[index]

            const memory = state.devices[index]

            if (
              !device.serial &&
              observation.resolvedSerial &&
              memory.serial !== observation.resolvedSerial
            ) {
              memory.streak = 0
              memory.serial = observation.resolvedSerial
            }

            memory.streak =
              observation.status === 'offline'
                ? Math.min(settings.failedChecks, memory.streak + 1)
                : 0

            return {
              id: device.id,
              name: device.name,
              status: observation.status,
              observedAt: observation.observedAt ?? observedAt,
              offlineStreak: memory.streak,
              ...(observation.errorCode
                ? {
                    errorCode: diagnosticCodes.has(observation.errorCode)
                      ? observation.errorCode
                      : 'invalid_response',
                  }
                : {}),
            }
          })

          const k =
            home.offlineDeviceCount === -1
              ? devices.length
              : home.offlineDeviceCount

          const offline = devices.filter(
            device => device.offlineStreak >= settings.failedChecks,
          ).length

          const online = devices.filter(
            device => device.status === 'online',
          ).length

          const status = !devices.length
            ? 'unknown'
            : offline >= k
              ? 'off'
              : online >= devices.length - k + 1
                ? 'on'
                : 'unknown'

          if (status !== 'unknown') {
            state.lastInferredStatus = status
            state.lastInferredAt = observedAt
          }

          return {
            id: home.id,
            name: home.name,
            status,
            observedAt,
            lastInferredStatus: state.lastInferredStatus,
            lastInferredAt: state.lastInferredAt,
            devices,
          }
        }),
      )
        .then(homes => ({ homes }))
        .finally(() => {
          pending = null
        })
    }

    return pending.then(result => structuredClone(result))
  }

  return { check }
}
