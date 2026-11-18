export const createChatLocaleHandler = access => async (ctx, next) => {
  if (ctx.chatId !== undefined) {
    const locale = access?.getLocale(ctx.chatId)

    if (locale) {
      ctx.i18n.useLocale(locale)
    }
  }

  await next()
}
