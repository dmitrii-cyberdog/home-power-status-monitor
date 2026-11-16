const MAX_PENDING_UPDATES_PER_SENDER = 3

const pendingBySender = new Map()
const busyNotifiedBySender = new Set()

const notifyBusy = async ctx => {
  const message =
    typeof ctx.t === 'function'
      ? ctx.t('pending_request_exists')
      : 'Your previous requests are still processing. Please wait a moment.'

  try {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: message })
    } else if (ctx.msg) {
      await ctx.reply(message)
    }
  } catch (error) {
    ctx.log?.warning('bot_sender_queue_notice_failed', {
      code: error?.error_code || error?.code || null,
      description: error?.description || error?.message || null,
      updateId: ctx.update?.update_id,
    })
  }
}

//
//

export default async (ctx, next) => {
  const senderId = ctx.chatId ?? ctx.from?.id

  if (senderId == null) {
    return await next()
  }

  const key = String(senderId)
  const pending = pendingBySender.get(key) || 0

  if (pending >= MAX_PENDING_UPDATES_PER_SENDER) {
    ctx.log?.warning('bot_sender_queue_full', {
      senderId: key,
      updateId: ctx.update?.update_id,
    })

    if (!busyNotifiedBySender.has(key)) {
      busyNotifiedBySender.add(key)
      await notifyBusy(ctx)
    }

    return
  }

  pendingBySender.set(key, pending + 1)

  try {
    return await next()
  } finally {
    const remaining = (pendingBySender.get(key) || 1) - 1

    if (remaining === 0) {
      pendingBySender.delete(key)
      busyNotifiedBySender.delete(key)
    } else {
      pendingBySender.set(key, remaining)
    }
  }
}

export { MAX_PENDING_UPDATES_PER_SENDER }
