import { replyFormatted } from '../../services/botApi'

export const accessDeniedKey = ctx =>
  ctx.chat.type === 'group' || ctx.chat.type === 'supergroup'
    ? 'access_denied_group'
    : 'access_denied'

export const createAccessHandler =
  ({ access }) =>
  async (ctx, next) => {
    if (!access.isAuthorized(String(ctx.chat.id))) {
      await replyFormatted(ctx, ctx.t(accessDeniedKey(ctx)), 'i')

      return
    }

    await next()
  }
