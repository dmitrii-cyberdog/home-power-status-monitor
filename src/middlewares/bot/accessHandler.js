export const accessDeniedKey = ctx =>
  ctx.chat.type === 'group' || ctx.chat.type === 'supergroup'
    ? 'access_denied_group'
    : 'access_denied'

export const createAccessHandler =
  ({ access }) =>
  async (ctx, next) => {
    if (!access.isAuthorized(String(ctx.chat.id))) {
      await ctx.reply(ctx.t(accessDeniedKey(ctx)))

      return
    }

    await next()
  }
