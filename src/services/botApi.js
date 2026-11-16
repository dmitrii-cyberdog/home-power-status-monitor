import { autoRetry } from '@grammyjs/auto-retry'
import { I18n } from '@grammyjs/i18n'

import config from '../config'

import { telegramApiThrottler } from './telegramApiQueue'

//
//

export const i18n = new I18n(config.botSettings.i18nSettings)

export const configureTelegramApi = api => {
  api.config.use(telegramApiThrottler)
  api.config.use(
    autoRetry({
      maxRetryAttempts: 3,
      maxDelaySeconds: 30,
      rethrowHttpErrors: true,
      rethrowInternalServerErrors: true,
    }),
  )
}
