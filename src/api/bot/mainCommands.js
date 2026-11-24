import { Composer } from 'grammy'

import { formatBotText, replyFormatted } from '../../services/botApi'

import { escapeHtmlText } from '../../utils/common'

const replyGroupHelp = ctx =>
  ctx.reply(
    [
      ctx.t('help_group_access'),
      formatBotText(`/authorize_group ${ctx.chatId}`, 'b'),
      '',
      ctx.t('help_group_commands', {
        helpCommand: escapeHtmlText(`/help@${ctx.me.username}`),
        statusCommand: escapeHtmlText(`/status@${ctx.me.username}`),
      }),
      '',
      ctx.t('help'),
    ].join('\n'),
    { parse_mode: 'HTML' },
  )

//
//

export const createMainCommands = ({ access }) => {
  const composer = new Composer()

  const groups = composer.chatType(['group', 'supergroup'])

  groups.on('my_chat_member', async ctx => {
    const { old_chat_member, new_chat_member } = ctx.myChatMember

    if (
      ['left', 'kicked'].includes(old_chat_member.status) &&
      ['member', 'administrator'].includes(new_chat_member.status)
    ) {
      await replyGroupHelp(ctx)
    }
  })

  groups.command(['start', 'help'], replyGroupHelp)

  //
  //

  composer.command('start', async ctx => {
    await replyFormatted(ctx, ctx.t('start'), 'b')
  })

  composer.command('help', async ctx => {
    const accessHelp = ctx.t('help_private_access', {
      helpCommand: escapeHtmlText(`/help@${ctx.me.username}`),
    })

    await ctx.reply([accessHelp, ctx.t('help')].join('\n\n'), {
      parse_mode: 'HTML',
    })
  })

  composer.command(['en', 'ru'], async ctx => {
    if (!ctx.chatId || ctx.chat.type === 'channel') {
      return
    }

    const locale = ctx.message.text.slice(1, 3)

    await access.setLocale(ctx.chatId, locale)

    ctx.i18n.useLocale(locale)

    await replyFormatted(ctx, ctx.t('language_selected'), 'b')
  })

  return composer
}
