import config from '../config'

import checkPowerStatus from '../cron/checkPowerStatus'

export default async monitorRuntime => {
  const tasks = []

  if (config.cron.checkPowerStatus.isEnabled) {
    const task = checkPowerStatus(monitorRuntime.homeMonitor)

    if (task) {
      tasks.push(task)
    }
  }

  return tasks
}
