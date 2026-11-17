export const createAccessHandler =
  ({ access }) =>
  async (ctx, next) => {
    if (!access.isAuthorized(String(ctx.chat.id))) {
      await ctx.reply(ctx.t('access_denied'))

      return
    }

    await next()
  }
