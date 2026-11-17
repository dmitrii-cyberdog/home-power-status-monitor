import { Composer } from 'grammy'

import { createAccessHandler } from '../../middlewares/bot/accessHandler'

import {
  renderFullStatusMessages,
  renderStatusMessages,
} from './monitorMessages'

export const createMonitorCommands = ({ access, homeMonitor }) => {
  const composer = new Composer()

  composer.use(async (ctx, next) => {
    if (ctx.chat?.type !== 'private') {
      const command = ctx.msg?.entities?.find(
        entity => entity.type === 'bot_command' && entity.offset === 0,
      )

      const text = command ? ctx.msg.text.slice(0, command.length) : ''

      if (!text.toLowerCase().endsWith(`@${ctx.me.username.toLowerCase()}`)) {
        return
      }
    }

    await next()
  })
  composer.command('secret', async ctx => {
    try {
      const entity = ctx.msg.entities.find(
        item => item.type === 'bot_command' && item.offset === 0,
      )

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

  const protectedCommands = new Composer()

  protectedCommands.use(createAccessHandler({ access }))
  protectedCommands.command(
    ['status', 'status_full', 'on_notification', 'off_notification'],
    async ctx => {
      const command = ctx.msg.text.split(/[\s@]/)[0].slice(1)

      const isStatus = command === 'status' || command === 'status_full'

      const argument = ctx.match.trim().toLowerCase()

      const statuses = homeMonitor.getStatuses()

      const home = statuses.find(
        candidate => candidate.name.toLowerCase() === argument,
      )

      if ((!isStatus || argument) && !home) {
        await ctx.reply(
          ctx.t(argument ? 'monitor_not_found' : 'monitor_home_required'),
        )

        return
      }

      if (isStatus) {
        const updatedStatuses = await homeMonitor.check()

        const render =
          command === 'status_full'
            ? renderFullStatusMessages
            : renderStatusMessages

        for (const text of render(
          argument
            ? updatedStatuses.filter(updated => updated.id === home.id)
            : updatedStatuses,
          ctx.t.bind(ctx),
        )) {
          await ctx.reply(text, { parse_mode: 'HTML' })
        }

        return
      }

      const locale = (await ctx.i18n?.getLocale()) ?? 'en'

      const result = await access.setSubscription(
        String(ctx.chat.id),
        home.id,
        command === 'on_notification',
        locale,
      )

      await ctx.reply(ctx.t(`subscription_${result}`))
    },
  )
  composer.filter(
    ctx =>
      ctx.hasCommand([
        'status',
        'status_full',
        'on_notification',
        'off_notification',
      ]),
    protectedCommands,
  )

  return composer
}
