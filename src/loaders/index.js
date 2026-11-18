import config from '../config'

import { Logger, createMonitorRuntime } from '../services'

import botLoader from './bot'
import cronLoader from './cron'

export { drainBotRunner } from './bot'
export { default as loadCron } from './cron'

//
//

export default async (runtime, onBotFailure = () => {}, signal) => {
  try {
    if (signal?.aborted) {
      return runtime
    }

    runtime.monitorInitialization = createMonitorRuntime({
      config,
      log: Logger,
    })
    runtime.monitorRuntime = await runtime.monitorInitialization

    if (signal?.aborted) {
      await runtime.monitorRuntime.close()

      return runtime
    }

    runtime.cronTasks = await cronLoader(runtime.monitorRuntime)

    if (signal?.aborted) {
      return runtime
    }

    runtime.botRunner = await botLoader(signal, runtime.monitorRuntime)

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
