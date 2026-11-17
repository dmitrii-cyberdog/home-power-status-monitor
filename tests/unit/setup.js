import { after } from 'node:test'

// Tests must never read private environment files or contact Telegram.
for (const key of Object.keys(process.env)) {
  if (/^(HOME_|DEVICE_|EZVIZ_|POWER_)/.test(key)) {
    delete process.env[key]
  }
}

Object.assign(process.env, {
  NODE_ENV: 'test',
  DEFAULT_LOCALE: 'en',
  CRON_CHECK_POWER_STATUS_IS_ENABLED: '0',
  TG_BOT_ACCESS_SECRET: '',
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
