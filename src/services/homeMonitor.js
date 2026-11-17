import { projectHomeStatus, reduceHomeObservation } from './powerHistory'

export const createHomeMonitor = ({
  monitor,
  store,
  access,
  homes,
  runId,
  intervalSeconds,
  now = Date.now,
  log,
}) => {
  let pending

  const devices = new Map()

  const getStatuses = () =>
    homes.map(home => ({
      ...projectHomeStatus(store.readHome(home.id), {
        home,
        runId,
        intervalSeconds,
        now: now(),
      }),
      devices: structuredClone(devices.get(home.id) ?? []),
    }))

  return {
    getStatuses,
    check({ onlyIfStale = false } = {}) {
      if (
        !pending &&
        onlyIfStale &&
        homes.every(home => {
          const sample = store.readHome(home.id).sample

          const age = sample ? now() - Date.parse(sample.observedAt) : null

          return age !== null && age >= 0 && age < 60000
        })
      ) {
        return Promise.resolve(getStatuses())
      }

      pending ??= (async () => {
        const observations = await monitor.check()

        const results = await Promise.allSettled(
          observations.homes.map(async observation => {
            await store.updateHome(observation.id, (record, registry) => {
              const next = reduceHomeObservation(record, observation, {
                runId,
                intervalSeconds,
                recipients: access.recipients(observation.id, registry),
              })

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
