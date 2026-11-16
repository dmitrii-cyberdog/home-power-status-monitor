import cron from 'node-cron'

import config from '../../config'

import { cron as cronService } from '../../services/cron'
import { Logger } from '../../services/logger'

import fn from './fn'

//
//

const TASK_NAME = 'checkPowerStatus'
const log = new Logger({ cron: TASK_NAME })

const cronScript = () => {
  const template = config.cron.checkPowerStatus.startTemplate

  if (!cron.validate(template)) {
    throw new Error('Invalid checkPowerStatus cron expression')
  }

  return cron.schedule(
    template,
    () => cronService.run(log, TASK_NAME, fn(log)),
    {
      name: TASK_NAME,
      timezone: 'UTC',
      noOverlap: true,
    },
  )
}

export default cronScript
