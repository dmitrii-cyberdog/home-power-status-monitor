import { Composer } from 'grammy'

//
//

export const createMainCommands = ({ access }) => {
  const composer = new Composer()

  composer.command('start', async ctx => {
    await ctx.reply(ctx.t('start'))
  })

  composer.command('help', async ctx => {
    await ctx.reply(ctx.t('help'))
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
