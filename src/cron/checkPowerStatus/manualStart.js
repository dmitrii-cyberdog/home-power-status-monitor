import config from '../../config'

import {
  flushLogger,
  Logger,
  createMonitorRuntime,
  closeRequestAgents,
} from '../../services'

const log = new Logger({ script: 'manual_checkPowerStatus' })
let runtime

try {
  runtime = await createMonitorRuntime({ config, log })

  const result = await runtime.homeMonitor.check({ force: true })

  log.notice('checkPowerStatus manual result', result)
} catch (error) {
  log.error('checkPowerStatus manual run failed', { error })
  process.exitCode = 1
} finally {
  await runtime?.close()
  closeRequestAgents()
  await flushLogger()
}
