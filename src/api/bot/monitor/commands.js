import { Composer, InlineKeyboard } from 'grammy'

import { supportedLocales } from '../../../config'

import { accessDeniedKey, createAccessHandler } from '../../../middlewares/bot'

import {
  createTelegramSendGuard,
  isTelegramSendSkipped,
  getI18n,
  monitorMessages,
  replyFormatted,
} from '../../../services'

import { parseIntervalArguments } from './intervalArguments'

const notificationCommands = ['on_notification', 'off_notification']
const homeReports = {
  status: monitorMessages.renderStatusMessages,
  status_full: monitorMessages.renderFullStatusMessages,
  statistic: monitorMessages.renderStatisticMessages,
}

const monitorCommands = [
  ...Object.keys(homeReports),
  'notification_interval',
  ...notificationCommands,
]
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
        await replyFormatted(ctx, ctx.t('access_group_secret_rejected'), 'i')

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

      await replyFormatted(
        ctx,
        ctx.t(`access_${result}`),
        result === 'authorized' ? 'b' : 'i',
      )
    } catch {
      await replyFormatted(ctx, ctx.t('general_error'), 'i')
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
    if (ctx.hasCommand('notification_interval')) {
      const parsed = parseIntervalArguments(
        ctx.match,
        homeMonitor.getStatuses().map(({ id, name }) => ({ id, name })),
      )

      if (parsed.error) {
        await replyFormatted(
          ctx,
          ctx.t(
            parsed.error === 'usage' ? 'interval_usage' : 'monitor_not_found',
          ),
          'i',
        )

        return
      }

      const chatId = String(ctx.chat.id)

      await access.setInterval(chatId, parsed.home.id, parsed.minutes)

      const effective = access.getIntervalMinutes(chatId, parsed.home.id)

      const variables = { home: parsed.home.name, minutes: String(effective) }

      let key = 'interval_set'

      if (parsed.minutes === null) {
        key = effective === 0 ? 'interval_reset_off' : 'interval_reset'
      } else if (effective === 0) {
        key = 'interval_off'
      }

      await replyFormatted(ctx, ctx.t(key, variables), 'b')

      return
    }

    const replyCommand = notificationReply(ctx)

    const command = replyCommand ?? ctx.message.text.split(/[\s@]/)[0].slice(1)

    const render = homeReports[command]

    const argument = (replyCommand ? ctx.message.text : ctx.match)
      .trim()
      .toLowerCase()

    if (!render && !argument) {
      await replyFormatted(ctx, ctx.t(`subscription_prompt_${command}`), 'i', {
        reply_markup: { force_reply: true, selective: true },
        reply_parameters: { message_id: ctx.message.message_id },
      })

      return
    }

    const savedStatuses =
      argument || command === 'statistic'
        ? homeMonitor.getStatuses()
        : undefined

    const home = argument
      ? savedStatuses.find(
          candidate => candidate.name.toLowerCase() === argument,
        )
      : undefined

    if (argument && !home) {
      await replyFormatted(ctx, ctx.t('monitor_not_found'), 'i')

      return
    }

    if (render) {
      const chatId = String(ctx.chat.id)

      const grant = access.captureGrant(chatId)

      if (!grant) {
        await replyFormatted(ctx, ctx.t(accessDeniedKey(ctx)), 'i')

        return
      }

      const statuses =
        command === 'statistic' ? savedStatuses : await homeMonitor.check()

      const messages = render(
        argument
          ? statuses.filter(updated => updated.id === home.id)
          : statuses,
        ctx.t.bind(ctx),
      )

      // Each chunk is dispatched only while the captured grant is current.
      const signal = createTelegramSendGuard(() =>
        access.isGrantCurrent(chatId, grant),
      )

      for (const [index, text] of messages.entries()) {
        if (!access.isAuthorized(chatId)) {
          await replyFormatted(ctx, ctx.t(accessDeniedKey(ctx)), 'i')

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

    await replyFormatted(ctx, ctx.t(`subscription_${result}`), 'b')
  })

  composer.filter(
    ctx => ctx.hasCommand(monitorCommands) || Boolean(notificationReply(ctx)),
    protectedCommands,
  )

  return composer
}
