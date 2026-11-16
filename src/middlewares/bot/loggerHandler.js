import { nanoid } from 'nanoid'

import { Logger } from '../../services'

export default async (ctx, next) => {
  const traceId = nanoid()

  const log = new Logger({
    traceId,
    //
    tgId: ctx?.from?.id,
  })

  // console.log('ctx', ctx)

  log.debug('Incoming event', {
    updateId: ctx.update?.update_id,
    chatId: ctx.chat?.id,
    type: ctx.msg
      ? Object.keys(ctx.msg).find(key =>
          ['text', 'photo', 'voice', 'animation', 'document'].includes(key),
        ) || 'message'
      : ctx.callbackQuery
        ? 'callback_query'
        : 'event',
    textLength: ctx.msg?.text?.length || ctx.msg?.caption?.length || 0,
  })

  // save entity into ctx to get access everywhere later
  ctx.log = log

  await next()
}
