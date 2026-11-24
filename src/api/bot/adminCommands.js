import { Composer } from 'grammy'

import { monitorValidation, replyFormatted } from '../../services'

import { escapeHtmlText } from '../../utils/common'

export const createAdminCommands = ({ access, admins = [] }) => {
  const composer = new Composer()

  composer.chatType('private').command('admin', async ctx => {
    if (!admins.includes(ctx.from?.id)) {
      await replyFormatted(ctx, ctx.t('admin_access_denied'), 'i')

      return
    }

    await ctx.reply(
      ctx.t('admin_help', {
        helpCommand: escapeHtmlText(`/help@${ctx.me.username}`),
      }),
      { parse_mode: 'HTML' },
    )
  })

  //
  //

  composer.command('clear_chats', async ctx => {
    if (ctx.chat.type !== 'private') {
      return
    }

    if (!admins.includes(ctx.from?.id)) {
      await replyFormatted(ctx, ctx.t('admin_access_denied'), 'i')

      return
    }

    const target = ctx.match.trim()

    if (target !== 'all' && !monitorValidation.isChatId(target)) {
      await replyFormatted(ctx, ctx.t('admin_clear_usage'), 'i')

      return
    }

    const count = await access.clearChats(target)

    if (target !== 'all' && count === 0) {
      await replyFormatted(ctx, ctx.t('admin_chat_not_found'), 'i')

      return
    }

    await replyFormatted(ctx, ctx.t('admin_chats_cleared', { count }), 'b')
  })

  //
  //

  composer.command('authorize_group', async ctx => {
    if (ctx.chat.type !== 'private') {
      return
    }

    if (!admins.includes(ctx.from?.id)) {
      await replyFormatted(ctx, ctx.t('admin_access_denied'), 'i')

      return
    }

    const target = ctx.match.trim()

    if (!monitorValidation.isChatId(target) || !target.startsWith('-')) {
      await replyFormatted(ctx, ctx.t('admin_authorize_group_usage'), 'i')

      return
    }

    const result = await access.authorizeGroup(target)

    await replyFormatted(
      ctx,
      ctx.t(
        result === 'authorized' ? 'admin_group_authorized' : `access_${result}`,
      ),
      result === 'authorized' ? 'b' : 'i',
    )
  })

  return composer
}
