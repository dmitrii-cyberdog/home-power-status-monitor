import { Logger } from '../services/logger'

import botLoader from './bot'
import cronLoader from './cron'

//
//

export default async (runtime, onBotFailure = () => {}, signal) => {
  try {
    if (signal?.aborted) {
      return runtime
    }

    runtime.cronTasks = await cronLoader()

    if (signal?.aborted) {
      return runtime
    }

    runtime.botRunner = await botLoader(signal)

    if (runtime.botRunner) {
      runtime.botTask = runtime.botRunner.task()

      void runtime.botTask.catch(onBotFailure)
    }

    Logger.notice('Home Power Status Monitor started', {
      cronTasks: runtime.cronTasks.length,
      telegramEnabled: Boolean(runtime.botRunner),
    })

    return runtime
  } catch (error) {
    error.runtime = runtime

    throw error
  }
}
