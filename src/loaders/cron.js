import config from '../config'

import checkPowerStatus from '../cron/checkPowerStatus/cron'

export default async () => {
  const tasks = []

  if (config.cron.checkPowerStatus.isEnabled) {
    const task = checkPowerStatus()

    if (task) {
      tasks.push(task)
    }
  }

  return tasks
}
