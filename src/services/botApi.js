import { autoRetry } from '@grammyjs/auto-retry'
import { I18n } from '@grammyjs/i18n'

import config from '../config'

import { escapeHtmlText } from '../utils/common'

import { telegramApiThrottler } from './telegramApiQueue'

//
//

let i18n

export const getI18n = () =>
  (i18n ??= new I18n(config.botSettings.i18nSettings))

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

//
//

export const formatBotText = (text, tag) =>
  `<${tag}>${escapeHtmlText(text)}</${tag}>`

export const replyFormatted = (ctx, text, tag, options) =>
  ctx.reply(formatBotText(text, tag), { ...options, parse_mode: 'HTML' })
