import { powerHistory } from './power'

export const createHomeMonitor = ({
  monitor,
  store,
  access,
  homes,
  runId,
  intervalSeconds,
  continuityGraceMinutes = 0,
  failedChecks = 1,
  now = Date.now,
  monotonicNow = () => performance.now(),
  log,
}) => {
  let pending

  let lastStartedAt

  const effectiveIntervalSeconds = Math.max(60, intervalSeconds)

  const minimumMs = effectiveIntervalSeconds * 1000

  // The grace window always covers a full offline streak plus one polling interval.
  const continuityGraceMs = Math.max(
    continuityGraceMinutes * 60000,
    (failedChecks + 1) * effectiveIntervalSeconds * 1000,
  )

  const devices = new Map()

  const getStatuses = () =>
    homes.map(home => ({
      ...powerHistory.projectHomeStatus(store.readHome(home.id), {
        home,
        runId,
        intervalSeconds: effectiveIntervalSeconds,
        now: now(),
      }),
      devices: structuredClone(devices.get(home.id) ?? []),
    }))

  return {
    getStatuses,
    check({ force = false } = {}) {
      if (pending) {
        return pending
      }

      // Start with a fresh observation, then enforce the in-process cooldown.
      const isFresh =
        lastStartedAt !== undefined &&
        monotonicNow() - lastStartedAt < minimumMs - 1000

      if (!force && isFresh) {
        return Promise.resolve(getStatuses())
      }

      // The start time is recorded first so failed rounds still apply the cooldown.
      lastStartedAt = monotonicNow()

      pending = (async () => {
        const observations = await monitor.check()

        const results = await Promise.allSettled(
          observations.homes.map(async observation => {
            await store.updateHome(observation.id, (record, registry) => {
              const next = powerHistory.reduceHomeObservation(
                record,
                observation,
                {
                  runId,
                  intervalSeconds: effectiveIntervalSeconds,
                  continuityGraceMs,
                  recipients: access.recipients(observation.id, registry),
                },
              )

              if (next.droppedAlerts > record.droppedAlerts) {
                log?.error('Pending alert capacity exceeded', {
                  homeId: observation.id,
                  dropped: next.droppedAlerts - record.droppedAlerts,
                })
              }

              return next
            })

            devices.set(observation.id, observation.devices ?? [])

            for (const device of observation.devices ?? []) {
              if (device.errorCode) {
                log?.warning('Device observation unavailable', {
                  homeId: observation.id,
                  deviceId: device.id,
                  errorCode: device.errorCode,
                })
              }
            }
          }),
        )

        const failures = results.filter(result => result.status === 'rejected')

        if (failures.length) {
          throw new Error('Monitoring round persistence failed')
        }

        return getStatuses()
      })().finally(() => {
        pending = null
      })

      return pending
    },
  }
}
