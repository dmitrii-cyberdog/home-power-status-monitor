import config from '../../config'

import { cron as cronService } from '../../services/cron'
import { Logger } from '../../services/logger'

import fn from './fn'

//
//

const TASK_NAME = 'checkPowerStatus'
const log = new Logger({ cron: TASK_NAME })

export const createPowerStatusTask = ({ intervalSeconds, operation, log }) => {
  let stopped = false
  let pending = null
  const execute = () => {
    if (stopped) {
      return Promise.reject(new Error('Power status task stopped'))
    }

    pending ??= cronService.run(log, TASK_NAME, operation).finally(() => {
      pending = null
    })

    return pending
  }
  const timer = setInterval(() => {
    if (!pending && !stopped) {
      void execute().catch(() => {})
    }
  }, intervalSeconds * 1000)
  const stop = async () => {
    stopped = true
    clearInterval(timer)
    await pending
  }

  return { name: TASK_NAME, execute, stop, destroy: stop }
}

export default homeMonitor =>
  createPowerStatusTask({
    intervalSeconds: config.monitor.intervalSeconds,
    operation: fn(log, homeMonitor),
    log,
  })
