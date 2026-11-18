import { Composer } from 'grammy'

const replyGroupHelp = ctx =>
  ctx.reply(
    [
      ctx.t('help_group_access'),
      `/authorize_group ${ctx.chatId}`,
      '',
      ctx.t('help_group_commands', {
        helpCommand: `/help@${ctx.me.username}`,
        statusCommand: `/status@${ctx.me.username}`,
      }),
      '',
      ctx.t('help'),
    ].join('\n'),
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
    await ctx.reply(ctx.t('start'))
  })

  composer.command('help', async ctx => {
    const accessHelp = ctx.t('help_private_access', {
      helpCommand: `/help@${ctx.me.username}`,
    })

    await ctx.reply([accessHelp, ctx.t('help')].join('\n\n'))
  })

  composer.command(['en', 'ru'], async ctx => {
    if (!ctx.chatId || ctx.chat.type === 'channel') {
      return
    }

    const locale = ctx.message.text.slice(1, 3)

    await access.setLocale(ctx.chatId, locale)

    ctx.i18n.useLocale(locale)

    await ctx.reply(ctx.t('language_selected'))
  })

  return composer
}
