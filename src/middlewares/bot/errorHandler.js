import { GrammyError, HttpError } from 'grammy'

// import config from '../../config'

import { Logger, replyFormatted } from '../../services'

export default bot => {
  bot.catch(async botError => {
    const { ctx, error } = botError

    //

    let { log } = ctx

    if (!log) {
      log = new Logger()
    }

    //

    let errorDescription

    if (error instanceof GrammyError) {
      errorDescription = 'While handling update'
    } else if (error instanceof HttpError) {
      errorDescription = 'Could not contact Telegram'
    } else {
      errorDescription = 'Unknown'
    }

    log.error(`Bot Error - ${errorDescription}`, {
      updateId: ctx.update?.update_id,
      messageId: ctx.msg?.message_id,
      chatId: ctx.chat?.id,
      chatType: ctx.chat?.type,
      fromId: ctx.from?.id,
    })

    try {
      if (ctx.chat) {
        await replyFormatted(
          ctx,
          typeof ctx.t === 'function'
            ? ctx.t('general_error')
            : 'Unknown error occurred! Please try again later',
          'i',
        )
      }
    } catch (replyError) {
      log.error('Bot Error Reply Failed', {
        failed: Boolean(replyError),
        updateId: ctx.update?.update_id,
      })
    }
  })
}
