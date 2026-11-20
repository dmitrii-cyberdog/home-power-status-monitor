import { Composer, InlineKeyboard } from 'grammy'

import { supportedLocales } from '../../../config'

import { accessDeniedKey, createAccessHandler } from '../../../middlewares/bot'

import {
  createTelegramSendGuard,
  isTelegramSendSkipped,
  getI18n,
  monitorMessages,
} from '../../../services'

const notificationCommands = ['on_notification', 'off_notification']
const monitorCommands = ['status', 'status_full', ...notificationCommands]
const subscriptionAction = /^subscription:(on|off):([1-9]\d*)$/

const subscriptionKeyboard = (ctx, homeId, enabled) =>
  new InlineKeyboard().text(
    ctx.t(
      enabled ? 'subscription_button_disable' : 'subscription_button_enable',
    ),
    `subscription:${enabled ? 'off' : 'on'}:${homeId}`,
  )

const commandEntity = message =>
  message?.entities?.find(
    entity => entity.type === 'bot_command' && entity.offset === 0,
  )

const notificationReply = ctx => {
  const message = ctx.message

  const prompt = message?.reply_to_message

  if (
    !message?.text ||
    commandEntity(message) ||
    prompt?.from?.id !== ctx.me.id
  ) {
    return undefined
  }

  return notificationCommands.find(command =>
    supportedLocales.some(
      locale =>
        prompt.text === getI18n().t(locale, `subscription_prompt_${command}`),
    ),
  )
}

//
//

export const createMonitorCommands = ({ access, homeMonitor }) => {
  const composer = new Composer()

  composer.use(async (ctx, next) => {
    const message = ctx.message

    const command = commandEntity(message)

    if (ctx.chat?.type !== 'private' && command) {
      const text = message.text.slice(0, command.length)

      if (!text.toLowerCase().endsWith(`@${ctx.me.username.toLowerCase()}`)) {
        return
      }
    }

    await next()
  })

  composer.command('secret', async ctx => {
    try {
      if (ctx.chat.type !== 'private') {
        await ctx.reply(ctx.t('access_group_secret_rejected'))

        return
      }

      const entity = commandEntity(ctx.msg)

      const supplied = ctx.msg.text.slice(entity.length + 1)

      const locale = (await ctx.i18n?.getLocale()) ?? 'en'

      const result = await access.authorize(
        String(ctx.chat.id),
        supplied,
        locale,
      )

      await ctx.reply(ctx.t(`access_${result}`))
    } catch {
      await ctx.reply(ctx.t('general_error'))
    } finally {
      try {
        await ctx.deleteMessage()
      } catch {
        // Deletion permissions do not affect chat authorization.
      }
    }
  })

  //
  //

  composer.callbackQuery(/^subscription:/, async ctx => {
    const action = subscriptionAction.exec(ctx.callbackQuery.data)

    const message = ctx.callbackQuery.message

    if (
      !action ||
      !message?.date ||
      message.chat.type !== 'private' ||
      message.chat.id !== ctx.from.id
    ) {
      await ctx.answerCallbackQuery()

      return
    }

    const chatId = String(message.chat.id)

    if (!access.isAuthorized(chatId)) {
      await ctx.answerCallbackQuery({ text: ctx.t('access_denied') })

      return
    }

    const [, target, homeId] = action

    if (!homeMonitor.getStatuses().some(home => home.id === homeId)) {
      await ctx.answerCallbackQuery({ text: ctx.t('monitor_not_found') })

      return
    }

    const enabled = target === 'on'

    let result

    try {
      result = await access.setSubscription(chatId, homeId, enabled)
    } catch (error) {
      await ctx.answerCallbackQuery()

      throw error
    }

    await ctx.answerCallbackQuery({ text: ctx.t(`subscription_${result}`) })

    const replyMarkup = subscriptionKeyboard(ctx, homeId, enabled)

    const button = message.reply_markup?.inline_keyboard[0]?.[0]

    const [nextButton] = replyMarkup.inline_keyboard[0]

    if (
      button?.text !== nextButton.text ||
      button?.callback_data !== nextButton.callback_data
    ) {
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: replyMarkup })
      } catch {
        ctx.log?.warning('subscription_keyboard_edit_failed', {
          updateId: ctx.update.update_id,
        })
      }
    }
  })

  //
  //

  const protectedCommands = new Composer()

  protectedCommands.use(createAccessHandler({ access }))

  protectedCommands.on('message:text', async ctx => {
    const replyCommand = notificationReply(ctx)

    const command = replyCommand ?? ctx.message.text.split(/[\s@]/)[0].slice(1)

    const isStatus = command === 'status' || command === 'status_full'

    const argument = (replyCommand ? ctx.message.text : ctx.match)
      .trim()
      .toLowerCase()

    if (!isStatus && !argument) {
      await ctx.reply(ctx.t(`subscription_prompt_${command}`), {
        reply_markup: { force_reply: true, selective: true },
        reply_parameters: { message_id: ctx.message.message_id },
      })

      return
    }

    const home = argument
      ? homeMonitor
          .getStatuses()
          .find(candidate => candidate.name.toLowerCase() === argument)
      : undefined

    if (argument && !home) {
      await ctx.reply(ctx.t('monitor_not_found'))

      return
    }

    if (isStatus) {
      const chatId = String(ctx.chat.id)

      const grant = access.captureGrant(chatId)

      if (!grant) {
        await ctx.reply(ctx.t(accessDeniedKey(ctx)))

        return
      }

      const updatedStatuses = await homeMonitor.check()

      const render =
        command === 'status_full'
          ? monitorMessages.renderFullStatusMessages
          : monitorMessages.renderStatusMessages

      const messages = render(
        argument
          ? updatedStatuses.filter(updated => updated.id === home.id)
          : updatedStatuses,
        ctx.t.bind(ctx),
      )

      // Each chunk is dispatched only while the captured grant is current.
      const signal = createTelegramSendGuard(() =>
        access.isGrantCurrent(chatId, grant),
      )

      for (const [index, text] of messages.entries()) {
        if (!access.isAuthorized(chatId)) {
          await ctx.reply(ctx.t(accessDeniedKey(ctx)))

          return
        }

        const options = { parse_mode: 'HTML' }

        if (
          command === 'status' &&
          argument &&
          ctx.chat.type === 'private' &&
          index === messages.length - 1
        ) {
          options.reply_markup = subscriptionKeyboard(
            ctx,
            home.id,
            access.isSubscribed(chatId, home.id),
          )
        }

        try {
          await ctx.reply(text, options, signal)
        } catch (error) {
          if (isTelegramSendSkipped(error)) {
            return
          }

          throw error
        }
      }

      return
    }

    const result = await access.setSubscription(
      String(ctx.chat.id),
      home.id,
      command === 'on_notification',
    )

    await ctx.reply(ctx.t(`subscription_${result}`))
  })

  composer.filter(
    ctx => ctx.hasCommand(monitorCommands) || Boolean(notificationReply(ctx)),
    protectedCommands,
  )

  return composer
}
