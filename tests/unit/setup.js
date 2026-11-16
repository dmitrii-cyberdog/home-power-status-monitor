import { after } from 'node:test'

// Tests must never read private environment files or contact Telegram.
Object.assign(process.env, {
  NODE_ENV: 'test',
  DEFAULT_LOCALE: 'en',
  CRON_CHECK_POWER_STATUS_IS_ENABLED: '0',
  CRON_CHECK_POWER_STATUS_TEMPLATE: '* * * * *',
  TG_BOT_TOKEN: '',
})

//
//

after(async () => {
  const { closeRequestAgents } =
    await import('../../src/services/requestsService/index.js')
  const { drainTelegramApiQueue } =
    await import('../../src/services/telegramApiQueue.js')
  const { flushLogger } = await import('../../src/services/logger.js')

  await drainTelegramApiQueue()
  closeRequestAgents()
  await flushLogger()
})
