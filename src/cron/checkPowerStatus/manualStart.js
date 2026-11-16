import { flushLogger, Logger } from '../../services/logger'

import fn from './fn'

const log = new Logger({ script: 'manual_checkPowerStatus' })

try {
  const result = await fn(log)()

  log.notice('checkPowerStatus manual result', result)
} catch (error) {
  log.error('checkPowerStatus manual run failed', { error })
  process.exitCode = 1
} finally {
  await flushLogger()
}
