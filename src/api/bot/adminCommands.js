import { Composer } from 'grammy'

import { monitorValidation } from '../../services'

export const createAdminCommands = ({ access, admins = [] }) => {
  const composer = new Composer()

  composer.chatType('private').command('admin', async ctx => {
    if (!admins.includes(ctx.from?.id)) {
      await ctx.reply(ctx.t('admin_access_denied'))

      return
    }

    await ctx.reply(
      ctx.t('admin_help', { helpCommand: `/help@${ctx.me.username}` }),
    )
  })

  //
  //

  composer.command('clear_chats', async ctx => {
    if (ctx.chat.type !== 'private') {
      return
    }

    if (!admins.includes(ctx.from?.id)) {
      await ctx.reply(ctx.t('admin_access_denied'))

      return
    }

    const target = ctx.match.trim()

    if (target !== 'all' && !monitorValidation.isChatId(target)) {
      await ctx.reply(ctx.t('admin_clear_usage'))

      return
    }

    const count = await access.clearChats(target)

    if (target !== 'all' && count === 0) {
      await ctx.reply(ctx.t('admin_chat_not_found'))

      return
    }

    await ctx.reply(ctx.t('admin_chats_cleared', { count }))
  })

  //
  //

  composer.command('authorize_group', async ctx => {
    if (ctx.chat.type !== 'private') {
      return
    }

    if (!admins.includes(ctx.from?.id)) {
      await ctx.reply(ctx.t('admin_access_denied'))

      return
    }

    const target = ctx.match.trim()

    if (!monitorValidation.isChatId(target) || !target.startsWith('-')) {
      await ctx.reply(ctx.t('admin_authorize_group_usage'))

      return
    }

    const result = await access.authorizeGroup(target)

    await ctx.reply(
      ctx.t(
        result === 'authorized' ? 'admin_group_authorized' : `access_${result}`,
      ),
    )
  })

  return composer
}
