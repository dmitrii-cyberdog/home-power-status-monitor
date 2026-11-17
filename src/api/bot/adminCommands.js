import { Composer } from 'grammy'

import { isChatId } from '../../services/monitorRecords'

export const createAdminCommands = ({ access, admins = [] }) => {
  const composer = new Composer()

  composer.command('clear_chats', async ctx => {
    if (ctx.chat.type !== 'private') {
      return
    }

    if (!admins.includes(ctx.from?.id)) {
      await ctx.reply(ctx.t('admin_access_denied'))

      return
    }

    const target = ctx.match.trim()

    if (target !== 'all' && !isChatId(target)) {
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

  return composer
}
